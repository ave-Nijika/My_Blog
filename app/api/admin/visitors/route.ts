/**
 * /api/admin/visitors
 *
 * GET - 访客风险列表（带分页）。每条记录附带当前是否处于封禁状态。
 */
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { listActiveBans, listVisitorRisks } from "@/lib/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseIntParam(value: string | null, fallback: number, max: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = wrap(async (req: NextRequest) => {
  const url = new URL(req.url);
  const page = parseIntParam(url.searchParams.get("page"), 1, 1000);
  const perPage = parseIntParam(url.searchParams.get("perPage"), 20, 100);
  const [risks, activeBans] = await Promise.all([
    listVisitorRisks({ page, perPage }),
    listActiveBans(),
  ]);

  // 构造 ipHmac → ban 索引
  const ipBanMap = new Map<string, ReturnType<typeof banToJson>>();
  const tokenBanMap = new Map<string, ReturnType<typeof banToJson>>();
  for (const b of activeBans) {
    const json = banToJson(b);
    if (b.ipHmac) ipBanMap.set(b.ipHmac, json);
    if (b.visitorTokenHash) tokenBanMap.set(b.visitorTokenHash, json);
  }

  const items = risks.items.map((r) => ({
    ...r,
    activeBan: ipBanMap.get(r.ipHmac) ?? tokenBanMap.get(r.visitorTokenHash) ?? null,
  }));

  return jsonOk({
    items,
    total: risks.total,
    page: risks.page,
    perPage: risks.perPage,
  });
});

function banToJson(b: {
  id: string;
  matchType: "ip" | "visitor";
  ipHmac: string | null;
  visitorTokenHash: string | null;
  expiresAt: Date | null;
  permanent: boolean;
  reason: string;
  createdAt: Date;
  createdBy: string;
  revokedAt: Date | null;
  revokedBy: string | null;
}) {
  return {
    id: b.id,
    matchType: b.matchType,
    expiresAt: b.expiresAt?.toISOString() ?? null,
    permanent: b.permanent,
    reason: b.reason,
    createdAt: b.createdAt.toISOString(),
    createdBy: b.createdBy,
    revokedAt: b.revokedAt?.toISOString() ?? null,
    revokedBy: b.revokedBy,
  };
}
