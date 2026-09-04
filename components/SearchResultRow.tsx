import Link from "next/link";
import { LocaleDate } from "@/components/LocaleDate";
import { highlightTokens } from "@/lib/search";

interface SearchResultRowPost {
  slug: string;
  title: string;
  summary: string | null;
  category: string | null;
  pinned: boolean;
  publishedAt: Date | null;
  tags: Array<{ tag: { id: string; name: string } }>;
}

interface SearchResultRowProps {
  post: SearchResultRowPost;
  /** 正文匹配片段（lib/search.extractSnippet 产物），非空才渲染片段框 */
  snippet?: string | null;
  /** 拆词结果（已小写），用于片段内高亮 */
  tokens: string[];
  pinnedLabel: string;
  /** 片段框标签，页面传入 t.page.searchSnippetLabel */
  snippetLabel: string;
}

/**
 * 搜索结果行：复用 PostRow 的整行结构与样式（pill 分类、日期、圆体标题、
 * hover 小蓝三角、tags），在 summary 位置下方追加「匹配片段框」——
 * 关键词大小写不敏感地高亮为 <mark>。服务端组件；不修改 PostRow 本身。
 */
export function SearchResultRow({
  post,
  snippet,
  tokens,
  pinnedLabel,
  snippetLabel,
}: SearchResultRowProps) {
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

          {post.summary && (
            <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400 max-sm:text-sm">
              {post.summary}
            </p>
          )}

          {snippet ? (
            <div
              data-testid="search-snippet"
              className="mt-2 rounded-md border-l-2 border-[rgb(var(--ba-primary))] bg-[color:rgb(var(--ba-primary-soft))]/40 px-3 py-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
            >
              <span className="mr-1 font-medium text-[color:rgb(var(--ba-primary))]">
                {snippetLabel}
              </span>
              <span>{highlightTokens(snippet, tokens)}</span>
            </div>
          ) : null}

          {post.tags.length > 0 && (
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
