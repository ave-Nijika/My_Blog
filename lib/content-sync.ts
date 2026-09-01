import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { db } from "./db.ts";
import { getPostsDir, getContentRepoRoot } from "./content-paths";

export type PostStatus = "draft" | "public" | "private";

export interface SyncedPost {
  sourcePath: string;
  slug: string;
  title: string;
  summary: string;
  status: PostStatus;
  category: string;
  cover: string;
  pinned: boolean;
  publishedAt: Date | null;
  tags: string[];
  body: string;
  raw: string;
}

export interface SyncResult {
  created: number;
  updated: number;
  /** 磁盘上已消失、本次同步被归档（status→draft + archivedAt）的文章数 */
  archived: number;
  tags: number;
  categories: number;
  commitSha: string;
  syncedAt: Date;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;


export function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function slugifyName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    // 保留 CJK 等 Unicode 字母/数字，去掉其余符号
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unnamed";
}

export function parseSlug(raw: unknown): string {
  if (typeof raw !== "string" || !SLUG_RE.test(raw)) {
    throw new Error(`Invalid slug in content: ${String(raw)}`);
  }
  return raw;
}

export function parseStatus(raw: unknown): PostStatus {
  if (raw === "draft" || raw === "public" || raw === "private") return raw;
  return "draft";
}

export function parseDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  // 兼容 gray-matter/js-yaml 把裸 YAML 日期解析成 Date 对象的情况
  //（与 lib/content.ts parsePublishedAt 行为对齐）
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === "string");
  }
  return [];
}

export function markdownToPlainText(markdown: string): string {
  return markdown
    // 代码块
    .replace(/```[\s\S]*?```/g, " ")
    // 行内代码
    .replace(/`[^`]*`/g, " ")
    // 图片 / 链接（引用式与行内式）
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    // 标题 / 引用 / 无序与有序列表标记
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    // 表格行
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    // 强调 / 删除线 / 残留星号等符号
    .replace(/(\*\*|__|\*|_|~~|~|`)+/g, " ")
    // 脚注引用、HTML 标签
    .replace(/\[\^[^\]]*\]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function readPostsFromDisk(): SyncedPost[] {
  const dir = getPostsDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  return files.map((file) => {
    const sourcePath = path.join("posts", file).split(path.sep).join("/");
    const raw = fs.readFileSync(path.join(dir, file), "utf-8");
    const { data, content } = matter(raw);
    return {
      sourcePath,
      slug: parseSlug(data.slug),
      title: String(data.title ?? "Untitled"),
      summary: String(data.summary ?? ""),
      status: parseStatus(data.status),
      category: String(data.category ?? ""),
      cover: String(data.cover ?? ""),
      pinned: Boolean(data.pinned),
      publishedAt: parseDate(data.publishedAt),
      tags: parseTags(data.tags),
      body: content,
      raw,
    };
  });
}

export function getCurrentCommitSha(): string {
  try {
    // 以内容仓库根为工作目录：本地开发即项目根；生产容器里是 /app/content
    //（entrypoint 已把它初始化为独立 git 仓库，/app 本身不是 git 仓库）
    const out = execSync("git rev-parse HEAD", {
      cwd: getContentRepoRoot(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch {
    return "";
  }
}

export async function syncContent(): Promise<SyncResult> {
  const files = readPostsFromDisk();
  const existing = await db.article.findMany({
    select: { id: true, slug: true, sourcePath: true, archivedAt: true },
  });
  const existingBySlug = new Map(existing.map((a) => [a.slug, a]));
  const seenSlugs = new Set<string>();

  const commitSha = getCurrentCommitSha();
  const now = new Date();

  let created = 0;
  let updated = 0;
  let tagCount = 0;
  let categoryCount = 0;

  for (const post of files) {
    seenSlugs.add(post.slug);
    const contentHash = hashString(post.raw);
    const plainTextCache = markdownToPlainText(post.body);
    const prev = existingBySlug.get(post.slug);

    const article = await db.article.upsert({
      where: { slug: post.slug },
      create: {
        slug: post.slug,
        sourcePath: post.sourcePath,
        title: post.title,
        summary: post.summary,
        status: post.status,
        category: post.category,
        cover: post.cover,
        pinned: post.pinned,
        publishedAt: post.publishedAt,
        sourceCommitSha: commitSha,
        sourceContentHash: contentHash,
        lastSyncedAt: now,
        plainTextCache,
        archivedAt: null,
      },
      update: {
        sourcePath: post.sourcePath,
        title: post.title,
        summary: post.summary,
        status: post.status,
        category: post.category,
        cover: post.cover,
        pinned: post.pinned,
        publishedAt: post.publishedAt,
        sourceCommitSha: commitSha,
        sourceContentHash: contentHash,
        lastSyncedAt: now,
        plainTextCache,
        archivedAt: null,
      },
    });

    if (prev) updated += 1;
    else created += 1;

    if (post.category.trim()) {
      await db.category.upsert({
        where: { name: post.category },
        create: { name: post.category, slug: slugifyName(post.category) },
        update: { slug: slugifyName(post.category) },
      });
      categoryCount += 1;
    }

    const tagIds: string[] = [];
    for (const name of post.tags) {
      const tag = await db.tag.upsert({
        where: { name },
        create: { name, slug: slugifyName(name) },
        update: { slug: slugifyName(name) },
      });
      tagIds.push(tag.id);
    }
    tagCount += tagIds.length;

    await db.articleTag.deleteMany({ where: { articleId: article.id } });
    if (tagIds.length > 0) {
      await db.articleTag.createMany({
        data: tagIds.map((tagId) => ({ articleId: article.id, tagId })),
      });
    }
  }

  // 磁盘上消失的文章：归档（status→draft + archivedAt），不再物理删除。
  // 修复审核报告 P1-2：此前会连坐删除评论、版本历史与阅读量，且后台改 slug /
  // 删除文章后紧跟的 ArticleVersion 写入会因文章已被删而触发外键违例（500）。
  // 归档保留全部关联数据；文件重新出现时 upsert 会清除 archivedAt 恢复文章。
  let archived = 0;
  const missingInContent = existing.filter(
    (a) => !seenSlugs.has(a.slug) && a.sourcePath !== "" && a.archivedAt === null
  );
  for (const article of missingInContent) {
    try {
      await db.article.update({
        where: { id: article.id },
        data: { status: "draft", archivedAt: now },
      });
      archived += 1;
    } catch (error) {
      console.warn(
        `[content-sync] 无法归档文章 "${article.slug}"，已跳过：`,
        error
      );
    }
  }

  return {
    created,
    updated,
    archived,
    tags: tagCount,
    categories: categoryCount,
    commitSha,
    syncedAt: now,
  };
}