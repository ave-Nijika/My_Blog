/**
 * /api/admin/visitors/warn
 *
 * POST - 管理员手动给一个访客增加警告。
 * Body: { ipHmac: string, visitorTokenHash?: string, delta?: number, reason?: string }
 */
import { z, ZodError } from "zod";
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { getSession } from "@/lib/auth";
import { applyWarning } from "@/lib/visitor";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  ipHmac: z.string().min(1, { message: "ipHmac 不能为空" }).max(128),
  visitorTokenHash: z.string().max(128).optional().default(""),
  delta: z.number().int().min(1).max(10).optional().default(1),
  reason: z.string().max(500).optional().default(""),
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
  const result = await applyWarning({
    ipHmac: data.ipHmac,
    visitorTokenHash: data.visitorTokenHash,
    delta: data.delta,
    source: "admin",
    adminId: session.id,
    reason: data.reason,
  });
  await logAudit({
    adminId: session.id,
    action: AUDIT_ACTIONS.VISITOR_WARN,
    targetType: "visitor",
    targetId: data.ipHmac,
    metadata: {
      delta: data.delta,
      reason: data.reason,
      warningCount: result.warningCount,
      autoBanned: result.banned,
    },
  });
  return jsonOk({
    ok: true,
    warningCount: result.warningCount,
    banned: result.banned,
    banId: result.banId ?? null,
  });
});
