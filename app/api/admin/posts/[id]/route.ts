/**
 * /api/admin/posts/[id]
 *
 * GET    - 单篇详情（含正文）
 * PUT    - 更新文章（写 Markdown + Git commit + DB 同步）
 * DELETE - 删除文章（删文件 + Git commit + DB 同步）
 */
import { NextRequest } from "next/server";
import { getSession, requireAdminApi } from "@/lib/auth";
import { verifyCsrfToken } from "@/lib/csrf";
import {
  deletePost,
  getPost,
  PostConflictError,
  PostNotFoundError,
  PostValidationError,
  readPostBody,
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const { id } = await params;
  const post = await getPost(id);
  if (!post) {
    return jsonError(404, "文章不存在");
  }
  const body = await readPostBody(post.slug);
  return new Response(
    JSON.stringify({ post: { ...post, body } }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export async function PUT(
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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, "请求体格式错误");
  }

  try {
    const result = await updatePost(id, payload, session.id);
    await logAudit({
      adminId: session.id,
      action: AUDIT_ACTIONS.POST_UPDATE,
      targetType: "post",
      targetId: id,
      metadata: {
        slug: result.post.slug,
        status: result.post.status,
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
    if (error instanceof PostConflictError) {
      return jsonError(409, error.message);
    }
    if (error instanceof GitCommitError) {
      return jsonError(500, error.message, { code: error.code });
    }
    throw error;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {

  const csrfOk = await verifyCsrfToken(req);
  if (!csrfOk) return jsonError(403, "CSRF 验证失败");
  const session = await getSession();
  if (!session) return jsonError(401, "未登录或会话已过期");

  const { id } = await params;

  try {
    const result = await deletePost(id, session.id);
    await logAudit({
      adminId: session.id,
      action: AUDIT_ACTIONS.POST_DELETE,
      targetType: "post",
      targetId: id,
      metadata: {
        slug: result.slug,
        commitSha: result.commitSha,
        deletedArticleId: result.deletedArticleId,
      },
    });
    return new Response(
      JSON.stringify({
        ok: true,
        slug: result.slug,
        commitSha: result.commitSha,
        deletedArticleId: result.deletedArticleId,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    if (error instanceof PostNotFoundError) {
      return jsonError(404, error.message);
    }
    if (error instanceof GitCommitError) {
      return jsonError(500, error.message, { code: error.code });
    }
    throw error;
  }
}
