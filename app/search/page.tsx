import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { searchArticles, countSearchResults } from "@/lib/queries";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { Reveal } from "@/components/Reveal";
import { PostRow } from "@/components/PostRow";

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

  if (!query) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <Reveal translateY={10} className="relative inline-block">
          <span className="ba-tri absolute -left-5 -top-1 h-3 w-3.5 opacity-90" aria-hidden />
          <h1 className="ba-font-round text-3xl text-[color:rgb(var(--ba-primary))]">
            {t.page.searchTitle}
          </h1>
        </Reveal>
        <Reveal delay={80} className="mt-3">
          <span className="ba-pill ba-pill--soft">{t.page.searchHint}</span>
        </Reveal>
        <Reveal translateY={12} delay={120} className="mt-10">
          <div className="ba-card flex flex-col items-center gap-4 p-12 text-center">
            <span className="ba-tri h-9 w-11 opacity-70" aria-hidden />
            <h3 className="ba-font-round text-lg font-semibold text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
              {t.page.searchTitle}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-sm:text-sm">
              {t.page.searchEmptyHint}
            </p>
          </div>
        </Reveal>
      </div>
    );
  }

  if (query.length > 100) {
    notFound();
  }

  const [result, totalCount] = await Promise.all([
    searchArticles(query, page, perPage),
    countSearchResults(query),
  ]);

  const totalPages = Math.ceil(totalCount / perPage);

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
          {t.page.searchResultsFor.replace("{{query}}", query)}
        </h1>
      </Reveal>
      <Reveal delay={80} className="mt-3">
        <span className="ba-pill ba-pill--soft">
          {t.page.searchFound.replace("{{count}}", String(totalCount))}
        </span>
      </Reveal>

      {result.articles.length === 0 ? (
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
      ) : (
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
                <PostRow post={post} pinnedLabel={t.news.pinned} showSummary showTags />
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
    </div>
  );
}
