/**
 * 搜索打分与片段提取的纯函数（需求 A）。
 *
 * 不碰数据库、不碰 DOM，可在 node 单测直接运行。大小写不敏感与模糊匹配
 * 统一在应用层用 toLowerCase + includes 实现——SQLite 与 PG 行为完全一致，
 * 也避免使用 Prisma 的 mode: "insensitive"（本地 SQLite client 无此类型）。
 */
import { createElement, type ReactNode } from "react";

/** 参与打分所需的字段（Article 与其 tag 名单的投影） */
export interface SearchableArticle {
  title: string;
  summary: string;
  category: string;
  plainTextCache: string;
  tagNames: string[];
}

/** 字段权重：标题最高，摘要/标签次之，分类与正文保底 */
const FIELD_WEIGHTS = {
  title: 3,
  summary: 2,
  tag: 2,
  category: 1,
  body: 1,
} as const;

const SNIPPET_WINDOW = 120;

/** 拆词：trim → 按空白切分 → 去空 → 去重 → 全部 toLowerCase */
export function splitQuery(q: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of q.trim().split(/\s+/)) {
    const token = raw.toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function includesIgnoreCase(text: string, token: string): boolean {
  return text.toLowerCase().includes(token);
}

/**
 * 单篇匹配 + 打分：任一 token 命中任一字段即算匹配（OR，扩大召回），
 * 全不命中返回 null。打分：每个 token 取其命中字段的最高权重
 * （title=3, summary=2, tag=2, category=1, body=1），再对所有命中 token 求和。
 */
export function scoreArticle(
  a: SearchableArticle,
  tokens: string[]
): { score: number; matchedTokens: string[] } | null {
  let score = 0;
  const matchedTokens: string[] = [];
  for (const token of tokens) {
    const hits: number[] = [];
    if (includesIgnoreCase(a.title, token)) hits.push(FIELD_WEIGHTS.title);
    if (includesIgnoreCase(a.summary, token)) hits.push(FIELD_WEIGHTS.summary);
    if (a.tagNames.some((name) => includesIgnoreCase(name, token)))
      hits.push(FIELD_WEIGHTS.tag);
    if (includesIgnoreCase(a.category, token)) hits.push(FIELD_WEIGHTS.category);
    if (includesIgnoreCase(a.plainTextCache, token)) hits.push(FIELD_WEIGHTS.body);
    if (hits.length === 0) continue;
    score += Math.max(...hits);
    matchedTokens.push(token);
  }
  if (matchedTokens.length === 0) return null;
  return { score, matchedTokens };
}

/**
 * 片段提取：在 plainText 里找「第一个命中正文的 token」首次出现位置
 * （大小写不敏感），截取以命中为中心、总长约 120 字符的窗口（按字符计）；
 * 窗口未覆盖文首/文末时分别加前/后省略号「…」。
 * 没有任何 token 出现在正文 → null（标题/标签命中不出片段框）。
 */
export function extractSnippet(
  plainText: string,
  tokens: string[]
): string | null {
  if (!plainText || tokens.length === 0) return null;
  const lower = plainText.toLowerCase();
  let hitToken: string | null = null;
  let hitIndex = -1;
  for (const token of tokens) {
    if (!token) continue;
    const i = lower.indexOf(token);
    if (i !== -1) {
      hitToken = token;
      hitIndex = i;
      break;
    }
  }
  if (!hitToken || hitIndex === -1) return null;

  const before = Math.floor((SNIPPET_WINDOW - hitToken.length) / 2);
  let start = Math.max(0, hitIndex - before);
  let end = Math.min(plainText.length, start + SNIPPET_WINDOW);
  // 靠近文末、窗口不足时向左扩，尽量保持总长
  if (end - start < SNIPPET_WINDOW) start = Math.max(0, end - SNIPPET_WINDOW);

  const prefix = start > 0 ? "…" : "";
  const suffix = end < plainText.length ? "…" : "";
  return `${prefix}${plainText.slice(start, end)}${suffix}`;
}

/** 正则元字符转义（token 拼进 RegExp 前必做） */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 高亮：把每个 token（先正则转义）在 text 中大小写不敏感地包成
 * <mark className="rounded bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-500/30">。
 * 返回 React 节点数组（createElement 产物，node 环境可直接单测）；
 * SearchResultRow 只负责渲染。
 */
export function highlightTokens(text: string, tokens: string[]): ReactNode[] {
  const usable = tokens.filter((t) => t.length > 0);
  if (!text || usable.length === 0) return [text];
  const pattern = usable.map(escapeRegExp).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));
  return parts.map((part, i) =>
    i % 2 === 1
      ? createElement(
          "mark",
          {
            key: i,
            className:
              "rounded bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-500/30",
          },
          part
        )
      : part
  );
}
