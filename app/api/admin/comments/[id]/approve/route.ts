/**
 * /api/admin/comments/[id]/approve
 *
 * POST - 批准评论（status → approved, 记录 moderatedAt/moderatedBy）。
 *        走 wrap()：401 (权限) + 403 (CSRF)。
 */
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { getSession } from "@/lib/auth";
import { CommentNotFoundError, approveComment } from "@/lib/admin-comments";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST = wrap(
  async (
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const session = await getSession();
    if (!session) return jsonError(401, "未登录或会话已过期");

    const { id } = await ctx.params;
    try {
      const result = await approveComment(id, session.id);
      await logAudit({
        adminId: session.id,
        action: AUDIT_ACTIONS.COMMENT_APPROVE,
        targetType: "comment",
        targetId: result.id,
        metadata: { status: result.status },
      });
      return new Response(
        JSON.stringify({
          ok: true,
          id: result.id,
          status: result.status,
          moderatedAt: result.moderatedAt?.toISOString() ?? null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      if (error instanceof CommentNotFoundError) {
        return jsonError(404, error.message);
      }
      throw error;
    }
  }
);
