import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { getPublicArticles } from "@/lib/queries";
import { siteConfig } from "@/lib/site";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { Hero } from "@/components/Hero";
import { Reveal } from "@/components/Reveal";
import { PostRow } from "@/components/PostRow";

const HOME_POST_COUNT = 6;

export default async function Home() {
  // 与 layout 同款 SSR 读 cookie（集成测试依赖首页 SSR 语言，不可改懒加载）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const t = locale === "en" ? en : zh;

  const posts = await getPublicArticles();
  const latest = posts.slice(0, HOME_POST_COUNT);
  const featured = posts[0];
  const featuredCover = featured?.cover?.trim();

  return (
    <div className="min-h-screen">
      <Hero />

      {/* 官网快讯式内容区：左列表 + 右拍立得 + 背景描边大字 */}
      <section className="relative mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6">
        <span
          className="ba-outline-text pointer-events-none absolute -top-4 right-0 hidden text-[92px] opacity-[0.14] lg:block"
          aria-hidden
        >
          POSTS
        </span>

        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <Reveal className="relative inline-block">
              <span className="ba-tri absolute -left-5 -top-1.5 h-3 w-3.5 opacity-90" aria-hidden />
              <h1 className="ba-font-round text-3xl text-[color:rgb(var(--ba-primary))]">
                {t.news.latest}
              </h1>
            </Reveal>
            <Reveal as="p" delay={80} className="mt-3 text-sm text-slate-500 dark:text-slate-400 max-sm:text-sm">
              {siteConfig.description}
            </Reveal>

            {latest.length === 0 ? (
              <Reveal className="mt-10">
                <p className="ba-card px-8 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                  {t.news.empty}
                </p>
              </Reveal>
            ) : (
              <>
                <ul className="mt-4">
                  {latest.map((post, index) => (
                    <Reveal
                      as="div"
                      key={post.slug}
                      delay={index * 60}
                      translateY={12}
                      className="list-none"
                    >
                      <PostRow post={post} pinnedLabel={t.news.pinned} />
                    </Reveal>
                  ))}
                </ul>

                <Reveal delay={120} className="mt-8">
                  <Link
                    href="/posts"
                    className="ba-font-round inline-flex items-center gap-1.5 text-[color:rgb(var(--ba-primary))] transition-all duration-200 hover:gap-3 hover:text-[color:rgb(var(--ba-primary-hover))]"
                  >
                    {t.news.viewAll}
                    <span aria-hidden>&gt;&gt;</span>
                  </Link>
                </Reveal>
              </>
            )}
          </div>

          {/* 右侧拍立得：最新文章封面（官网轮播大图卡的静态化） */}
          {featured && (
            <Reveal delay={200} className="relative mx-auto w-full max-w-sm lg:mt-10">
              <span
                className="ba-tri absolute -right-3 -top-4 z-10 h-5 w-6 opacity-90"
                aria-hidden
              />
              <Link href={`/posts/${featured.slug}`} className="ba-polaroid block p-3 pb-4">
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-[color:rgb(var(--ba-primary-soft))]">
                  <Image
                    src={featuredCover || "/ba/ffJ4RBzt.jpeg"}
                    alt={featured.title}
                    fill
                    unoptimized
                    sizes="(max-width: 1024px) 100vw, 360px"
                    className="object-cover transition-transform duration-500 hover:scale-[1.04]"
                  />
                </div>
                <p className="ba-font-hand mt-3 line-clamp-1 text-center text-lg text-slate-500 dark:text-slate-400">
                  {featured.title}
                </p>
              </Link>
              <span className="ba-pill mt-5 inline-flex ml-6">
                {t.news.featured}
              </span>
            </Reveal>
          )}
        </div>
      </section>
    </div>
  );
}
