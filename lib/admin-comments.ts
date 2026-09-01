/**
 * 管理员评论操作（lib/admin-comments.ts）。
 *
 * 范围（M3a）：
 *   - listAdminComments: 列表 + status 筛选 + 分页
 *   - approveComment:    status=approved, 记录 moderatedAt/moderatedBy
 *   - rejectComment:     status=rejected, 记录 moderatedAt/moderatedBy
 *   - deleteComment:     软删除 (deletedAt = now)
 *
 * 任何操作对不存在的 ID 抛 CommentNotFoundError，路由层映射为 404。
 */
import { db } from "./db";
import { revalidatePath } from "next/cache";

export class CommentNotFoundError extends Error {
  constructor(id: string) {
    super(`评论不存在：${id}`);
    this.name = "CommentNotFoundError";
  }
}

export type AdminCommentStatus = "pending" | "approved" | "rejected" | "deleted";

export interface AdminCommentListItem {
  id: string;
  articleId: string;
  articleSlug: string;
  articleTitle: string;
  bodyText: string;
  status: string;
  warningApplied: number;
  createdAt: string;
  moderatedAt: string | null;
  moderatedBy: string | null;
  deletedAt: string | null;
  aiDecision: string | null;
  aiCategory: string | null;
  aiReason: string | null;
  aiErrorCode: string | null;
}

export interface AdminCommentListResult {
  items: AdminCommentListItem[];
  total: number;
  page: number;
  perPage: number;
}

export interface AdminCommentListParams {
  status?: string;
  page: number;
  perPage: number;
}

const ALLOWED_STATUS = new Set(["pending", "approved", "rejected", "deleted"]);

function asAdminStatus(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (v === "all") return undefined;
  if (!ALLOWED_STATUS.has(v)) return undefined;
  return v;
}

/**
 * 把 "deleted" 状态映射到 deletedAt IS NOT NULL 查询。
 * 其它状态按 status 字段过滤。
 */
function buildStatusWhere(raw: string | undefined) {
  const s = asAdminStatus(raw);
  if (!s) return {};
  if (s === "deleted") {
    return { deletedAt: { not: null } } as const;
  }
  return { status: s, deletedAt: null } as const;
}

export async function listAdminComments(
  params: AdminCommentListParams
): Promise<AdminCommentListResult> {
  const where = buildStatusWhere(params.status);
  const skip = Math.max((params.page - 1) * params.perPage, 0);
  const take = params.perPage;

  const [rows, total] = await Promise.all([
    db.comment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        article: { select: { slug: true, title: true } },
      },
    }),
    db.comment.count({ where }),
  ]);

  const items: AdminCommentListItem[] = rows.map((r) => ({
    id: r.id,
    articleId: r.articleId,
    articleSlug: r.article?.slug ?? "",
    articleTitle: r.article?.title ?? "",
    bodyText: r.bodyText,
    status: r.status,
    warningApplied: r.warningApplied,
    createdAt: r.createdAt.toISOString(),
    moderatedAt: r.moderatedAt ? r.moderatedAt.toISOString() : null,
    moderatedBy: r.moderatedBy ?? null,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    aiDecision: r.aiDecision ?? null,
    aiCategory: r.aiCategory ?? null,
    aiReason: r.aiReason ?? null,
    aiErrorCode: r.aiErrorCode ?? null,
  }));

  return {
    items,
    total,
    page: params.page,
    perPage: params.perPage,
  };
}

export async function getAdminComment(id: string) {
  return db.comment.findUnique({
    where: { id },
    include: { article: { select: { slug: true, title: true } } },
  });
}

/** 审核动作后失效对应文章页缓存（评论列表内嵌在文章页中）。 */
async function revalidateArticlePage(commentId: string): Promise<void> {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: { article: { select: { slug: true } } },
  });
  if (comment?.article?.slug) {
    revalidatePath(`/posts/${comment.article.slug}`);
  }
}

export async function approveComment(id: string, adminId: string) {
  const existing = await db.comment.findUnique({ where: { id } });
  if (!existing) throw new CommentNotFoundError(id);
  const result = await db.comment.update({
    where: { id },
    data: {
      status: "approved",
      moderatedAt: new Date(),
      moderatedBy: adminId,
      deletedAt: null,
    },
  });
  await revalidateArticlePage(id);
  return result;
}

export async function rejectComment(id: string, adminId: string) {
  const existing = await db.comment.findUnique({ where: { id } });
  if (!existing) throw new CommentNotFoundError(id);
  const result = await db.comment.update({
    where: { id },
    data: {
      status: "rejected",
      moderatedAt: new Date(),
      moderatedBy: adminId,
    },
  });
  await revalidateArticlePage(id);
  return result;
}

export async function deleteComment(id: string) {
  const existing = await db.comment.findUnique({ where: { id } });
  if (!existing) throw new CommentNotFoundError(id);
  const result = await db.comment.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await revalidateArticlePage(id);
  return result;
}
