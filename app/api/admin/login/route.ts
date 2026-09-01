/**
 * POST /api/admin/login
 *
 * 规格 11.x：
 *   - 校验用户名 + 密码（bcryptjs compare）。
 *   - 成功：随机 32 字节 token（hex）→ 仅 SHA-256(token) 写入 AdminSession，
 *     cookie 存明文 token（HttpOnly，生产加 Secure）。
 *   - 失败：通用错误（不区分用户/密码错误），同 IP 连续 5 次失败锁定 15 分钟。
 *   - 永远不写日志、不回显密码。
 *
 * CSRF 基础防护：拒绝 Origin 不在 APP_URL（或 referer 推断的 host）下的请求。
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  getAdminLoginPath,
  hashSessionToken,
  sessionExpiry,
} from "@/lib/auth";
import { getCsrfToken, verifyCsrfToken } from "@/lib/csrf";
import { loginSchema } from "@/lib/validation";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";

export const runtime = "nodejs";

const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_THRESHOLD = 5;
const FAIL_BUCKET_MAX_KEYS = 10_000;

type Bucket = { count: number; firstAt: number; lockedUntil: number };
const failBuckets = new Map<string, Bucket>();

/** 防内存膨胀（审核报告 P2）：桶数量超限时清理已过期条目 */
function pruneFailBuckets(): void {
  if (failBuckets.size < FAIL_BUCKET_MAX_KEYS) return;
  const now = Date.now();
  for (const [key, bucket] of failBuckets) {
    if (bucket.lockedUntil <= now && now - bucket.firstAt > FAIL_WINDOW_MS) {
      failBuckets.delete(key);
    }
    if (failBuckets.size < FAIL_BUCKET_MAX_KEYS / 2) break;
  }
}

function clientKey(req: Request): string {
  return getClientIp(req);
}

function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const expected = process.env.APP_URL?.trim();
  if (!expected) return true;
  try {
    const o = new URL(origin);
    const e = new URL(expected);
    return o.protocol === e.protocol && o.host === e.host;
  } catch {
    return false;
  }
}

function checkLock(key: string): { locked: boolean; retryAfter?: number } {
  const b = failBuckets.get(key);
  if (!b) return { locked: false };
  const now = Date.now();
  if (b.lockedUntil > now) {
    return { locked: true, retryAfter: Math.ceil((b.lockedUntil - now) / 1000) };
  }
  if (now - b.firstAt > FAIL_WINDOW_MS) {
    failBuckets.delete(key);
  }
  return { locked: false };
}

function recordFailure(key: string): void {
  pruneFailBuckets();
  const now = Date.now();
  const b = failBuckets.get(key);
  if (!b || now - b.firstAt > FAIL_WINDOW_MS) {
    failBuckets.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  b.count += 1;
  if (b.count >= FAIL_THRESHOLD) {
    b.lockedUntil = now + FAIL_WINDOW_MS;
  }
}

function recordSuccess(key: string): void {
  failBuckets.delete(key);
}

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ error, ...(extra ?? {}) }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

export async function POST(req: Request) {
  // Origin check（登录接口不做 CSRF 校验：CSRF cookie 在登录成功后才种下，
  // 且登录本身是 CSRF 攻击目标而非发起方；后台写操作才强制 CSRF）
  if (!isOriginAllowed(req)) {
    return jsonError(403, "请求来源不被允许");
  }

  const key = clientKey(req);
  const lock = checkLock(key);
  if (lock.locked) {
    return jsonError(429, "尝试次数过多，请稍后再试", { retryAfter: lock.retryAfter });
  }

  // Validate payload with Zod
  const { loginSchema } = await import("@/lib/validation");
  let payload: { username: string; password: string };
  try {
    const raw = await req.json();
    payload = loginSchema.parse(raw);
  } catch {
    return jsonError(400, "请求体格式错误");
  }
  const username = payload.username.trim();
  const password = payload.password;

  const user = await db.adminUser.findUnique({ where: { username } });
  const hashToCompare =
    user?.passwordHash ??
    "$2b$10$abcdefghijklmnopqrstuuOYZQXq0w1QH8b0zQF9L1m3yX9h7kB4a";
  let ok = false;
  try {
    ok = await bcrypt.compare(password, hashToCompare);
  } catch {
    ok = false;
  }

  if (!user || !user.active || !ok) {
    recordFailure(key);
    await logAudit({
      adminId: "",
      action: AUDIT_ACTIONS.LOGIN_FAIL,
      targetType: "auth",
      targetId: username.slice(0, 100),
      metadata: { reason: "invalid_credentials" },
    });
    return jsonError(401, "用户名或密码错误");
  }

  // Create session
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const expiresAt = sessionExpiry();
  await db.adminSession.create({ data: { tokenHash, expiresAt } });
  await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  recordSuccess(key);

  const cookieStore = await cookies();
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  await logAudit({
    adminId: user.id,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    targetType: "auth",
    targetId: user.id,
    metadata: { username: user.username },
  });
return new Response(
    JSON.stringify({ ok: true, redirect: "/admin", loginPath: getAdminLoginPath() }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
