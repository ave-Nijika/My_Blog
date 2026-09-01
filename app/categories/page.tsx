import { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getAllCategories } from "@/lib/queries";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Categories",
  description: "All categories",
};

export default async function CategoriesPage() {
  // 与 layout 同款 SSR 读 cookie（双语一致红线）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const t = locale === "en" ? en : zh;

  const categories = await getAllCategories();

  return (
    <div className="relative mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <span
        className="ba-outline-text pointer-events-none absolute -top-2 right-0 hidden text-[84px] opacity-[0.14] sm:block"
        aria-hidden
      >
        CATEGORY
      </span>

      <Reveal translateY={10} className="relative inline-block">
        <span className="ba-tri absolute -left-5 -top-1 h-3 w-3.5 opacity-90" aria-hidden />
        <h1 className="ba-font-round text-3xl text-[color:rgb(var(--ba-primary))]">
          {t.common.categories}
        </h1>
      </Reveal>

      {categories.length === 0 ? (
        <Reveal className="mt-10">
          <div className="ba-card flex flex-col items-center gap-4 p-12 text-center">
            <span className="ba-tri h-9 w-11 opacity-70" aria-hidden />
            <p className="text-sm text-slate-600 dark:text-slate-400 max-sm:text-sm">
              {t.common.noData}
            </p>
          </div>
        </Reveal>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {categories.map((category, index) => (
            <Reveal key={category.id} delay={index * 50} translateY={10} className="block">
              <Link
                href={`/categories/${category.slug}`}
                className="group block rounded-lg border border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--color-surface))] p-4 transition-all duration-200 hover:-translate-y-1 hover:border-[rgb(var(--ba-primary))]/60 hover:shadow-[0_10px_24px_rgba(18,137,249,0.14)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="ba-font-round truncate text-lg text-[color:rgb(var(--ba-primary))]">
                    {category.name}
                  </span>
                  <span className="ba-pill shrink-0">
                    {category._count.articles}
                  </span>
                </div>
                <div className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 max-sm:text-sm">
                  {t.page.articlesCount.replace("{{count}}", String(category._count.articles))}
                </div>
                <span
                  className="mt-3 block h-2 w-3 bg-[rgb(var(--ba-primary))] opacity-80 [clip-path:polygon(0_0,100%_50%,0_100%)] transition-transform duration-300 group-hover:translate-x-1"
                  aria-hidden
                />
              </Link>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
