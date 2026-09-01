import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { getArticlesByCategorySlug, countArticlesByCategorySlug } from "@/lib/queries";
import { getAllCategories } from "@/lib/queries";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { Reveal } from "@/components/Reveal";
import { PostRow } from "@/components/PostRow";

export async function generateMetadata({
  params,
}: PageProps<"/categories/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const categories = await getAllCategories();
  const category = categories.find((c) => c.slug === slug);

  if (!category) {
    return {};
  }

  return {
    title: `Category: ${category.name}`,
    description: `Posts in category "${category.name}" (${category._count.articles} posts)`,
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps<"/categories/[slug]"> & {
  searchParams: Promise<{ page?: string }>;
}) {
  // 与 layout 同款 SSR 读 cookie（双语一致红线）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const t = locale === "en" ? en : zh;

  const { slug } = await params;
  const searchParamsPromise = await searchParams;
  const page = Number(searchParamsPromise.page) || 1;
  const perPage = 10;

  const [category, articles, totalCount] = await Promise.all([
    getAllCategories().then((categories) => categories.find((c) => c.slug === slug)),
    getArticlesByCategorySlug(slug, page, perPage),
    countArticlesByCategorySlug(slug),
  ]);

  if (!category) {
    notFound();
  }

  const totalPages = Math.ceil(totalCount / perPage);

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <Reveal translateY={10}>
        <nav className="mb-4 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 max-sm:text-sm">
          <Link href="/categories" className="transition-colors hover:text-[color:rgb(var(--ba-primary))]">
            {t.common.categories}
          </Link>
          <span aria-hidden>/</span>
          <span className="text-[color:rgb(var(--ba-primary))]">{category.name}</span>
        </nav>
        <div className="relative inline-block">
          <span className="ba-tri absolute -left-5 -top-1 h-3 w-3.5 opacity-90" aria-hidden />
          <h1 className="ba-font-round text-3xl text-[color:rgb(var(--ba-primary))]">
            {category.name}
          </h1>
        </div>
        <div className="mt-3">
          <span className="ba-pill ba-pill--soft">
            {t.page.articlesCount.replace("{{count}}", String(totalCount))}
          </span>
        </div>
      </Reveal>

      {articles.length === 0 ? (
        <Reveal className="mt-10">
          <div className="ba-card flex flex-col items-center gap-4 p-12 text-center">
            <span className="ba-tri h-9 w-11 rotate-180 opacity-70" aria-hidden />
            <p className="text-sm text-slate-600 dark:text-slate-400 max-sm:text-sm">
              {t.common.noData}
            </p>
          </div>
        </Reveal>
      ) : (
        <ul className="mt-6 border-t border-[color:rgb(var(--ba-line))]">
          {articles.map((post, index) => (
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
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
            <Link
              key={pageNum}
              href={`/categories/${slug}?page=${pageNum}`}
              aria-current={pageNum === page ? "page" : undefined}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm font-medium transition-all duration-200 max-sm:text-sm ${
                pageNum === page
                  ? "border-transparent bg-[rgb(var(--ba-primary))] text-white shadow-[0_3px_10px_rgba(18,137,249,0.35)]"
                  : "border-[rgb(var(--ba-primary))]/45 bg-[color:rgb(var(--color-surface))] text-[color:rgb(var(--ba-primary))] hover:-translate-y-0.5"
              }`}
            >
              {pageNum}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
