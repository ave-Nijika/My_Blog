/**
 * /admin/posts
 *
 * 文章列表：支持 status 筛选、跳转到编辑/新建/状态切换/删除。
 * 服务端直接读 DB（requireAdmin 已确保登录），避免和客户端 fetcher 走两遍。
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { LogoutButton } from "../LogoutButton";
import { db } from "@/lib/db";
import { PostRowActions } from "./PostRowActions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Posts",
  robots: { index: false, follow: false },
};

type StatusFilter = "all" | "draft" | "public" | "private";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  public: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  private: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function asFilter(value: string | undefined): StatusFilter {
  if (value === "draft" || value === "public" || value === "private") return value;
  return "all";
}

export default async function AdminPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  // 后台双语（此前硬编码英文）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const a = (locale === "en" ? en : zh).admin;
  const t = a.postsSection;
  const STATUS_LABEL: Record<string, string> = {
    all: t.status.all,
    draft: t.status.draft,
    public: t.status.public,
    private: t.status.private,
  };
  const { status: rawStatus } = await searchParams;
  const status = asFilter(rawStatus);

  const where = status === "all" ? {} : { status };
  const posts = await db.article.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: { tags: { include: { tag: true } } },
  });
  const total = await db.article.count();

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Link href="/admin" className="hover:text-sky-600 dark:hover:text-sky-300">
              ← {a.postsSection.backToDashboard}
            </Link>
            <span>/</span>
            <span>{a.postsSection.title}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            {a.postsSection.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {a.postsSection.total.replace("{{total}}", String(total))} · {a.postsSection.filter}：{STATUS_LABEL[status]}{a.postsSection.filteredCount.replace("{{count}}", String(posts.length))}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/posts/new"
            className="ba-button-primary px-3 py-1.5 text-sm"
          >
            {a.postsSection.newPost}
          </Link>
          <LogoutButton />
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 text-sm">
        {(["all", "draft", "public", "private"] as StatusFilter[]).map((s) => {
          const active = s === status;
          return (
            <Link
              key={s}
              href={s === "all" ? "/admin/posts" : `/admin/posts?status=${s}`}
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
              <th className="px-4 py-3">{t.table.title}</th>
              <th className="px-4 py-3">{t.table.status}</th>
              <th className="px-4 py-3">{t.table.publishedAt}</th>
              <th className="px-4 py-3">{t.table.updatedAt}</th>
              <th className="px-4 py-3 text-right">{t.table.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {posts.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                >
                  {t.noPosts}{" "}
                  <Link
                    href="/admin/posts/new"
                    className="text-sky-600 hover:underline dark:text-sky-300"
                  >
                    {t.newPost}
                  </Link>
                </td>
              </tr>
            ) : (
              posts.map((post) => (
                <tr key={post.id} className="text-slate-700 dark:text-slate-200">
                  <td className="px-4 py-3">
                    <div className="font-medium">{post.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                        {post.slug}
                      </code>
                      {post.category ? (
                        <span className="ml-2">
                          {t.table.category}：<span className="text-slate-700 dark:text-slate-200">{post.category}</span>
                        </span>
                      ) : null}
                      {post.tags.length > 0 ? (
                        <span className="ml-2">
                          {t.table.tags}：
                          {post.tags.map((tag) => `#${tag.tag.name}`).join(" ")}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex rounded px-2 py-0.5 text-xs " +
                        (STATUS_BADGE[post.status] ?? STATUS_BADGE.draft)
                      }
                    >
                      {STATUS_LABEL[post.status] ?? post.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    {post.publishedAt
                      ? new Date(post.publishedAt).toLocaleDateString("en-US", {
                          timeZone: "Asia/Shanghai",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(post.updatedAt).toLocaleDateString("en-US", {
                        timeZone: "Asia/Shanghai",
                      })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PostRowActions postId={post.id} status={post.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}