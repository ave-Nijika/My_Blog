/**
 * /api/admin/deleted-comments/[id]
 *
 * DELETE - 物理删除一条"已删文章评论"存档（DeletedComment 行真删）。
 *          与正常评论的软删除（/api/admin/comments/[id]）语义不同：
 *          存档评论只支持删除与查看，不支持审核（文章已删，审核无意义）。
 */
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { getSession } from "@/lib/auth";
import { CommentNotFoundError, deleteArchivedComment } from "@/lib/admin-comments";
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
      const existing = await deleteArchivedComment(id);
      await logAudit({
        adminId: session.id,
        action: AUDIT_ACTIONS.DELETED_COMMENT_DELETE,
        targetType: "deleted_comment",
        targetId: id,
        metadata: { originalCommentId: existing.originalId },
      });
      return new Response(
        JSON.stringify({ ok: true, id }),
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
