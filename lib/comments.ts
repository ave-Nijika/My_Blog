/**
 * 评论核心逻辑（lib/comments.ts）。
 *
 * 范围（M3a）：
 *   - 访客识别：签名 Cookie（HMAC 签名的随机 token，HttpOnly），DB 只存 SHA-256(token)。
 *   - IP 标识：用 env IP_HASH_SECRET 做 HMAC 得到 ipHmac，不存原始 IP。
 *   - 文本清洗：剥离 HTML 标签、规范化空白，确保入库内容是纯文本。
 *   - 长度校验：字节数 + 字符数双限，统一在服务端拒绝。
 *   - 冷却：VisitorRisk.cooldownUntil；同 ipHmac+tokenHash 维度，10 分钟一次。
 *   - 限流：按 ipHmac 滑动窗口，COMMENT_RATE_LIMIT_WINDOW_SECONDS 内最多
 *     COMMENT_RATE_LIMIT_MAX_ATTEMPTS 次提交。
 *
 * 注意：
 *   - 不暴露任何"为什么被拒"的细节给前端，统一返回通用提示。
 *   - 不存原始 IP、不存原始 token，DB 中只存哈希。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { getClientIp } from "./client-ip";
import { getEffectiveSiteSettings } from "./site-settings";
import { requireSecret } from "./secrets";

export const VISITOR_TOKEN_COOKIE = "visitor_token";
export const VISITOR_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1y

export type VisitorIdentity = {
  /** ipHmac: HMAC(IP_HASH_SECRET, rawIp) */
  ipHmac: string;
  /** visitorTokenHash: SHA-256(visitorToken) */
  tokenHash: string;
  /** 访客 token 原始值（首次下发后写入 cookie） */
  token: string;
  /** 是否新下发（用于决定是否需要写 cookie） */
  isNew: boolean;
  /** 客户端 raw IP（仅在内存中使用一次做 HMAC，不写入日志/DB） */
  rawIp: string;
};

function getEnvOrDefault(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

function ipHashSecret(): string {
  return requireSecret("IP_HASH_SECRET", "dev-ip-hash-secret");
}

function visitorTokenSecret(): string {
  return requireSecret("VISITOR_TOKEN_SECRET", "dev-visitor-token-secret");
}

function readClientIp(req: Request): string {
  return getClientIp(req);
}

function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * 验证 visitor token 是否合法：必须是合法的 hex 字符串，且 HMAC 签名匹配。
 * 校验失败时统一返回 false（不抛错）。
 */
export function isValidVisitorToken(token: string): boolean {
  if (!token || token.length < 64 || token.length > 256) return false;
  if (!/^[a-f0-9]+$/.test(token)) return false;
  const raw = token.slice(0, -32);
  const sig = token.slice(-32);
  const expected = hmacHex(visitorTokenSecret(), raw).slice(0, 32);
  return safeEqual(expected, sig);
}

export function newVisitorToken(): string {
  // 32 字节随机 → 64 字符 hex。前 32 hex 字符 = HMAC(token) 的前 32 hex，
  // 浏览器不会做这个验证，但服务端可以快速拒绝伪造的 token。
  const raw = randomBytes(32).toString("hex");
  const sig = hmacHex(visitorTokenSecret(), raw).slice(0, 32);
  return raw + sig;
}

/**
 * 从 request + cookie 解析访客身份。如 cookie 无/无效，则生成新 token。
 * 不会自己写 cookie；调用方根据 isNew 决定是否需要写入。
 */
export function resolveVisitorIdentity(req: Request): VisitorIdentity {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/visitor_token=([^;]+)/);
  let token = match ? match[1] : "";
  let isNew = false;
  if (!isValidVisitorToken(token)) {
    token = newVisitorToken();
    isNew = true;
  }
  const rawIp = readClientIp(req);
  const ipHmac = hmacHex(ipHashSecret(), rawIp);
  const tokenHash = sha256Hex(token);
  return { ipHmac, tokenHash, token, isNew, rawIp };
}

/**
 * 在 route handler 中把新 token 写回 cookie。
 * 调用条件：resolveVisitorIdentity 返回的 isNew === true。
 */
export async function setVisitorTokenCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: VISITOR_TOKEN_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VISITOR_TOKEN_MAX_AGE_SECONDS,
  });
}

// 限流滑动窗口内存桶（修复 P1-4：使 MAX_ATTEMPTS 真正参与计算）。
// 进程内实现：多实例部署时各自计数，重启清零；键数量有上限防内存膨胀。
export const rateLimitBuckets = new Map<
  string,
  { count: number; windowStart: number }
>();
const RATE_BUCKET_MAX_KEYS = 10_000;

function pruneRateLimitBuckets(now: number, windowMs: number): void {
  if (rateLimitBuckets.size < RATE_BUCKET_MAX_KEYS) return;
  for (const [key, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStart > windowMs) rateLimitBuckets.delete(key);
    if (rateLimitBuckets.size < RATE_BUCKET_MAX_KEYS / 2) break;
  }
}

/**
 * 读取评论配置：DB（SiteSettings）优先，env 兜底（修复审核报告 P1-5）。
 */
export async function getCommentConfig() {
  const effective = await getEffectiveSiteSettings();
  return {
    cooldownSeconds: effective.cooldownSeconds,
    minLength: effective.minLength,
    maxLength: effective.maxLength,
    bodyMaxBytes: effective.bodyMaxBytes,
    rateWindowSeconds: effective.rateWindowSeconds,
    rateMaxAttempts: effective.rateMaxAttempts,
  };
}

/**
 * HTML 标签剥离：去掉 <...>、将常见 HTML 实体反转义、规范化空白。
 * 这是 best-effort 防御；评论永远以纯文本形式渲染。
 */
export function sanitizeBodyText(raw: string): string {
  let s = raw ?? "";
  // 1. 去除所有 HTML/XML 标签
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  // 2. 反转义常见 HTML 实体（让用户输入 &lt;script&gt; 看到字面量）
  s = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
  // 3. 移除控制字符（保留 \n \r \t）
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  // 4. 规范化换行：把 \r\n / \r 统一成 \n
  s = s.replace(/\r\n?/g, "\n");
  // 5. trim 首尾空白
  s = s.trim();
  return s;
}

export type ValidateResult =
  | { ok: true; bodyText: string }
  | { ok: false; reason: "too_long_bytes" | "too_short" | "too_long" };

/**
 * 校验 + 清洗文本。返回是否通过以及最终入库文本。
 * 任何失败都映射为通用 reason，调用方对外只暴露"提交失败"统一提示。
 */
export async function validateAndSanitize(
  input: unknown
): Promise<ValidateResult> {
  const cfg = await getCommentConfig();
  if (typeof input !== "string") {
    return { ok: false, reason: "too_short" };
  }
  const cleaned = sanitizeBodyText(input);
  // 字节限制
  const bytes = Buffer.byteLength(cleaned, "utf8");
  if (bytes > cfg.bodyMaxBytes) {
    return { ok: false, reason: "too_long_bytes" };
  }
  // 字符限制
  if (cleaned.length < cfg.minLength) {
    return { ok: false, reason: "too_short" };
  }
  if (cleaned.length > cfg.maxLength) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, bodyText: cleaned };
}

/**
 * 冷却检查。命中则返回 { coolingDown: true, retryAfterSec }；
 * 未命中返回 { coolingDown: false }。
 */
export async function checkCooldown(
  ipHmac: string,
  tokenHash: string
): Promise<{ coolingDown: boolean; retryAfterSec?: number }> {
  // 冷却配置为 0 = 全局禁用冷却。必须先于此判断：否则历史上（600s 时代）
  // 留下的未来时间戳 cooldownUntil 会形成死锁——被挡的提交永远走不到
  // recordSubmit 去刷新它，把配置改成 0 也解不开（主人实测问题）。
  const cfg = await getCommentConfig();
  if (cfg.cooldownSeconds <= 0) {
    return { coolingDown: false };
  }
  const risk = await db.visitorRisk.findUnique({
    where: { ipHmac_visitorTokenHash: { ipHmac, visitorTokenHash: tokenHash } },
  });
  if (!risk || !risk.cooldownUntil) {
    return { coolingDown: false };
  }
  const now = Date.now();
  const untilMs = risk.cooldownUntil.getTime();
  if (untilMs <= now) {
    return { coolingDown: false };
  }
  return {
    coolingDown: true,
    retryAfterSec: Math.ceil((untilMs - now) / 1000),
  };
}

/**
 * 限流检查（按 ipHmac 滑动窗口）。命中返回 { limited: true, retryAfterSec }。
 * 计数表 visitorRisk.warningCount 这里复用（不增加真实警告）；
 * 如果记录不存在则视为 0 次。
 */
export async function checkRateLimit(
  ipHmac: string
): Promise<{ limited: boolean; retryAfterSec?: number }> {
  const cfg = await getCommentConfig();
  const windowMs = cfg.rateWindowSeconds * 1000;
  const maxAttempts = cfg.rateMaxAttempts;
  const now = Date.now();
  pruneRateLimitBuckets(now, windowMs);
  // 内存滑动窗口计数（修复 P1-4：MAX_ATTEMPTS 现在真正参与限流）
  const bucket = rateLimitBuckets.get(ipHmac);
  if (!bucket || now - bucket.windowStart > windowMs) {
    rateLimitBuckets.set(ipHmac, { count: 1, windowStart: now });
    return { limited: false };
  }
  bucket.count += 1;
  if (bucket.count > maxAttempts) {
    return {
      limited: true,
      retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - bucket.windowStart)) / 1000)),
    };
  }
  return { limited: false };
}

/**
 * 记录一次提交尝试并设置冷却窗口。
 * - 首次提交：创建 VisitorRisk 记录，cooldownUntil = now + cooldown。
 * - 后续提交：更新 cooldownUntil。
 * - 同时刷新 lastAttemptAt 用于限流窗口判定。
 */
export async function recordSubmit(
  ipHmac: string,
  tokenHash: string
): Promise<void> {
  const cfg = await getCommentConfig();
  const now = new Date();
  const cooldownUntil = new Date(now.getTime() + cfg.cooldownSeconds * 1000);
  await db.visitorRisk.upsert({
    where: { ipHmac_visitorTokenHash: { ipHmac, visitorTokenHash: tokenHash } },
    update: {
      cooldownUntil,
      lastAttemptAt: now,
      lastSeenAt: now,
    },
    create: {
      ipHmac,
      visitorTokenHash: tokenHash,
      cooldownUntil,
      lastAttemptAt: now,
      lastSeenAt: now,
      warningCount: 0,
    },
  });
}

/**
 * 列出某文章已批准的评论，按 createdAt 升序。
 * 仅返回公开字段（id / bodyText / createdAt）。
 */
export async function listApprovedComments(articleId: string) {
  const rows = await db.comment.findMany({
    where: { articleId, status: "approved", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      bodyText: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    bodyText: r.bodyText,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * 通用错误响应辅助。统一文案，不区分原因。
 */
export function commentErrorResponse(
  status: number,
  error: string,
  retryAfterSec?: number
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (retryAfterSec !== undefined) {
    headers["Retry-After"] = String(retryAfterSec);
  }
  return new Response(JSON.stringify({ error }), { status, headers });
}

export const COMMENT_GENERIC_ERROR = "评论提交失败，请稍后再试";
export const COMMENT_GENERIC_SUCCESS =
  "评论已提交，审核通过后显示";
