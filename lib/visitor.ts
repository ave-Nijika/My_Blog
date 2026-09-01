// lib/visitor.ts
import crypto from "crypto";
import { headers } from "next/headers";
import { db } from "./db";
import { getClientIp } from "./client-ip";
import { getEffectiveSiteSettings } from "./site-settings";
import { requireSecret } from "./secrets";
import { getSession } from "./auth";

export type IdentityHash = string;

// 警告与封禁系统（M3b）

export type WarningSource = "regex" | "admin" | "llm" | "system";

export type BanMatchType = "ip" | "visitor";

export interface BanRecord {
  id: string;
  matchType: BanMatchType;
  ipHmac: string | null;
  visitorTokenHash: string | null;
  expiresAt: Date | null;
  permanent: boolean;
  reason: string;
  createdAt: Date;
  createdBy: string;
  revokedAt: Date | null;
  revokedBy: string | null;
}

/** 自动封禁阈值：DB（SiteSettings）优先，env 兜底（修复审核报告 P1-5）。 */
export async function getAutoBanThreshold(): Promise<number> {
  const effective = await getEffectiveSiteSettings();
  return effective.autoBanWarningThreshold;
}

export function getBanDurationMs(): number {
  // 默认封禁 24 小时
  const raw = (process.env.COMMENT_BAN_DURATION_SECONDS ?? "").trim();
  if (!raw) return 24 * 60 * 60 * 1000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n * 1000 : 24 * 60 * 60 * 1000;
}

/**
 * 在 VisitorRisk 上增加 warningCount 并写一条 VisitorWarningEvent。
 * 若累计超过 COMMENT_AUTO_BAN_THRESHOLD，自动创建一条 VisitorBan。
 *
 * 返回值包含更新后的 warningCount 以及（触发了自动封禁时的）新 ban id。
 */
export async function applyWarning(params: {
  commentId?: string;
  ipHmac: string;
  visitorTokenHash: string;
  delta: number;
  source: WarningSource;
  adminId?: string;
  reason?: string;
}): Promise<{
  warningCount: number;
  banned: boolean;
  banId?: string;
}> {
  const delta = Math.max(0, Math.floor(params.delta));
  if (delta <= 0) {
    // 即使 delta=0，也仍然记录事件，但不动 warningCount
    try {
      await db.visitorWarningEvent.create({
        data: {
          ipHmac: params.ipHmac,
          visitorTokenHash: params.visitorTokenHash,
          delta: 0,
          source: params.source,
          commentId: params.commentId ?? null,
          adminId: params.adminId ?? null,
          reason: params.reason ?? null,
        },
      });
    } catch (e) {
      console.warn("[visitor] record zero-delta warning failed", e);
    }
    const cur = await db.visitorRisk.findUnique({
      where: {
        ipHmac_visitorTokenHash: {
          ipHmac: params.ipHmac,
          visitorTokenHash: params.visitorTokenHash,
        },
      },
    });
    return { warningCount: cur?.warningCount ?? 0, banned: false };
  }

  // 1) upsert risk 记录 + 累加 warningCount
  const now = new Date();
  const risk = await db.visitorRisk.upsert({
    where: {
      ipHmac_visitorTokenHash: {
        ipHmac: params.ipHmac,
        visitorTokenHash: params.visitorTokenHash,
      },
    },
    create: {
      ipHmac: params.ipHmac,
      visitorTokenHash: params.visitorTokenHash,
      warningCount: delta,
      lastAttemptAt: now,
      lastSeenAt: now,
    },
    update: {
      warningCount: { increment: delta },
      lastAttemptAt: now,
      lastSeenAt: now,
    },
  });

  // 2) 写 event
  try {
    await db.visitorWarningEvent.create({
      data: {
        ipHmac: params.ipHmac,
        visitorTokenHash: params.visitorTokenHash,
        delta,
        source: params.source,
        commentId: params.commentId ?? null,
        adminId: params.adminId ?? null,
        reason: params.reason ?? null,
      },
    });
  } catch (e) {
    console.warn("[visitor] record warning event failed", e);
  }

  // 3) 检查是否需要自动封禁
  const threshold = await getAutoBanThreshold();
  if (risk.warningCount >= threshold) {
    // 已经在该 ipHmac 上有未撤销的有效封禁就不再叠加
    const existing = await checkBan(params.ipHmac, params.visitorTokenHash);
    if (existing) {
      return { warningCount: risk.warningCount, banned: false };
    }
    const ban = await createAutoBan({
      ipHmac: params.ipHmac,
      visitorTokenHash: params.visitorTokenHash,
      reason: `累计警告 ${risk.warningCount} 次（阈值 ${threshold}）`,
    });
    return { warningCount: risk.warningCount, banned: true, banId: ban.id };
  }

  return { warningCount: risk.warningCount, banned: false };
}

/**
 * 检查给定的 ipHmac / visitorTokenHash 是否处于封禁中。
 * 返回最严格的一条封禁记录；未命中返回 null。
 *
 * 匹配规则：
 *   - matchType=ip 且 ipHmac 命中 → 命中
 *   - matchType=visitor 且 visitorTokenHash 命中 → 命中
 * 满足：permanent=true OR expiresAt IS NULL OR expiresAt > now，
 * 且 revokedAt IS NULL。
 */
export async function checkBan(
  ipHmac: string,
  visitorTokenHash: string
): Promise<BanRecord | null> {
  const now = new Date();
  const candidates = await db.visitorBan.findMany({
    where: {
      revokedAt: null,
      OR: [
        { matchType: "ip", ipHmac },
        { matchType: "visitor", visitorTokenHash },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  for (const c of candidates) {
    if (c.permanent) return toBanRecord(c);
    if (!c.expiresAt) return toBanRecord(c);
    if (c.expiresAt.getTime() > now.getTime()) return toBanRecord(c);
  }
  return null;
}

function toBanRecord(row: {
  id: string;
  matchType: string;
  ipHmac: string | null;
  visitorTokenHash: string | null;
  expiresAt: Date | null;
  permanent: boolean;
  reason: string;
  createdAt: Date;
  createdBy: string;
  revokedAt: Date | null;
  revokedBy: string | null;
}): BanRecord {
  return {
    id: row.id,
    matchType: (row.matchType === "visitor" ? "visitor" : "ip") as BanMatchType,
    ipHmac: row.ipHmac,
    visitorTokenHash: row.visitorTokenHash,
    expiresAt: row.expiresAt,
    permanent: row.permanent,
    reason: row.reason,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
  };
}

/**
 * 管理员手动封禁。
 * - permanent=true → expiresAt=null, permanent=true
 * - 否则 expiresAt = now + COMMENT_BAN_DURATION_SECONDS
 */
export async function createAdminBan(params: {
  ipHmac: string;
  visitorTokenHash: string;
  matchType: BanMatchType;
  reason: string;
  permanent: boolean;
  adminId: string;
  durationSeconds?: number;
}): Promise<BanRecord> {
  const expiresAt = params.permanent
    ? null
    : new Date(
        Date.now() +
          Math.max(
            60,
            params.durationSeconds ?? Math.floor(getBanDurationMs() / 1000)
          ) *
            1000
      );
  const created = await db.visitorBan.create({
    data: {
      matchType: params.matchType,
      ipHmac: params.matchType === "ip" ? params.ipHmac : null,
      visitorTokenHash:
        params.matchType === "visitor" ? params.visitorTokenHash : null,
      permanent: params.permanent,
      expiresAt,
      reason: params.reason || "管理员手动封禁",
      createdBy: params.adminId,
    },
  });
  return toBanRecord(created);
}

async function createAutoBan(params: {
  ipHmac: string;
  visitorTokenHash: string;
  reason: string;
}): Promise<BanRecord> {
  const expiresAt = new Date(Date.now() + getBanDurationMs());
  const created = await db.visitorBan.create({
    data: {
      matchType: "ip",
      ipHmac: params.ipHmac,
      visitorTokenHash: null,
      permanent: false,
      expiresAt,
      reason: params.reason,
      createdBy: "system",
    },
  });
  return toBanRecord(created);
}

/**
 * 管理员解除封禁：把 revokedAt / revokedBy 写上，原始记录保留。
 */
export async function revokeBan(banId: string, adminId: string): Promise<BanRecord> {
  const existing = await db.visitorBan.findUnique({ where: { id: banId } });
  if (!existing) {
    throw new Error("封禁记录不存在");
  }
  const updated = await db.visitorBan.update({
    where: { id: banId },
    data: { revokedAt: new Date(), revokedBy: adminId },
  });
  return toBanRecord(updated);
}

/**
 * 列出所有 VisitorRisk，按 warningCount desc。
 * 可选分页。
 */
export async function listVisitorRisks(params: {
  page: number;
  perPage: number;
}) {
  const skip = Math.max((params.page - 1) * params.perPage, 0);
  const take = params.perPage;
  const [rows, total] = await Promise.all([
    db.visitorRisk.findMany({
      orderBy: [{ warningCount: "desc" }, { updatedAt: "desc" }],
      skip,
      take,
    }),
    db.visitorRisk.count(),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      ipHmac: r.ipHmac,
      visitorTokenHash: r.visitorTokenHash,
      warningCount: r.warningCount,
      cooldownUntil: r.cooldownUntil?.toISOString() ?? null,
      lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
    })),
    total,
    page: params.page,
    perPage: params.perPage,
  };
}

export async function listActiveBans(): Promise<BanRecord[]> {
  const now = new Date();
  const rows = await db.visitorBan.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows
    .filter((r) => r.permanent || !r.expiresAt || r.expiresAt.getTime() > now.getTime())
    .map(toBanRecord);
}


const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 阅读量去重身份哈希：HMAC(IP_HASH_SECRET, ip)。
 * 修复审核报告 P1-7 附带问题：此前是无密钥的裸 SHA-256(IP)，
 * IPv4 只有 2^32 种取值可被离线反推；HMAC 化后与评论的 ipHmac 同等强度。
 */
export function getIdentityHash(ip: string): IdentityHash {
  const secret = requireSecret("IP_HASH_SECRET", "dev-ip-hash-secret");
  return crypto.createHmac("sha256", secret).update(ip).digest("hex");
}

export function getBucketStart(date: Date): Date {
  const bucketMs = Math.floor(date.getTime() / DAY_MS) * DAY_MS;
  return new Date(bucketMs);
}

export function generateVisitorToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function getTokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function verifyVisitorToken(token: string): Promise<boolean> {
  const tokenHash = getTokenHash(token);
  const session = await db.adminSession.findFirst({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() },
      revokedAt: null,
    },
  });
  return !!session;
}

export async function getVisitorInfo(request: Request): Promise<{ identityHash: IdentityHash; tokenHash: string; isAdmin: boolean }> {
  const cookieHeader = request.headers.get("cookie") || "";
  const tokenMatch = cookieHeader.match(/visitor_token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : "";
  const isAdmin = await verifyVisitorToken(token);
  
  const ip = getClientIp(request);
  const identityHash = getIdentityHash(ip);
  
  const tokenHash = getTokenHash(token);
  
  return { identityHash, tokenHash, isAdmin };
}

export async function recordView(articleId: string, identityHash: string): Promise<void> {
  const bucketStart = getBucketStart(new Date());
  
  const existing = await db.articleViewDedup.findFirst({
    where: {
      articleId,
      identityHash,
      bucketStart,
    },
  });
  
  if (existing) {
    return;
  }
  
  await db.articleViewDedup.create({
    data: {
      articleId,
      identityHash,
      bucketStart,
    },
  });
  
  await db.article.update({
    where: { id: articleId },
    data: {
      viewCount: {
        increment: 1,
      },
    },
  });
}

export async function getViewCount(articleId: string): Promise<number> {
  return db.articleViewDedup.count({
    where: {
      articleId,
    },
  });
}

/**
 * 文章页阅读量身份解析（server component 场景，修复审核报告 P1-7）。
 * 返回 null 表示无法解析（极罕见）；isAdmin=true 表示管理员本人浏览，不计入。
 */
export async function resolveViewIdentity(): Promise<{
  identityHash: IdentityHash;
  isAdmin: boolean;
}> {
  const h = await headers();
  const ip = getClientIp({ headers: h });
  const identityHash = getIdentityHash(ip);
  const session = await getSession();
  return { identityHash, isAdmin: !!session };
}
