/**
 * /admin/comments
 *
 * 后台评论管理页：支持 status 筛选、分页、批准/拒绝/删除。
 * 服务端直接读 DB（requireAdmin 已确保登录），与 /admin/posts 一致。
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { LogoutButton } from "../LogoutButton";
import { listAdminComments } from "@/lib/admin-comments";
import { CommentRowActions } from "./CommentRowActions";
import { AdminDateTime } from "@/components/AdminDateTime";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Comments",
  robots: { index: false, follow: false },
};

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "deleted";



const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  deleted: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const VALID_STATUS: StatusFilter[] = [
  "all",
  "pending",
  "approved",
  "rejected",
  "deleted",
];



const AI_DECISION_BADGE: Record<string, string> = {
  approve: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  reject: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  review: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};



function asFilter(value: string | undefined): StatusFilter {
  if (VALID_STATUS.includes(value as StatusFilter)) {
    return value as StatusFilter;
  }
  return "all";
}

function renderAiCell(
  c: {
    aiDecision: string | null;
    aiCategory: string | null;
    aiReason: string | null;
    aiErrorCode: string | null;
  },
  label: Record<string, string>,
  category: Record<string, string>,
  aiFields: { category: string; reason: string },
  llmPrefix: string
) {
  if (c.aiDecision) {
    const badgeClass =
      AI_DECISION_BADGE[c.aiDecision] ??
      "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400";
    const label2 = label[c.aiDecision] ?? c.aiDecision;
    const category2 = c.aiCategory
      ? category[c.aiCategory] ?? c.aiCategory
      : null;
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className={`inline-flex w-fit rounded px-2 py-0.5 ${badgeClass}`}
        >
          {label2}
        </span>
        {category ? (
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            {aiFields.category}：{category2}
          </span>
        ) : null}
        {c.aiReason ? (
          <span
            className="max-w-[16rem] truncate text-[10px] text-slate-500 dark:text-slate-400"
            title={c.aiReason}
          >
            {aiFields.reason}：{c.aiReason}
          </span>
        ) : null}
      </div>
    );
  }
  if (c.aiErrorCode) {
    return (
      <span
        className="text-amber-600 dark:text-amber-300"
        title={`${llmPrefix} ${c.aiErrorCode}`}
      >
        {llmPrefix} {c.aiErrorCode}
      </span>
    );
  }
  return <span className="text-slate-400 dark:text-slate-500">—</span>;
}

function pageHref(
  scope: "normal" | "deleted",
  status: StatusFilter,
  page: number,
  perPage: number
): string {
  const params = new URLSearchParams();
  if (scope === "deleted") params.set("scope", "deleted");
  if (status !== "all") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  if (perPage !== 20) params.set("perPage", String(perPage));
  const q = params.toString();
  return q ? `/admin/comments?${q}` : "/admin/comments";
}

export default async function AdminCommentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    page?: string;
    perPage?: string;
    scope?: string;
  }>;
}) {
  await requireAdmin();
  // 后台双语（locale cookie SSR，与 dashboard 同款）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const a = (locale === "en" ? en : zh).admin;
  const t = a.commentsSection;
  const STATUS_LABEL: Record<string, string> = {
    all: t.status.all,
    pending: t.status.pending,
    approved: t.status.approved,
    rejected: t.status.rejected,
    deleted: t.status.deleted,
  };
  const { status: rawStatus, page: rawPage, perPage: rawPerPage, scope: rawScope } =
    await searchParams;
  const status = asFilter(rawStatus);
  const scope = rawScope === "deleted" ? "deleted" : "normal";
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, Number.parseInt(rawPerPage ?? "20", 10) || 20)
  );

  const result = await listAdminComments({ status, scope, page, perPage });
  const totalPages = Math.max(1, Math.ceil(result.total / perPage));

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Link href="/admin" className="hover:text-sky-600 dark:hover:text-sky-300">
              ← {a.commentsSection.backToDashboard}
            </Link>
            <span>/</span>
            <span>{a.commentsSection.title}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            {a.commentsSection.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {a.commentsSection.total.replace("{{total}}", String(result.total))} · {a.commentsSection.filter}：{STATUS_LABEL[status]}{a.commentsSection.filteredCount.replace("{{count}}", String(result.items.length))}
          </p>
        </div>
        <LogoutButton />
      </header>

      {/* scope 标签页：正常评论 / 已删文章评论 */}
      <nav className="flex flex-wrap gap-2 text-sm">
        {([["normal", t.scopeNormal], ["deleted", t.scopeDeleted]] as const).map(
          ([key, label]) => {
            const active = scope === key;
            return (
              <Link
                key={key}
                href={
                  key === "normal"
                    ? status === "all"
                      ? "/admin/comments"
                      : `/admin/comments?status=${status}`
                    : status === "all"
                      ? "/admin/comments?scope=deleted"
                      : `/admin/comments?scope=deleted&status=${status}`
                }
                className={
                  "rounded-md border px-3 py-1.5 transition-colors " +
                  (active
                    ? "border-[rgb(var(--ba-primary))] bg-[color:rgb(var(--ba-primary-soft))] text-[color:rgb(var(--ba-primary))] dark:text-sky-200"
                    : "border-slate-200 text-slate-600 hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-sky-700 dark:hover:text-sky-300")
                }
              >
                {label}
              </Link>
            );
          }
        )}
      </nav>

      <nav className="flex flex-wrap gap-2 text-sm">
        {VALID_STATUS.map((s) => {
          const active = s === status;
          return (
            <Link
              key={s}
              href={pageHref(scope, s, 1, perPage)}
              className={
                "rounded-md border px-3 py-1.5 transition-colors " +
                (active
                  ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-200"
                  : "border-slate-200 text-slate-600 hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-sky-700 dark:hover:text-sky-300")
              }
            >
              {STATUS_LABEL[s]}
            </Link>
          );
        })}
      </nav>

      <section className="overflow-x-auto ba-card">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">{t.table.content}</th>
              <th className="px-4 py-3">{t.table.article}</th>
              <th className="px-4 py-3">{t.table.status}</th>
              <th className="px-4 py-3">{t.table.aiReview}</th>
              <th className="px-4 py-3">{t.table.submittedAt}</th>
              <th className="px-4 py-3 text-right">{t.table.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {result.items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                >
                  {t.noComments}
                </td>
              </tr>
            ) : (
              result.items.map((c) => (
                <tr key={c.id} className="align-top text-slate-700 dark:text-slate-200">
                  <td className="px-4 py-3">
                    <div className="whitespace-pre-wrap break-words">
                      {c.bodyText}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      id: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{c.id}</code>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.isFromDeletedArticle ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-slate-700 dark:text-slate-200">
                          {c.deletedArticleTitle || "—"}
                        </span>
                        <span className="inline-flex rounded bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                          {t.deletedArticleBadge}
                        </span>
                      </div>
                    ) : c.articleSlug ? (
                      <Link
                        href={`/posts/${c.articleSlug}`}
                        className="text-sky-600 hover:underline dark:text-sky-300"
                      >
                        {c.articleTitle || c.articleSlug}
                      </Link>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex rounded px-2 py-0.5 text-xs " +
                        (STATUS_BADGE[c.status] ??
                          "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400")
                      }
                    >
                      {c.deletedAt
                        ? t.status.deleted
                        : STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {renderAiCell(c, t.aiDecision, t.aiCategory, t.aiFields, t.llmPrefix)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    <AdminDateTime value={c.createdAt} />
                    {c.moderatedAt ? (
                      <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                        {t.moderation}：<AdminDateTime value={c.moderatedAt} />
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <CommentRowActions
                      commentId={c.id}
                      status={c.status}
                      deletedAt={c.deletedAt}
                      variant={c.isFromDeletedArticle ? "deleted" : "normal"}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <div>
            {a.pagination.pageOf.replace("{{page}}", String(page)).replace("{{total}}", String(totalPages))}
          </div>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={pageHref(scope, status, page - 1, perPage)}
                className="rounded-md border border-slate-300 px-3 py-1 transition-colors hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:hover:border-sky-700 dark:hover:text-sky-300"
              >
                {a.pagination.prev}
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={pageHref(scope, status, page + 1, perPage)}
                className="rounded-md border border-slate-300 px-3 py-1 transition-colors hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:hover:border-sky-700 dark:hover:text-sky-300"
              >
                {a.pagination.next}
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}