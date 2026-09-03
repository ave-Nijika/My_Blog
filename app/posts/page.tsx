import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  countPublicArticles,
  getPublicArticles,
  getPublicArticlesPage,
  type ArticleWithTags,
} from "@/lib/queries";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { Reveal } from "@/components/Reveal";
import { PostRow } from "@/components/PostRow";

export const metadata: Metadata = {
  title: "Posts",
};

const PER_PAGE = 10;

function resolvePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  if (Number.isNaN(n) || n < 1) return 1;
  return n;
}

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string }>;
}) {
  // 与 layout 同款 SSR 读 cookie（双语一致红线）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const t = locale === "en" ? en : zh;

  const { page: rawPage, category: rawCategory } = await searchParams;
  const page = resolvePage(rawPage);

  // 分类聚合（与 GET /api/posts/categories 同一查询）：数据来自 DB 中公开
  // 文章实际用到的分类，实时无缓存——新建/删除/改分类后 chip 自然增减
  const categoryRows = await db.article.groupBy({
    by: ["category"],
    where: { status: "public", category: { not: "" } },
    _count: { category: true },
    orderBy: [{ _count: { category: "desc" } }, { category: "asc" }],
  });
  const categories = categoryRows.map((r) => ({
    name: r.category,
    count: r._count.category,
  }));
  // URL 里的分类已不存在（文章全删/改分类后的旧链接）时按"全部"处理
  const requestedCategory = (rawCategory ?? "").trim();
  const activeCategory = categories.some((c) => c.name === requestedCategory)
    ? requestedCategory
    : "";

  let visiblePosts: ArticleWithTags[];
  let total: number;
  let totalPages: number;
  let safePage: number;

  if (activeCategory) {
    // 选中分类：公开文章内存过滤 + 分页（博客量级小，等价于查询过滤；
    // 不动 lib/queries 既有函数签名）
    const all = await getPublicArticles();
    const filtered = all.filter((p) => p.category === activeCategory);
    total = filtered.length;
    totalPages = Math.max(Math.ceil(total / PER_PAGE), 1);
    safePage = Math.min(page, totalPages);
    visiblePosts = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  } else {
    const [posts, count] = await Promise.all([
      getPublicArticlesPage(page, PER_PAGE),
      countPublicArticles(),
    ]);
    totalPages = Math.max(Math.ceil(count / PER_PAGE), 1);
    safePage = Math.min(page, totalPages);
    visiblePosts =
      safePage === page ? posts : await getPublicArticlesPage(safePage, PER_PAGE);
    total = count;
  }

  const pageHref = (p: number) =>
    activeCategory
      ? `/posts?page=${p}&category=${encodeURIComponent(activeCategory)}`
      : `/posts?page=${p}`;

  return (
    <div className="relative mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <span
        className="ba-outline-text pointer-events-none absolute -top-2 right-0 hidden text-[84px] opacity-[0.14] sm:block"
        aria-hidden
      >
        POSTS
      </span>

      {/* 区头：黄三角点缀的圆体标题 + 计数 pill（官网社团快讯区头同构） */}
      <Reveal className="relative inline-block">
        <span className="ba-tri absolute -left-5 -top-1 h-3 w-3.5 opacity-90" aria-hidden />
        <h1 className="ba-font-round text-3xl text-[color:rgb(var(--ba-primary))]">
          {t.common.posts}
        </h1>
      </Reveal>
      <Reveal delay={80} className="mt-3 flex flex-wrap items-center gap-3">
        <span className="ba-pill ba-pill--soft">
          {t.common.total.replace("{{total}}", String(total))}
        </span>

        {/* 文章快搜：回车跳既有 /search 路由（复用现有搜索，不另起逻辑） */}
        <form action="/search" method="get" className="flex items-center gap-2">
          <input
            type="search"
            name="q"
            maxLength={100}
            placeholder={t.common.searchPlaceholder}
            aria-label={t.common.search}
            className="w-52 rounded-full border border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--color-surface))] px-4 py-1.5 text-sm text-[color:rgb(var(--color-text-primary))] outline-none transition focus:border-[rgb(var(--ba-primary))] focus:ring-2 focus:ring-[rgb(var(--ba-primary))]/25 max-sm:w-40 max-sm:text-sm"
          />
          <button
            type="submit"
            className="ba-btn px-4 py-1.5 text-xs"
          >
            {t.common.search}
          </button>
        </form>
      </Reveal>

      {/* 分类 chip 栏：数据实时来自公开文章实际用到的分类（文章数降序），
          点击筛选、再次点击当前分类取消；分类全空时整栏不显示 */}
      {categories.length > 0 ? (
        <Reveal delay={120} className="mt-5">
          <nav
            aria-label={t.common.categories}
            className="flex flex-wrap items-center gap-2"
          >
            {categories.map((c) => {
              const active = c.name === activeCategory;
              return (
                <Link
                  key={c.name}
                  href={
                    active
                      ? "/posts"
                      : `/posts?category=${encodeURIComponent(c.name)}`
                  }
                  aria-current={active ? "page" : undefined}
                  className={
                    "inline-flex items-center rounded-full border px-3.5 py-1 text-xs transition-colors max-sm:text-sm " +
                    (active
                      ? "ba-category-chip-active border-transparent bg-[rgb(var(--ba-primary))] text-white shadow-[0_3px_10px_rgba(18,137,249,0.35)]"
                      : "border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--color-surface))] text-[color:rgb(var(--color-text-primary))] hover:border-[rgb(var(--ba-primary))]/45 hover:text-[color:rgb(var(--ba-primary))]")
                  }
                >
                  {c.name}
                  <span className="ml-1.5 opacity-70">{c.count}</span>
                </Link>
              );
            })}
          </nav>
        </Reveal>
      ) : null}

      {visiblePosts.length === 0 ? (
        <Reveal className="mt-12">
          <p className="ba-card px-8 py-14 text-center text-sm text-slate-500 dark:text-slate-400">
            {t.news.empty}
          </p>
        </Reveal>
      ) : (
        <>
          <ul className="mt-6 border-t border-[color:rgb(var(--ba-line))]">
            {visiblePosts.map((post, index) => (
              <Reveal
                as="div"
                key={post.slug}
                delay={index * 50}
                translateY={12}
                className="list-none"
              >
                <PostRow
                  post={post}
                  pinnedLabel={t.news.pinned}
                  showSummary
                  showTags
                />
              </Reveal>
            ))}
          </ul>

          {totalPages > 1 && (
            <Reveal delay={100}>
              <nav className="mt-10 flex items-center justify-center gap-5">
                {safePage > 1 ? (
                  <Link
                    href={pageHref(safePage - 1)}
                    className="ba-btn transition-all duration-200 hover:-translate-y-0.5"
                  >
                    {t.common.prev}
                  </Link>
                ) : (
                  <span className="ba-btn cursor-not-allowed opacity-45">{t.common.prev}</span>
                )}

                {/* 官网页码：展示体数字 */}
                <span
                  className="ba-font-display text-sm tracking-[0.18em] text-[color:rgb(var(--ba-primary))]"
                  aria-current="page"
                >
                  {String(safePage).padStart(2, "0")}
                  <span className="mx-1.5 text-slate-400">/</span>
                  <span className="text-slate-400">{String(totalPages).padStart(2, "0")}</span>
                </span>

                {safePage < totalPages ? (
                  <Link
                    href={pageHref(safePage + 1)}
                    className="ba-btn transition-all duration-200 hover:-translate-y-0.5"
                  >
                    {t.common.next}
                  </Link>
                ) : (
                  <span className="ba-btn cursor-not-allowed opacity-45">{t.common.next}</span>
                )}
              </nav>
            </Reveal>
          )}
        </>
      )}
    </div>
  );
}
