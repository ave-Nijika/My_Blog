import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { cookies } from "next/headers";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { estimateReadingTime, getPostBySlug } from "@/lib/content";
import {
  getPublicArticleBySlug,
  getPublicArticleSlugs,
} from "@/lib/queries";
import { listApprovedComments, getCommentConfig } from "@/lib/comments";
import { getEffectiveSiteSettings } from "@/lib/site-settings";
import {
  getViewCount,
  recordView,
  resolveViewIdentity,
} from "@/lib/visitor";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { CommentSection } from "@/components/CommentSection";
import { CodeBlock } from "@/components/CodeBlock";
import { LocaleDate } from "@/components/LocaleDate";
import { Reveal } from "@/components/Reveal";

// 动态渲染：阅读量计数与评论列表都要求每请求执行（也顺带解决
// 静态缓存导致"发布/审核后内容不更新"的问题，见审核报告 P1-3/P1-7）。
export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  const slugs = await getPublicArticleSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/posts/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublicArticleBySlug(slug);
  if (!article) {
    return {};
  }
  return {
    title: article.title,
    description: article.summary || undefined,
  };
}

export default async function PostPage({
  params,
}: PageProps<"/posts/[slug]">) {
  const { slug } = await params;
  const article = await getPublicArticleBySlug(slug);
  if (!article) {
    notFound();
  }
  const body = getPostBySlug(slug);
  if (!body) {
    notFound();
  }
  // 与 layout 同款 SSR 读 cookie（双语一致红线）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const t = locale === "en" ? en : zh;

  const readingTime = estimateReadingTime(body.content);
  const [comments, commentCfg, viewCount, viewIdentity, effectiveSettings] =
    await Promise.all([
      listApprovedComments(article.id),
      getCommentConfig(),
      getViewCount(article.id),
      resolveViewIdentity(),
      getEffectiveSiteSettings(),
    ]);

  // 评论对游客可见开关（需求 4.2）：关闭时游客页面完全不渲染评论区——
  // 标题/列表/提交框/空状态/"暂无评论"提示一律不出现，也不暴露任何评论
  // 内容与"已关闭"提示；管理员本人浏览（预览/调试）不受影响。
  const showComments =
    effectiveSettings.commentsVisibleToGuests || viewIdentity.isAdmin;

  // 阅读量异步写入：不阻塞页面响应（修复审核报告 P1-7，此前从未接线）。
  // 管理员本人浏览不计入；24h 内同身份只计一次（ArticleViewDedup 去重桶）。
  if (!viewIdentity.isAdmin) {
    after(() =>
      recordView(article.id, viewIdentity.identityHash).catch(() => {})
    );
  }

  const cover = article.cover?.trim();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Reveal translateY={8}>
        <Link
          href="/posts"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-[color:rgb(var(--ba-primary))] dark:text-slate-400 max-sm:text-sm"
        >
          <span className="inline-block h-2 w-2.5 bg-[rgb(var(--ba-primary))] [clip-path:polygon(100%_0,0_50%,100%_100%)]" aria-hidden />
          {t.news.backToPosts}
        </Link>
      </Reveal>

      <Reveal translateY={10} as="article" className="mt-6 block">
        {/* 官网新闻详情式头部：居中圆体大标题 + 左对齐 pill 元信息行 + 虚线 */}
        <header>
          {article.pinned && (
            <div className="mb-3 text-center">
              <span className="ba-pill !bg-[rgb(var(--ba-yellow))] !text-[#3a3000]">
                {t.news.pinned}
              </span>
            </div>
          )}
          <h1 className="ba-font-round text-center text-3xl leading-snug text-[color:rgb(var(--ba-primary))] sm:text-4xl">
            {article.title}
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {article.category && <span className="ba-pill">{article.category}</span>}
            {article.publishedAt && (
              <span className="ba-font-display text-xs tracking-[0.12em] text-slate-400 dark:text-slate-500">
                <LocaleDate date={article.publishedAt} />
              </span>
            )}
            <span className="text-slate-300 dark:text-slate-600" aria-hidden>|</span>
            <span className="text-sm text-slate-400 dark:text-slate-500 max-sm:text-sm">
              {readingTime} {t.news.minRead}
            </span>
            <span className="text-slate-300 dark:text-slate-600" aria-hidden>|</span>
            <span className="text-sm text-slate-400 dark:text-slate-500 max-sm:text-sm">
              {viewCount} {t.news.views}
            </span>
          </div>
          <hr className="ba-rule-dashed mt-4" />

          {article.summary && (
            <p className="mt-5 border-l-[3px] border-[rgb(var(--ba-primary))] bg-[color:rgb(var(--ba-primary-soft))]/60 py-2.5 pl-4 pr-3 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300 max-sm:text-sm">
              {article.summary}
            </p>
          )}

          {cover && (
            <div className="relative mt-6 aspect-[16/9] w-full overflow-hidden rounded-lg border border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--ba-primary-soft))]">
              <Image
                src={cover}
                alt={article.title}
                fill
                unoptimized
                sizes="(max-width: 768px) 100vw, 768px"
                className="object-cover"
              />
            </div>
          )}
        </header>

        <div className="prose-content mt-8">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              // 代码块增强（悬停复制/展开、触屏长按复制）——仅文章详情页启用，
              // 编辑页预览不受影响；node prop 不可跨 RSC 序列化，不下传
              pre: ({ children, className }) => (
                <CodeBlock className={className}>{children}</CodeBlock>
              ),
            }}
          >
            {body.content}
          </ReactMarkdown>
        </div>

        {article.tags.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-2">
            {article.tags.map(({ tag }) => (
              <span
                key={tag.id}
                className="rounded-full bg-[color:rgb(var(--ba-primary-soft))] px-3 py-1 text-xs text-[color:rgb(var(--ba-primary))] dark:text-[color:rgb(var(--ba-primary-light))] max-sm:text-sm"
              >
                #{tag.name}
              </span>
            ))}
          </div>
        )}
      </Reveal>

      {showComments && (
        <>
          {/* 官网内容分隔母题：细线中央一枚小蓝三角 */}
          <div className="mt-10 flex items-center gap-3" aria-hidden>
            <span className="ba-rule-dashed h-px flex-1" />
            <span className="ba-tri h-3 w-3.5" />
            <span className="ba-rule-dashed h-px flex-1" />
          </div>

          <div className="mt-8">
            <CommentSection
              slug={slug}
              initialComments={comments}
              maxLength={commentCfg.maxLength}
              captchaSiteKey={process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY || ""}
            />
          </div>
        </>
      )}
    </div>
  );
}
