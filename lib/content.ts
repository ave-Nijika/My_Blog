import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getPostsDir } from "./content-paths";

export interface Post {
  title: string;
  slug: string;
  summary: string;
  status: "draft" | "public" | "private";
  publishedAt: string | null;
  tags: string[];
  category: string;
  pinned: boolean;
  content: string;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function parseSlug(raw: unknown): string {
  if (typeof raw !== "string" || !SLUG_RE.test(raw)) {
    throw new Error(`Invalid slug: ${String(raw)}`);
  }
  return raw;
}

export function parseStatus(raw: unknown): "draft" | "public" | "private" {
  if (raw === "draft" || raw === "public" || raw === "private") return raw;
  return "draft";
}

export function parsePublishedAt(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  // 兼容 gray-matter/js-yaml 将裸 ISO 日期解析为 Date 对象的情况；
  // 只接受字符串与 Date，数字/布尔等其他类型一律视为无效（避免把毫秒时间戳误当年份）
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return raw.toISOString();
  }
  return null;
}

export function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === "string");
  }
  return [];
}

export function readAllPosts(): Post[] {
  const dir = getPostsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files.map((file) => {
    const raw = fs.readFileSync(path.join(dir, file), "utf-8");
    const { data, content } = matter(raw);
    return {
      title: String(data.title ?? "Untitled"),
      slug: parseSlug(data.slug),
      summary: String(data.summary ?? ""),
      status: parseStatus(data.status),
      publishedAt: parsePublishedAt(data.publishedAt),
      tags: parseTags(data.tags),
      category: String(data.category ?? ""),
      pinned: Boolean(data.pinned),
      content,
    };
  });
}

// 缓存必须挂在 globalThis 上：Next.js 会为每个路由生成独立 bundle，
// 模块级变量在"后台路由"与"页面"两个 bundle 中是不同实例——
// 后台路由调用 clearPostsCache() 时必须能清掉页面 bundle 读到的同一份缓存
//（与 lib/db.ts 的 Prisma 单例是同一原理）。
const globalForContent = globalThis as unknown as {
  __blogPostsCache: Post[] | null;
};

function cacheGet(): Post[] | null {
  return globalForContent.__blogPostsCache ?? null;
}

function cacheSet(posts: Post[] | null): void {
  globalForContent.__blogPostsCache = posts;
}

export function getCachedPosts(): Post[] {
  const cached = cacheGet();
  if (cached) {
    return cached;
  }
  const posts = readAllPosts();
  cacheSet(posts);
  return posts;
}

export function clearPostsCacheForTest(): void {
  cacheSet(null);
}

/**
 * 失效正文缓存（修复审核报告 P1-3）。
 * 后台新建/编辑/删除文章写盘后必须调用，否则运行期进程内缓存
 * 会继续返回旧正文（新建文章详情页甚至 404）。
 */
export function clearPostsCache(): void {
  cacheSet(null);
}

export function getAllPosts(): Post[] {
  return getCachedPosts();
}

export function getPublicPosts(): Post[] {
  return getCachedPosts()
    .filter((p) => p.status === "public")
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return db - da;
    });
}

export function getPostBySlug(slug: string): Post | undefined {
  return getCachedPosts().find((p) => p.slug === slug);
}

export function estimateReadingTime(content: string): number {
  const charCount = content.replace(/\s/g, "").length;
  const minutes = Math.ceil(charCount / 300);
  return Math.max(minutes, 1);
}
