/**
 * 后台文章管理核心（lib/admin-posts.ts）。
 *
 * 把 "写入 Markdown → 提交 Git → 同步 DB 索引" 这条链路收敛到一个地方，
 * API 路由只需关心 HTTP 输入/输出，不直接碰 git 命令或 Prisma。
 *
 * 关键约束（来自规格 6.6）：
 *   - Markdown 文件是内容唯一来源，DB 是派生索引。
 *   - 每次后台保存必须产生一个 Git 提交；失败时不允许留下"半完成"状态。
 *   - 公开/草稿/私有状态通过 frontmatter `status` 字段控制。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { db } from "@/lib/db";
import { syncContent } from "@/lib/content-sync";
import { commitFiles, removeFiles, GitCommitError } from "@/lib/content-git";
import { getPostsDir } from "@/lib/content-paths";
import { clearPostsCache } from "@/lib/content";
import { revalidatePath } from "next/cache";

export type PostStatus = "draft" | "public" | "private";

export interface PostInput {
  slug: string;
  title: string;
  summary?: string;
  status: PostStatus;
  category?: string;
  tags?: string[];
  cover?: string;
  pinned?: boolean;
  publishedAt?: string | null;
  body: string;
}

export interface AdminPostRecord {
  id: string;
  slug: string;
  sourcePath: string;
  title: string;
  summary: string;
  status: PostStatus;
  category: string;
  cover: string;
  pinned: boolean;
  publishedAt: Date | null;
  tags: string[];
  updatedAt: Date;
  createdAt: Date;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TITLE_MIN = 1;
const TITLE_MAX = 200;
const SUMMARY_MAX = 500;
const CATEGORY_MAX = 64;
const COVER_MAX = 500;
const TAG_NAME_MAX = 64;
const BODY_MAX = 200_000;

const POSTS_DIR = () => getPostsDir();

export class PostValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = "PostValidationError";
  }
}

export class PostNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`未找到文章：${id}`);
    this.name = "PostNotFoundError";
  }
}

export class PostConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostConflictError";
  }
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseStatus(value: unknown): PostStatus {
  if (value === "draft" || value === "public" || value === "private") return value;
  return "draft";
}

function parsePinned(value: unknown): boolean {
  return value === true || value === "true";
}

function assertValidSlug(raw: unknown, field = "slug"): string {
  const value = asString(raw).trim();
  if (!value) {
    throw new PostValidationError("slug 不能为空", field);
  }
  if (value.length > 100) {
    throw new PostValidationError("slug 长度不能超过 100 字符", field);
  }
  if (!SLUG_RE.test(value)) {
    throw new PostValidationError(
      "slug 只能包含小写字母、数字和中划线（不能以中划线开头或结尾）",
      field
    );
  }
  return value;
}

function assertValidTitle(raw: unknown): string {
  const value = asString(raw).trim();
  if (value.length < TITLE_MIN) {
    throw new PostValidationError("标题不能为空", "title");
  }
  if (value.length > TITLE_MAX) {
    throw new PostValidationError(
      `标题长度不能超过 ${TITLE_MAX} 字符`,
      "title"
    );
  }
  return value;
}

function assertValidStatus(raw: unknown): PostStatus {
  const value = asString(raw).trim();
  if (value !== "draft" && value !== "public" && value !== "private") {
    throw new PostValidationError(
      "status 必须是 draft / public / private",
      "status"
    );
  }
  return value;
}

function assertMaxLength(value: string, max: number, field: string): void {
  if (value.length > max) {
    throw new PostValidationError(
      `${field} 长度不能超过 ${max} 字符`,
      field
    );
  }
}

function buildFrontmatter(input: PostInput): string {
  const data: Record<string, unknown> = {
    title: input.title,
    slug: input.slug,
    summary: input.summary ?? "",
    status: input.status,
    category: input.category ?? "",
    cover: input.cover ?? "",
    pinned: Boolean(input.pinned),
    publishedAt: input.publishedAt ?? null,
    tags: input.tags ?? [],
  };
  // 使用 gray-matter 序列化（输出 YAML frontmatter + 末尾换行）。
  return matter.stringify(input.body ?? "", data);
}

function filePathForSlug(slug: string): {
  absolute: string;
  relative: string;
} {
  const fileName = `${slug}.md`;
  return {
    absolute: path.join(POSTS_DIR(), fileName),
    relative: path.posix.join("content", "posts", fileName),
  };
}

function ensureSafeSlug(slug: string): void {
  // 防止 ".." 或绝对路径被混入；slug 已经被 SLUG_RE 严格约束，
  // 这里只做一次额外防御。
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    throw new PostValidationError("slug 包含非法字符", "slug");
  }
}

export function validateAndNormalizeInput(raw: unknown): PostInput {
  if (!raw || typeof raw !== "object") {
    throw new PostValidationError("请求体格式错误", "body");
  }
  const obj = raw as Record<string, unknown>;

  const slug = assertValidSlug(obj.slug, "slug");
  ensureSafeSlug(slug);
  const title = assertValidTitle(obj.title);
  const status = assertValidStatus(obj.status);
  const summary = asString(obj.summary).trim();
  assertMaxLength(summary, SUMMARY_MAX, "summary");
  const category = asString(obj.category).trim();
  assertMaxLength(category, CATEGORY_MAX, "category");
  const cover = asString(obj.cover).trim();
  assertMaxLength(cover, COVER_MAX, "cover");
  const pinned = parsePinned(obj.pinned);
  const publishedAtRaw = asString(obj.publishedAt).trim();
  let publishedAt: string | null = null;
  if (publishedAtRaw) {
    const parsed = new Date(publishedAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      throw new PostValidationError(
        "publishedAt 不是合法的日期字符串",
        "publishedAt"
      );
    }
    publishedAt = parsed.toISOString();
  } else if (obj.publishedAt === null) {
    publishedAt = null;
  }
  const tags = asStringArray(obj.tags).map((t) => {
    if (t.length > TAG_NAME_MAX) {
      throw new PostValidationError(
        `tag "${t}" 长度超过 ${TAG_NAME_MAX}`,
        "tags"
      );
    }
    return t;
  });
  const body = asString(obj.body);
  if (body.length > BODY_MAX) {
    throw new PostValidationError(
      `正文长度不能超过 ${BODY_MAX} 字符`,
      "body"
    );
  }

  // 当 status=public 且没传 publishedAt 时自动补当前时间（与同步引擎期望一致）。
  if (status === "public" && !publishedAt) {
    publishedAt = new Date().toISOString();
  }

  return {
    slug,
    title,
    summary,
    status,
    category,
    cover,
    pinned,
    publishedAt,
    tags,
    body,
  };
}

function hashRaw(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function writeMarkdownFile(slug: string, raw: string): Promise<string> {
  await fs.mkdir(POSTS_DIR(), { recursive: true });
  const { absolute, relative } = filePathForSlug(slug);
  await fs.writeFile(absolute, raw, "utf-8");
  return relative;
}

async function deleteMarkdownFile(slug: string): Promise<string> {
  const { absolute, relative } = filePathForSlug(slug);
  try {
    await fs.unlink(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  return relative;
}

async function syncAfterChange(): Promise<void> {
  // 把"写文件 → 提交 → 同步"视为一个序列；同步异常应向上抛，
  // 让 API 路由决定如何处理（当前阶段：直接报错，前端重新拉取即可）。
  await syncContent();
}

function toRecord(
  article: {
    id: string;
    slug: string;
    sourcePath: string;
    title: string;
    summary: string;
    status: string;
    category: string;
    cover: string;
    pinned: boolean;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    tags: { tag: { name: string } }[];
  }
): AdminPostRecord {
  return {
    id: article.id,
    slug: article.slug,
    sourcePath: article.sourcePath,
    title: article.title,
    summary: article.summary,
    status: parseStatus(article.status),
    category: article.category,
    cover: article.cover,
    pinned: article.pinned,
    publishedAt: article.publishedAt,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    tags: article.tags.map((t) => t.tag.name),
  };
}

export interface CreatePostResult {
  post: AdminPostRecord;
  commitSha: string;
  created: boolean;
}

function adminIdPlaceholder(sessionId: string): string {
  // AdminSession 不直接持有 adminId（schema 暂未做外键关联），这里把 session.id
  // 作为 ArticleVersion.adminId 的占位值，前端表格里看到的就是会话 id。
  return `session:${sessionId}`;
}

export async function createPost(
  input: PostInput,
  sessionId: string
): Promise<CreatePostResult> {
  const existing = await db.article.findUnique({ where: { slug: input.slug } });
  if (existing) {
    throw new PostConflictError(`slug "${input.slug}" 已被其他文章占用`);
  }

  const raw = buildFrontmatter(input);
  const relativePath = await writeMarkdownFile(input.slug, raw);
  const contentHash = hashRaw(raw);
  let commit: { commitSha: string; message: string };

  try {
    commit = await commitFiles(
      [relativePath],
      `content: create article ${input.slug}`
    );
  } catch (error) {
    // git 失败时回滚文件，避免脏数据。
    if (error instanceof GitCommitError) {
      try {
        await deleteMarkdownFile(input.slug);
      } catch {
        // 静默：删除失败不影响主错误返回
      }
    }
    throw error;
  }

  // 同步 DB（同步引擎会基于最新 HEAD 的 sha 更新 sourceCommitSha）。
  await syncAfterChange();

  const article = await db.article.findUnique({ where: { slug: input.slug } });
  if (!article) {
    throw new Error("同步后仍无法在数据库中找到新建的文章");
  }

  await db.articleVersion.create({
    data: {
      articleId: article.id,
      commitSha: commit.commitSha,
      contentHash,
      source: "admin",
      action: "create",
      adminId: adminIdPlaceholder(sessionId),
    },
  });

  const record = await loadRecord(article.id);
  if (!record) {
    throw new Error("新建文章后无法从数据库读回记录");
  }
  // 修复审核报告 P1-3：内容与缓存失效必须发生在 return 之前（此前写在
  // return 之后是死代码，revalidate 从未执行）。
  clearPostsCache();
  revalidatePostPaths(input.slug);
  return { post: record, commitSha: commit.commitSha, created: true };
}

/** 内容变更后失效受影响的静态页面缓存（首页/列表/详情/衍生 XML）。 */
function revalidatePostPaths(...slugs: string[]): void {
  revalidatePath("/", "layout");
  revalidatePath("/posts");
  revalidatePath("/sitemap.xml");
  revalidatePath("/rss.xml");
  for (const slug of slugs) {
    if (slug) revalidatePath(`/posts/${slug}`);
  }
}

export interface UpdatePostOptions {
  /** 是否允许改 slug（如果传 null/undefined 表示不修改） */
  nextSlug?: string | null;
  /** 当仅切换 status（如 publish/private）时，传入 partial 字段 */
  partial?: Partial<PostInput>;
}

export interface UpdatePostResult {
  post: AdminPostRecord;
  commitSha: string;
  changed: boolean;
}

export async function updatePost(
  id: string,
  rawInput: unknown,
  sessionId: string
): Promise<UpdatePostResult> {
  const existing = await db.article.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });
  if (!existing) throw new PostNotFoundError(id);

  // 支持两种调用方式：
  // 1) 完整 PostInput（来自 /[id] PUT）
  // 2) 部分字段 { status?, publishedAt? }（来自 publish/private）
  let nextInput: PostInput;
  const isPartial =
    rawInput &&
    typeof rawInput === "object" &&
    !("body" in (rawInput as Record<string, unknown>));
  if (!isPartial) {
    nextInput = validateAndNormalizeInput(rawInput);
  } else {
    // 部分更新：基于现有数据合成 PostInput
    const partial = (rawInput ?? {}) as Partial<PostInput>;
    const merged: PostInput = {
      slug: partial.slug ?? existing.slug,
      title: partial.title ?? existing.title,
      summary: partial.summary ?? existing.summary,
      status: partial.status ?? parseStatus(existing.status),
      category: partial.category ?? existing.category,
      cover: partial.cover ?? existing.cover,
      pinned: partial.pinned ?? existing.pinned,
      publishedAt:
        partial.publishedAt === undefined
          ? existing.publishedAt
            ? existing.publishedAt.toISOString()
            : null
          : partial.publishedAt,
      tags: partial.tags ?? existing.tags.map((t) => t.tag.name),
      body: partial.body ?? "",
    };
    // 部分更新场景通常不带 body（PUT body 必填），若缺失则从磁盘读回。
    if (!merged.body) {
      try {
        const fileRaw = await fs.readFile(
          path.join(POSTS_DIR(), `${existing.slug}.md`),
          "utf-8"
        );
        const parsed = matter(fileRaw);
        merged.body = parsed.content;
      } catch {
        throw new PostValidationError("无法读取现有文章正文", "body");
      }
    }
    nextInput = validateAndNormalizeInput(merged);
  }

  if (nextInput.slug !== existing.slug) {
    const clash = await db.article.findUnique({
      where: { slug: nextInput.slug },
    });
    if (clash && clash.id !== existing.id) {
      throw new PostConflictError(`slug "${nextInput.slug}" 已被其他文章占用`);
    }
  }

  const newRaw = buildFrontmatter(nextInput);
  const oldRelative = filePathForSlug(existing.slug).relative;
  const newRelative = filePathForSlug(nextInput.slug).relative;
  const slugChanged = oldRelative !== newRelative;

  // 修复审核报告 P2"版本历史污染"：旧内容哈希必须基于磁盘上的旧文件全文
  //（含正文），否则任何更新都会被误判为"内容有变化"。
  let oldRaw: string | null = null;
  try {
    oldRaw = await fs.readFile(
      path.join(POSTS_DIR(), `${existing.slug}.md`),
      "utf-8"
    );
  } catch {
    oldRaw = null;
  }
  const oldContentHash = oldRaw
    ? hashRaw(oldRaw)
    : hashRaw(
        matter.stringify("", {
          title: existing.title,
          slug: existing.slug,
          summary: existing.summary,
          status: existing.status,
          category: existing.category,
          cover: existing.cover,
          pinned: existing.pinned,
          publishedAt: existing.publishedAt
            ? existing.publishedAt.toISOString()
            : null,
          tags: existing.tags.map((t) => t.tag.name),
        })
      );
  const newContentHash = hashRaw(newRaw);

  // 改 slug 时先删旧文件再提交：同一个 commit 同时记录重命名的两侧，
  // 避免旧文件删除残留在工作树（修复审核报告 P2"git 回滚不完整"）。
  // oldRaw 已在上方读出，git 失败时可用于完整回滚。
  if (slugChanged && oldRaw !== null) {
    try {
      await fs.unlink(path.join(POSTS_DIR(), `${existing.slug}.md`));
    } catch {
      // 旧文件不存在则无需删除
    }
  }

  // 写新文件（slug 没变时 oldRelative === newRelative）
  await fs.mkdir(POSTS_DIR(), { recursive: true });
  await fs.writeFile(path.join(POSTS_DIR(), `${nextInput.slug}.md`), newRaw, "utf-8");

  const filesToCommit: string[] = slugChanged
    ? [oldRelative, newRelative]
    : [newRelative];

  let commit: { commitSha: string; message: string };
  try {
    commit = await commitFiles(
      filesToCommit,
      `content: update article ${existing.id} (${nextInput.slug})`
    );
  } catch (error) {
    // git 失败时完整回滚：恢复旧文件、删除新文件。
    if (error instanceof GitCommitError && slugChanged) {
      try {
        await fs.rm(path.join(POSTS_DIR(), `${nextInput.slug}.md`), { force: true });
        if (oldRaw !== null) {
          await fs.writeFile(
            path.join(POSTS_DIR(), `${existing.slug}.md`),
            oldRaw,
            "utf-8"
          );
        }
      } catch {
        // ignore
      }
    }
    throw error;
  }

  // 修复审核报告 P1-2：改 slug 原地更新 DB 行的 slug，保留 article id 与全部
  // 评论/版本历史；随后 syncContent 按新 slug upsert 命中现有行，不会触发
  // "消失的文章"归档，也不会再出现 ArticleVersion 外键违例 500。
  if (slugChanged) {
    await db.article.update({ where: { id }, data: { slug: nextInput.slug } });
  }

  await syncAfterChange();

  const refreshed = await db.article.findUnique({ where: { id } });
  if (!refreshed) {
    throw new PostNotFoundError(id);
  }

  if (newContentHash !== oldContentHash) {
    await db.articleVersion.create({
      data: {
        articleId: id,
        commitSha: commit.commitSha,
        contentHash: newContentHash,
        source: "admin",
        action: "update",
        adminId: adminIdPlaceholder(sessionId),
      },
    });
  }

  clearPostsCache();
  revalidatePostPaths(existing.slug, nextInput.slug);
  const record = await loadRecord(id);
  if (!record) {
    throw new PostNotFoundError(id);
  }
  return {
    post: record,
    commitSha: commit.commitSha,
    changed: newContentHash !== oldContentHash || slugChanged,
  };
}

export interface DeletePostResult {
  commitSha: string;
  slug: string;
}

export async function deletePost(
  id: string,
  sessionId: string
): Promise<DeletePostResult> {
  const existing = await db.article.findUnique({ where: { id } });
  if (!existing) throw new PostNotFoundError(id);

  const { relative } = filePathForSlug(existing.slug);
  await deleteMarkdownFile(existing.slug);

  let commit: { commitSha: string; message: string };
  try {
    commit = await removeFiles(
      [relative],
      `content: delete article ${existing.id} (${existing.slug})`
    );
  } catch (error) {
    if (error instanceof GitCommitError) {
      throw error;
    }
    throw error;
  }

  // 同步引擎现在把"磁盘消失的文章"归档而非物理删除（P1-2），
  // 因此这里的 ArticleVersion 写入不再因文章被删而触发外键违例。
  await syncAfterChange();

  await db.articleVersion.create({
    data: {
      articleId: id,
      commitSha: commit.commitSha,
      contentHash: "",
      source: "admin",
      action: "delete",
      adminId: adminIdPlaceholder(sessionId),
    },
  });

  clearPostsCache();
  revalidatePostPaths(existing.slug);
  return { commitSha: commit.commitSha, slug: existing.slug };
}

async function loadRecord(id: string): Promise<AdminPostRecord | null> {
  const article = await db.article.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });
  if (!article) return null;
  return toRecord(article);
}

export async function listPosts(params: {
  status?: string;
  page?: number;
  perPage?: number;
}): Promise<{ items: AdminPostRecord[]; total: number; page: number; perPage: number }> {
  const perPage = Math.min(Math.max(params.perPage ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const where: { status?: PostStatus } = {};
  if (
    params.status === "draft" ||
    params.status === "public" ||
    params.status === "private"
  ) {
    where.status = params.status;
  }
  const [items, total] = await Promise.all([
    db.article.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: { tags: { include: { tag: true } } },
    }),
    db.article.count({ where }),
  ]);
  return {
    items: items.map(toRecord),
    total,
    page,
    perPage,
  };
}

export async function getPost(id: string): Promise<AdminPostRecord | null> {
  return loadRecord(id);
}

/**
 * 从磁盘读出文章正文（Markdown 文本），用于后台编辑页"重新打开"时填充。
 */
export async function readPostBody(slug: string): Promise<string> {
  const { absolute } = filePathForSlug(slug);
  try {
    const raw = await fs.readFile(
      /* turbopackIgnore: true */
      absolute,
      "utf-8"
    );
    const parsed = matter(raw);
    return parsed.content;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "";
    throw error;
  }
}
