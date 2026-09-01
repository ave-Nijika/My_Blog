/**
 * /api/admin/posts
 *
 * GET  - 文章列表（支持 ?status=draft|public|private&page=1&perPage=20）
 * POST - 创建文章（写 Markdown + Git commit + DB 同步）
 *
 * 全部走 requireAdminApi 守卫，未登录 401。
 */
import { NextRequest } from "next/server";
import { getSession, requireAdminApi } from "@/lib/auth";
import { verifyCsrfToken } from "@/lib/csrf";
import {
  createPost,
  listPosts,
  PostConflictError,
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

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1000);
  const perPage = parsePositiveInt(url.searchParams.get("perPage"), 20, 100);

  const result = await listPosts({ status, page, perPage });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const csrfOk = await verifyCsrfToken(req);
  if (!csrfOk) return jsonError(403, "CSRF 验证失败");
  const session = await getSession();
  if (!session) return jsonError(401, "未登录或会话已过期");

    const { createPostSchema } = await import("@/lib/validation");
    let input;
    try {
      const raw = await req.json();
      input = createPostSchema.parse(raw);
    } catch {
      return jsonError(400, "请求体格式错误");
    }

  try {
    const result = await createPost(input, session.id);
    await logAudit({
      adminId: session.id,
      action: AUDIT_ACTIONS.POST_CREATE,
      targetType: "post",
      targetId: result.post.id,
      metadata: {
        slug: result.post.slug,
        status: result.post.status,
        commitSha: result.commitSha,
      },
    });
    return new Response(
      JSON.stringify({ ok: true, post: result.post, commitSha: result.commitSha }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    if (error instanceof PostConflictError) {
      return jsonError(409, error.message);
    }
    if (error instanceof GitCommitError) {
      return jsonError(500, error.message, { code: error.code });
    }
    throw error;
  }
}
