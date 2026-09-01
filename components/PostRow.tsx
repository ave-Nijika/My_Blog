import Link from "next/link";
import { LocaleDate } from "@/components/LocaleDate";

interface PostRowPost {
  slug: string;
  title: string;
  summary: string | null;
  category: string | null;
  pinned: boolean;
  publishedAt: Date | null;
  tags: Array<{ tag: { id: string; name: string } }>;
}

interface PostRowProps {
  post: PostRowPost;
  pinnedLabel: string;
  showSummary?: boolean;
  showTags?: boolean;
}

/**
 * 官网快讯列表行：蓝 pill 分类 + 展示体日期 + 圆体标题，细分隔线，hover 行内小蓝三角滑入。
 * 服务端组件，首页内容区与 /posts 列表共用。
 */
export function PostRow({ post, pinnedLabel, showSummary = false, showTags = false }: PostRowProps) {
  return (
    <li className="group border-b border-[color:rgb(var(--ba-line))]">
      <Link
        href={`/posts/${post.slug}`}
        className="flex items-start gap-4 py-4 pr-1 transition-colors duration-200 hover:bg-[color:rgb(var(--ba-primary-soft))]/45 focus-visible:bg-[color:rgb(var(--ba-primary-soft))]/45 sm:px-2"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            {post.pinned && (
              <span className="ba-pill !bg-[rgb(var(--ba-yellow))] !text-[#3a3000]">
                {pinnedLabel}
              </span>
            )}
            {post.category && <span className="ba-pill">{post.category}</span>}
            {post.publishedAt && (
              <span className="ba-font-display text-[11px] tracking-[0.12em] text-slate-400 dark:text-slate-500">
                <LocaleDate date={post.publishedAt} />
              </span>
            )}
          </div>

          <h3 className="ba-font-round mt-2 text-lg font-semibold leading-snug text-[color:rgb(var(--color-text-primary))] transition-colors duration-200 group-hover:text-[color:rgb(var(--ba-primary))] dark:text-slate-100">
            {post.title}
          </h3>

          {showSummary && post.summary && (
            <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400 max-sm:text-sm">
              {post.summary}
            </p>
          )}

          {showTags && post.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {post.tags.slice(0, 4).map(({ tag }) => (
                <span
                  key={tag.id}
                  className="rounded-full bg-[color:rgb(var(--ba-primary-soft))] px-2 py-0.5 text-[11px] text-[color:rgb(var(--ba-primary))] max-sm:text-sm"
                >
                  #{tag.name}
                </span>
              ))}
              {post.tags.length > 4 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400 dark:bg-slate-800 dark:text-slate-500 max-sm:text-sm">
                  +{post.tags.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        {/* hover 滑入的小蓝三角（官网列表 hover 呼应） */}
        <span
          aria-hidden
          className="mt-7 h-2.5 w-3 shrink-0 translate-x-1 bg-[rgb(var(--ba-primary))] opacity-0 [clip-path:polygon(0_0,100%_50%,0_100%)] transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
        />
      </Link>
    </li>
  );
}
