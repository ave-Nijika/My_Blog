/**
 * /api/admin/posts/[id]/publish
 *
 * 把文章从 draft → public。
 * - 仍然走"写文件 + Git 提交 + 同步"链路，保证规格 6.6 的一致性。
 * - 若 status 已是 public，直接返回 200 + 当前 post，不重复提交。
 */
import { NextRequest } from "next/server";
import { getSession, requireAdminApi } from "@/lib/auth";
import { verifyCsrfToken } from "@/lib/csrf";
import {
  getPost,
  PostNotFoundError,
  PostValidationError,
  updatePost,
} from "@/lib/admin-posts";
import { GitCommitError } from "@/lib/content-git";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ error, ...(extra ?? {}) }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const csrfOk = await verifyCsrfToken(req);
  if (!csrfOk) return jsonError(403, "CSRF 验证失败");
  const session = await getSession();
  if (!session) return jsonError(401, "未登录或会话已过期");

  const { id } = await params;
  const existing = await getPost(id);
  if (!existing) {
    return jsonError(404, "文章不存在");
  }
  if (existing.status === "public") {
    return new Response(
      JSON.stringify({ ok: true, post: existing, commitSha: "", changed: false }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const result = await updatePost(
      id,
      {
        slug: existing.slug,
        title: existing.title,
        summary: existing.summary,
        status: "public",
        category: existing.category,
        cover: existing.cover,
        pinned: existing.pinned,
        publishedAt: existing.publishedAt
          ? existing.publishedAt.toISOString()
          : new Date().toISOString(),
        tags: existing.tags,
      },
      session.id
    );
    await logAudit({
      adminId: session.id,
      action: AUDIT_ACTIONS.POST_PUBLISH,
      targetType: "post",
      targetId: id,
      metadata: {
        slug: result.post.slug,
        commitSha: result.commitSha,
        changed: result.changed,
      },
    });
    return new Response(
      JSON.stringify({
        ok: true,
        post: result.post,
        commitSha: result.commitSha,
        changed: result.changed,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    if (error instanceof PostValidationError) {
      return jsonError(400, error.message, { field: error.field });
    }
    if (error instanceof PostNotFoundError) {
      return jsonError(404, error.message);
    }
    if (error instanceof GitCommitError) {
      return jsonError(500, error.message, { code: error.code });
    }
    throw error;
  }
}
