/**
 * /api/admin/comments/[id]
 *
 * DELETE - 软删除评论（deletedAt = now）。
 *          走 wrap() 统一处理：401 (权限) + 403 (CSRF) + 异常 500。
 */
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { getSession } from "@/lib/auth";
import { CommentNotFoundError, deleteComment } from "@/lib/admin-comments";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const DELETE = wrap(
  async (
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const session = await getSession();
    if (!session) return jsonError(401, "未登录或会话已过期");

    const { id } = await ctx.params;
    try {
      const result = await deleteComment(id);
      await logAudit({
        adminId: session.id,
        action: AUDIT_ACTIONS.COMMENT_DELETE,
        targetType: "comment",
        targetId: result.id,
      });
      return new Response(
        JSON.stringify({
          ok: true,
          id: result.id,
          deletedAt: result.deletedAt?.toISOString() ?? null,
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
