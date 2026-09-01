/**
 * /api/admin/visitors/ban
 *
 * POST - 管理员手动封禁。
 * Body: {
 *   ipHmac, visitorTokenHash, matchType: 'ip'|'visitor',
 *   reason, permanent, durationSeconds?
 * }
 */
import { z, ZodError } from "zod";
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { getSession } from "@/lib/auth";
import { createAdminBan } from "@/lib/visitor";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  ipHmac: z.string().min(1).max(128),
  visitorTokenHash: z.string().max(128).optional().default(""),
  matchType: z.enum(["ip", "visitor"], {
    errorMap: () => ({ message: "matchType 必须是 ip/visitor" }),
  }),
  reason: z.string().min(1, { message: "原因不能为空" }).max(500),
  permanent: z.boolean().optional().default(false),
  durationSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
});

function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST = wrap(async (req: NextRequest) => {
  const session = await getSession();
  if (!session) return jsonError(401, "未登录或会话已过期");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "请求体不是合法 JSON");
  }
  let data: z.infer<typeof schema>;
  try {
    data = schema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      return jsonError(400, e.issues[0]?.message ?? "参数错误");
    }
    throw e;
  }
  const ban = await createAdminBan({
    ipHmac: data.ipHmac,
    visitorTokenHash: data.visitorTokenHash,
    matchType: data.matchType,
    reason: data.reason,
    permanent: data.permanent,
    adminId: session.id,
    durationSeconds: data.durationSeconds,
  });
  await logAudit({
    adminId: session.id,
    action: AUDIT_ACTIONS.VISITOR_BAN,
    targetType: "visitor",
    targetId: ban.id,
    metadata: {
      matchType: data.matchType,
      permanent: data.permanent,
      reason: data.reason,
    },
  });
  return jsonOk({
    ok: true,
    ban: {
      id: ban.id,
      matchType: ban.matchType,
      expiresAt: ban.expiresAt?.toISOString() ?? null,
      permanent: ban.permanent,
      reason: ban.reason,
      createdAt: ban.createdAt.toISOString(),
      createdBy: ban.createdBy,
    },
  });
});
