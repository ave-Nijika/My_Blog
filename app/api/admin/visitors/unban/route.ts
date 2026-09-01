/**
 * /api/admin/visitors/unban
 *
 * POST - 解除封禁。
 * Body: { banId: string }
 */
import { z, ZodError } from "zod";
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { getSession } from "@/lib/auth";
import { revokeBan } from "@/lib/visitor";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  banId: z.string().min(1, { message: "banId 不能为空" }),
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
  try {
    const ban = await revokeBan(data.banId, session.id);
    await logAudit({
      adminId: session.id,
      action: AUDIT_ACTIONS.VISITOR_UNBAN,
      targetType: "visitor",
      targetId: ban.id,
    });
    return jsonOk({
      ok: true,
      ban: {
        id: ban.id,
        revokedAt: ban.revokedAt?.toISOString() ?? null,
        revokedBy: ban.revokedBy,
      },
    });
  } catch (e) {
    if (e instanceof Error) {
      return jsonError(404, e.message);
    }
    throw e;
  }
});
