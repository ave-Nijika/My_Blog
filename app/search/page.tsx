import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { searchArticles } from "@/lib/queries";
import { splitQuery } from "@/lib/search";
import { getClientIp } from "@/lib/client-ip";
import { tryConsumeSearch } from "@/lib/rate-limit";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { Reveal } from "@/components/Reveal";
import { SearchResultRow } from "@/components/SearchResultRow";

export async function generateMetadata({
  searchParams,
}: PageProps<"/search"> & {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const searchParamsPromise = await searchParams;
  const query = searchParamsPromise.q || "";

  if (!query) {
    return {
      title: "Search",
      description: "Search posts",
    };
  }

  return {
    title: `Search results: ${query}`,
    description: `Results for "${query}"`,
  };
}

export default async function SearchPage({
  searchParams,
}: PageProps<"/search"> & {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  // 与 layout 同款 SSR 读 cookie（双语一致红线）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const t = locale === "en" ? en : zh;

  const searchParamsPromise = await searchParams;
  const query = searchParamsPromise.q || "";
  const page = Number(searchParamsPromise.page) || 1;
  const perPage = 10;

  // 仅当有 q 时才消耗搜索额度；无 q 页面不查库，不计入限流（安全审查 P1.10）
  const rateLimited =
    query.length > 0 &&
    !tryConsumeSearch(getClientIp({ headers: await headers() })).allowed;

  if (query.length > 100) {
    notFound();
  }

  // 无 q 参数时不查库：仅渲染常驻搜索框与引导文案（修复需求 4.3）
  const result = query && !rateLimited
    ? await searchArticles(query, page, perPage)
    : { articles: [], totalCount: 0, snippets: {} as Record<string, string> };
  const totalCount = result.totalCount;

  const totalPages = Math.ceil(totalCount / perPage);
  const searchTokens = splitQuery(query);

  return (
    <div className="relative mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <span
        className="ba-outline-text pointer-events-none absolute -top-2 right-0 hidden text-[84px] opacity-[0.14] sm:block"
        aria-hidden
      >
        SEARCH
      </span>

      <Reveal translateY={10} className="relative inline-block">
        <span className="ba-tri absolute -left-5 -top-1 h-3 w-3.5 opacity-90" aria-hidden />
        <h1 className="ba-font-round text-3xl text-[color:rgb(var(--ba-primary))]">
          {query
            ? t.page.searchResultsFor.replace("{{query}}", query)
            : t.page.searchTitle}
        </h1>
      </Reveal>

      {/* 搜索框常驻（修复需求 4.3）：无论有无 q 参数都可在此输入新关键词回车搜索 */}
      <Reveal delay={80} className="mt-5">
        <form action="/search" method="get" className="flex items-center gap-2">
          <input
            type="search"
            name="q"
            maxLength={100}
            defaultValue={query}
            placeholder={t.common.searchPlaceholder}
            aria-label={t.common.search}
            className="w-full max-w-md rounded-full border border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--color-surface))] px-4 py-2 text-sm text-[color:rgb(var(--color-text-primary))] outline-none transition focus:border-[rgb(var(--ba-primary))] focus:ring-2 focus:ring-[rgb(var(--ba-primary))]/25 max-sm:text-sm"
          />
          <button type="submit" className="ba-btn ba-btn-primary px-5 py-2 text-xs">
            {t.common.search}
          </button>
        </form>
      </Reveal>

      <Reveal delay={120} className="mt-4">
        <span className="ba-pill ba-pill--soft">
          {query
            ? t.page.searchFound.replace("{{count}}", String(totalCount))
            : t.page.searchHint}
        </span>
      </Reveal>

      {/* 搜索限流提示（安全审查 P1.10）：SSR 直接渲染，替代误导性的空结果 */}
      {rateLimited && (
        <Reveal className="mt-6">
          <div
            data-testid="search-rate-limited"
            className="ba-card flex items-center gap-3 p-6 text-sm text-slate-600 dark:text-slate-400"
          >
            <span className="ba-tri h-4 w-5" aria-hidden />
            <span>{t.page.searchRateLimited}</span>
          </div>
        </Reveal>
      )}

      {query && !rateLimited && result.articles.length === 0 && (
        <Reveal className="mt-10">
          <div className="ba-card flex flex-col items-center gap-4 p-12 text-center">
            <span className="ba-tri h-9 w-11 rotate-180 opacity-70" aria-hidden />
            <h3 className="ba-font-round text-lg font-semibold text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
              {t.page.searchNoResult}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-sm:text-sm">
              {t.page.searchNoResultHint}
            </p>
            <Link href="/search" className="ba-btn ba-btn-primary px-5 py-1.5 text-xs">
              {t.page.searchAgain}
            </Link>
          </div>
        </Reveal>
      )}

      {query && result.articles.length > 0 && (
        <>
          <ul className="mt-6 border-t border-[color:rgb(var(--ba-line))]">
            {result.articles.map((post, index) => (
              <Reveal
                as="div"
                key={post.slug}
                delay={index * 50}
                translateY={12}
                className="list-none"
              >
                <SearchResultRow
                  post={post}
                  snippet={result.snippets[post.id]}
                  tokens={searchTokens}
                  pinnedLabel={t.news.pinned}
                  snippetLabel={t.page.searchSnippetLabel}
                />
              </Reveal>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="mt-8 flex justify-center gap-2">
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pageNum = i + 1;
                return (
                  <Link
                    key={pageNum}
                    href={`/search?q=${encodeURIComponent(query)}&page=${pageNum}`}
                    aria-current={pageNum === page ? "page" : undefined}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm font-medium transition-all duration-200 max-sm:text-sm ${
                      pageNum === page
                        ? "border-transparent bg-[rgb(var(--ba-primary))] text-white shadow-[0_3px_10px_rgba(18,137,249,0.35)]"
                        : "border-[rgb(var(--ba-primary))]/45 bg-[color:rgb(var(--color-surface))] text-[color:rgb(var(--ba-primary))] hover:-translate-y-0.5"
                    }`}
                  >
                    {pageNum}
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}

      {!query && (
        <Reveal translateY={12} delay={160} className="mt-10">
          <div className="ba-card flex flex-col items-center gap-4 p-12 text-center">
            <span className="ba-tri h-9 w-11 opacity-70" aria-hidden />
            <p className="text-sm text-slate-600 dark:text-slate-400 max-sm:text-sm">
              {t.page.searchEmptyHint}
            </p>
          </div>
        </Reveal>
      )}
    </div>
  );
}
