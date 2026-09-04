/**
 * HTTP 层集成测试（审核报告 P1-9）。
 *
 * 与 unit 测试的区别：真实启动 next dev（独立端口 + 独立 SQLite 测试库 +
 * 独立临时内容 git 仓库），直接走 HTTP 请求验证安全边界与业务闭环：
 *   - 草稿/私有文章 404（页面、RSS、Sitemap、搜索）
 *   - 未登录访问后台 API → 401（含 P0-1 回归：GET /api/admin/posts/[id]）
 *   - 无 CSRF token 的写操作 → 403
 *   - 登录 → CSRF → 建文章（git commit 产生）→ 编辑 → 发布 → 删除（归档）
 *   - slug 改名保留 article id 与评论（P1-2 回归）
 *   - 评论：冷却、限流（MAX_ATTEMPTS 真实生效）、正则 reject、自动封禁（DB 阈值）
 *   - 评论审核批准后公开展示
 *   - 阅读量异步计数（P1-7 回归）
 *   - 登录失败限流（本文件最后一个用例，避免污染其他用例的 IP 桶）
 *
 * 运行方式：pnpm test（与单元测试一起执行）；服务器启动约需 10~60s。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";

const PORT = 4311;
const BASE = `http://127.0.0.1:${PORT}`;
const VISITOR_SECRET = "test-visitor-secret";
const IP_SECRET = "test-ip-secret";

let server: ChildProcess | null = null;
let tmpRoot = "";
let db: {
  article: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null>; update: (args: unknown) => Promise<unknown> };
  comment: { findMany: (args: unknown) => Promise<Record<string, unknown>[]>; count: (args: unknown) => Promise<number>; create: (args: unknown) => Promise<Record<string, unknown>> };
  regexRule: { create: (args: unknown) => Promise<unknown> };
  siteSettings: { findFirst: () => Promise<unknown>; create: (args: unknown) => Promise<unknown> };
  visitorRisk: { findUnique: (args: unknown) => Promise<{ warningCount: number } | null> };
  visitorBan: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
  articleViewDedup: { count: (args: unknown) => Promise<number> };
  articleTag: { create: (args: unknown) => Promise<unknown>; deleteMany: (args: unknown) => Promise<unknown> };
  deletedArticle: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
  deletedComment: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
    count: (args: unknown) => Promise<number>;
  };
  $disconnect: () => Promise<void>;
} | null = null;

const jar = new Map<string, string>();
let csrfToken = "";
const admin = { username: "testadmin", password: "test-admin-pass-123" };

function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function req(
  pathname: string,
  init: RequestInit = {},
  opts: { useJar?: boolean } = {}
): Promise<Response> {
  const useJar = opts.useJar !== false;
  const headers = new Headers(init.headers);
  // 显式传入的 cookie 优先于 jar（评论测试需要精确控制 visitor_token）
  if (useJar && jar.size > 0 && !headers.has("cookie")) {
    headers.set("cookie", cookieHeader());
  }
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers, redirect: "manual" });
  if (useJar) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  return res;
}

function makeVisitorToken(): string {
  const raw = randomBytes(32).toString("hex");
  const sig = createHmac("sha256", VISITOR_SECRET).update(raw).digest("hex").slice(0, 32);
  return raw + sig;
}

function withVisitorCookie(token: string): HeadersInit {
  return { "Content-Type": "application/json", cookie: `visitor_token=${token}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startServer(): Promise<void> {
  const nextBin = path.resolve("node_modules/next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "dev", "--port", String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: "file:./test.db",
      CONTENT_POSTS_DIR: path.join(tmpRoot, "content", "posts"),
      IP_HASH_SECRET: IP_SECRET,
      VISITOR_TOKEN_SECRET: VISITOR_SECRET,
      APP_URL: BASE,
      COMMENT_COOLDOWN_SECONDS: "600",
      COMMENT_RATE_LIMIT_WINDOW_SECONDS: "2",
      COMMENT_RATE_LIMIT_MAX_ATTEMPTS: "3",
      CAPTCHA_ENABLED: "false",
      COMMENT_LLM_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health/live`);
      if (res.ok) return;
    } catch {
      /* not ready yet */
    }
    await sleep(500);
  }
  throw new Error("dev server failed to start in time");
}

beforeAll(async () => {
  // 1. 临时内容 git 仓库（拷贝真实种子文章）
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blog-integration-"));
  const postsDir = path.join(tmpRoot, "content", "posts");
  fs.mkdirSync(postsDir, { recursive: true });
  for (const f of fs.readdirSync("content/posts")) {
    if (f.endsWith(".md")) fs.copyFileSync(path.join("content/posts", f), path.join(postsDir, f));
  }
  const git = (args: string) => execSync(`git ${args}`, { cwd: tmpRoot, stdio: "ignore" });
  git("init -q -b main");
  git('config user.email "test@example.com"');
  git('config user.name "integration-test"');
  git("add -A");
  git('commit -q -m "init"');

  // 2. 测试数据库（先清掉旧库再迁移）
  for (const suffix of ["", "-journal"]) {
    const dbFile = path.resolve(`prisma/test.db${suffix}`);
    if (fs.existsSync(dbFile)) fs.rmSync(dbFile);
  }
  execSync("pnpm prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "ignore",
  });

  // 3. 进程内 PrismaClient（env 必须在 import 前设置 → 动态导入）
  process.env.DATABASE_URL = "file:./test.db";
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  db = prisma as unknown as typeof db;

  // 4. 种子：内容同步 + 分类/标签预置 + 管理员
  const { syncContent } = await import("../../lib/content-sync");
  process.env.CONTENT_POSTS_DIR = path.join(tmpRoot, "content", "posts");
  await syncContent();
  const { seedTaxonomy } = await import("../../scripts/seed-taxonomy");
  await seedTaxonomy();
  await prisma.adminUser.create({
    data: {
      username: admin.username,
      passwordHash: await bcrypt.hash(admin.password, 4),
      active: true,
    },
  });

  // 5. 启动 dev server
  await startServer();
}, 240_000);

afterAll(async () => {
  if (server) {
    server.kill();
    // Windows 上需要确保子进程树退出（SQLite 文件句柄释放后才删得掉测试库）
    if (process.platform === "win32" && server.pid) {
      try {
        execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
      } catch {
        /* already exited */
      }
    }
    await sleep(1500);
  }
  await db?.$disconnect?.();
  // 尽力清理：文件被占用时重试几次，仍失败不判定测试失败
  for (const suffix of ["", "-journal"]) {
    const dbFile = path.resolve(`prisma/test.db${suffix}`);
    for (let attempt = 0; attempt < 3 && fs.existsSync(dbFile); attempt++) {
      try {
        fs.rmSync(dbFile);
      } catch {
        await sleep(1000);
      }
    }
  }
  if (tmpRoot) {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}, 60_000);

describe("公开内容安全边界", () => {
  it("草稿文章页面 404，公开文章 200", async () => {
    const draft = await req("/posts/draft-post");
    expect(draft.status).toBe(404);
    const pub = await req("/posts/hello-world");
    expect(pub.status).toBe(200);
    expect(await pub.text()).toContain("我的第一篇学习笔记");
  });

  it("草稿不出现在 RSS / Sitemap / 搜索", async () => {
    const rss = await (await req("/rss.xml")).text();
    const sitemap = await (await req("/sitemap.xml")).text();
    expect(rss).not.toContain("draft-post");
    expect(sitemap).not.toContain("draft-post");
    const search = (await (await req("/api/search?q=草稿")).json()) as { articles: { slug: string }[] };
    expect(search.articles.some((a) => a.slug === "draft-post")).toBe(false);
  });

  it("未登录访问后台 API 一律 401（含 GET /api/admin/posts/[id] 回归）", async () => {
    expect((await req("/api/admin/posts", {}, { useJar: false })).status).toBe(401);
    const draft = (await db!.article.findUnique({
      where: { slug: "draft-post" },
    })) as { id: string } | null;
    expect(draft).toBeTruthy();
    const res = await req(`/api/admin/posts/${draft!.id}`, {}, { useJar: false });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });
});

describe("管理员后台全链路", () => {
  it("登录成功并下发 session cookie", async () => {
    const res = await req("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(admin),
    });
    expect(res.status).toBe(200);
    expect(jar.has("SESSION")).toBe(true);
  });

  it("无 CSRF token 的写操作 403（P0-2 回归）", async () => {
    const res = await req("/api/admin/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("GET /api/csrf 播种 cookie 并返回 token", async () => {
    const res = await req("/api/csrf");
    const body = (await res.json()) as { csrfToken: string };
    expect(res.status).toBe(200);
    expect(jar.has("CSRF")).toBe(true);
    csrfToken = body.csrfToken;
    expect(csrfToken).toBeTruthy();
  });

  let createdId = "";

  it("创建文章：201 + git commit 产生（P1-9 验收项）", async () => {
    const res = await req("/api/admin/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        slug: "integration-post",
        title: "集成测试文章",
        summary: "来自集成测试",
        status: "draft",
        category: "测试",
        tags: ["集成测试"],
        body: "# 集成测试\n\n这是集成测试创建的正文。",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { post: { id: string }; commitSha: string };
    createdId = body.post.id;
    expect(createdId).toBeTruthy();
    expect(body.commitSha).toMatch(/^[0-9a-f]{7,}$/);
    const filePath = path.join(tmpRoot, "content", "posts", "integration-post.md");
    expect(fs.existsSync(filePath)).toBe(true);
    const log = execSync("git log --oneline", { cwd: tmpRoot, encoding: "utf-8" });
    expect(log.trim().split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("编辑文章：200 + 新 commit + 正文更新", async () => {
    const res = await req(`/api/admin/posts/${createdId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        slug: "integration-post",
        title: "集成测试文章（已编辑）",
        summary: "来自集成测试",
        status: "draft",
        category: "测试",
        tags: ["集成测试"],
        body: "# 集成测试\n\n编辑后的正文。",
      }),
    });
    expect(res.status).toBe(200);
    const raw = fs.readFileSync(
      path.join(tmpRoot, "content", "posts", "integration-post.md"),
      "utf-8"
    );
    expect(raw).toContain("编辑后的正文");
  });

  it("发布文章：公开页立即可见", async () => {
    const res = await req(`/api/admin/posts/${createdId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const page = await req("/posts/integration-post");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("集成测试文章（已编辑）");
  });

  it("slug 改名保留 article id 与评论（P1-2 回归）", async () => {
    const before = (await db!.article.findUnique({ where: { id: createdId } })) as {
      id: string;
    } | null;
    expect(before).toBeTruthy();
    await db!.comment.create({
      data: {
        articleId: createdId,
        bodyText: "改名前留下的评论",
        status: "approved",
      },
    });
    const res = await req(`/api/admin/posts/${createdId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        slug: "renamed-post",
        title: "集成测试文章（已编辑）",
        summary: "来自集成测试",
        status: "public",
        category: "测试",
        tags: ["集成测试"],
        body: "# 集成测试\n\n改名后的正文。",
      }),
    });
    expect(res.status).toBe(200);
    const after = (await db!.article.findUnique({ where: { id: createdId } })) as {
      slug: string;
    } | null;
    expect(after?.slug).toBe("renamed-post");
    const comments = await db!.comment.findMany({
      where: { articleId: createdId },
    });
    expect(comments).toHaveLength(1);
    const page = await req("/posts/renamed-post");
    expect(page.status).toBe(200);
  });

  it("删除文章：物理删除，列表不再出现，页面 404（P1-2 归档语义被方案 C 取代）", async () => {
    const res = await req(`/api/admin/posts/${createdId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deletedArticleId?: string };
    expect(body.deletedArticleId).toBeTruthy();
    const page = await req("/posts/renamed-post");
    expect(page.status).toBe(404);
    // 物理删除：DB 记录不再存在（不再走"归档"路径）
    const gone = (await db!.article.findUnique({ where: { id: createdId } })) as {
      id: string;
    } | null;
    expect(gone).toBeNull();
    // 管理列表不再出现该文章
    const list = (await (await req("/api/admin/posts")).json()) as {
      items: { id: string }[];
    };
    expect(list.items.some((p) => p.id === createdId)).toBe(false);
  });
});

describe("评论管线", () => {
  let tokenA = "";

  it("正常提交：200 + 入库 pending + 公开列表不显示", async () => {
    await sleep(2300); // 避开限流窗口
    tokenA = makeVisitorToken();
    const res = await req("/api/posts/hello-world/comments", {
      method: "POST",
      headers: withVisitorCookie(tokenA),
      body: JSON.stringify({ bodyText: "这是一条集成测试评论，长度肯定超过两个字符。" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    const list = (await (await req("/api/posts/hello-world/comments")).json()) as {
      comments: unknown[];
    };
    expect(list.comments).toHaveLength(0);
    const pending = await db!.comment.findMany({ where: { bodyText: { contains: "集成测试评论" } } });
    expect(pending).toHaveLength(1);
    expect((pending[0] as { status: string }).status).toBe("pending");
  });

  it("同一访客 10 分钟冷却：第二个请求 429", async () => {
    const res = await req("/api/posts/hello-world/comments", {
      method: "POST",
      headers: withVisitorCookie(tokenA),
      body: JSON.stringify({ bodyText: "冷却期内再次提交，应该被拒绝。" }),
    });
    expect(res.status).toBe(429);
  });

  it("正则 reject：统一提示、不落库、警告 +2（低优先级 reject 也生效）", async () => {
    await db!.regexRule.create({
      data: { name: "集成-禁词", pattern: "forbiddenword", action: "reject", priority: 1, warningIncrement: 2, enabled: true },
    });
    // 故意放一条低优先级 reject（priority 更小），验证 P1-8 遍历修复
    await db!.regexRule.create({
      data: { name: "集成-禁词2", pattern: "lowprioritybad", action: "reject", priority: 0, warningIncrement: 1, enabled: true },
    });
    await sleep(2300);
    const res = await req("/api/posts/hello-world/comments", {
      method: "POST",
      headers: withVisitorCookie(makeVisitorToken()),
      body: JSON.stringify({ bodyText: "这里包含 forbiddenword 应该被拦截" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true); // 对外统一提示，不泄露"被拒"
    expect(await db!.comment.count({ where: { bodyText: { contains: "forbiddenword" } } })).toBe(0);
    // 低优先级 reject（第一条未命中时）也能拦截
    await sleep(2300);
    const res2 = await req("/api/posts/hello-world/comments", {
      method: "POST",
      headers: withVisitorCookie(makeVisitorToken()),
      body: JSON.stringify({ bodyText: "这里包含 lowprioritybad 应该被拦截" }),
    });
    expect(res2.status).toBe(200);
    expect(
      await db!.comment.count({ where: { bodyText: { contains: "lowprioritybad" } } })
    ).toBe(0);
  });

  it("审核链：未启用 LLM 且配置了正则时，未命中规则的提交自动通过（approved）", async () => {
    // 此时分（前一个用例创建的）正则规则仍在且 LLM 未启用：
    // 主人伪代码——规则判定安全（none/replace）→ 自动通过，不再一律转人工
    await sleep(2300);
    const res = await req("/api/posts/hello-world/comments", {
      method: "POST",
      headers: withVisitorCookie(makeVisitorToken()),
      body: JSON.stringify({ bodyText: "这条评论没有命中任何规则，应该被自动放行展示。" }),
    });
    expect(res.status).toBe(200);
    const approved = await db!.comment.findFirst({
      where: { bodyText: { contains: "自动放行展示" } },
    });
    expect(approved?.status).toBe("approved");
  });

  it("审核链：规则与 LLM 均未配置时，提交保守转人工（pending）", async () => {
    // 清空规则后（同时未启用 LLM）：唯一防线都不存在 → 保守 pending
    await db!.regexRule.deleteMany({});
    await sleep(2300);
    const res = await req("/api/posts/hello-world/comments", {
      method: "POST",
      headers: withVisitorCookie(makeVisitorToken()),
      body: JSON.stringify({ bodyText: "没有任何审核配置时，这条评论应当转人工。" }),
    });
    expect(res.status).toBe(200);
    const pending = await db!.comment.findFirst({
      where: { bodyText: { contains: "应当转人工" } },
    });
    expect(pending?.status).toBe("pending");
    // 还原禁词规则：后续"自动封禁"用例依赖这些规则累计警告
    await db!.regexRule.create({
      data: { name: "集成-禁词", pattern: "forbiddenword", action: "reject", priority: 1, warningIncrement: 2, enabled: true },
    });
    await db!.regexRule.create({
      data: { name: "集成-禁词2", pattern: "lowprioritybad", action: "reject", priority: 0, warningIncrement: 1, enabled: true },
    });
  });

  it("限流滑动窗口：第 4 次提交 429（MAX_ATTEMPTS=3 真实生效）", async () => {
    await sleep(2300);
    // 并发发出 4 个不同访客 token 的提交（避开冷却），共享同一 IP 限流窗口
    const results = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        req("/api/posts/hello-world/comments", {
          method: "POST",
          headers: withVisitorCookie(makeVisitorToken()),
          body: JSON.stringify({ bodyText: `限流窗口内的快速提交 ${i}，内容长度足够。` }),
        })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("自动封禁：警告累计达 DB 阈值触发 IP 封禁，后续评论 403", async () => {
    // 通过后台 API 保存阈值（PUT 会立即失效服务端设置缓存，规避 5s TTL 竞态）
    const put = await req("/api/admin/site-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ autoBanWarningThreshold: 2 }),
    });
    expect(put.status).toBe(200);
    await sleep(2300);
    const res = await req("/api/posts/hello-world/comments", {
      method: "POST",
      headers: withVisitorCookie(makeVisitorToken()),
      body: JSON.stringify({ bodyText: "触发禁词 forbiddenword 以累计警告" }),
    });
    expect(res.status).toBe(200);
    const ban = (await db!.visitorBan.findFirst({
      where: { matchType: "ip", revokedAt: null, createdBy: "system" },
    })) as { id: string } | null;
    expect(ban).toBeTruthy();
    await sleep(2300);
    const blocked = await req("/api/posts/hello-world/comments", {
      method: "POST",
      headers: withVisitorCookie(makeVisitorToken()),
      body: JSON.stringify({ bodyText: "已被封禁的访客再提交，应当 403。" }),
    });
    expect(blocked.status).toBe(403);
  });
});

describe("评论审核闭环与阅读量", () => {
  it("管理员批准后公开显示", async () => {
    const pending = (await db!.comment.findMany({
      where: { status: "pending", deletedAt: null },
    })) as { id: string; bodyText: string }[];
    expect(pending.length).toBeGreaterThan(0);
    const target = pending[0];
    const res = await req(`/api/admin/comments/${target.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const list = (await (await req("/api/posts/hello-world/comments")).json()) as {
      comments: { id: string }[];
    };
    expect(list.comments.some((c) => c.id === target.id)).toBe(true);
  });

  it("站点设置 API 保存后可读回（P1-5 回归）", async () => {
    const res = await req("/api/admin/site-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ autoBanWarningThreshold: 4 }),
    });
    expect(res.status).toBe(200);
    const get = (await (await req("/api/admin/site-settings")).json()) as {
      settings: { autoBanWarningThreshold: number };
    };
    expect(get.settings.autoBanWarningThreshold).toBe(4);
  });

  it("阅读量异步累计；管理员会话浏览不计入（P1-7 回归）", async () => {
    await req("/posts/hello-world");
    const deadline = Date.now() + 15_000;
    let count = 0;
    while (Date.now() < deadline) {
      count = await db!.articleViewDedup.count({
        where: { article: { slug: "hello-world" } },
      });
      if (count >= 1) break;
      await sleep(500);
    }
    expect(count).toBeGreaterThanOrEqual(1);
    // 管理员（带 SESSION cookie）访问不再累计
    const before = await db!.articleViewDedup.count({
      where: { article: { slug: "hello-world" } },
    });
    await req("/posts/hello-world");
    await sleep(2000);
    const afterAdmin = await db!.articleViewDedup.count({
      where: { article: { slug: "hello-world" } },
    });
    expect(afterAdmin).toBe(before);
  });
});

describe("评论游客可见开关", () => {
  /** 剥离 <script>（RSC flight 数据/chunk 文件名属字典/配置项范畴），只看可见 DOM 语义 */
  function visibleDom(html: string): string {
    return html.replace(/<script[\s\S]*?<\/script>/gi, "");
  }

  it("开关关闭：游客文章页不出现任何评论语义，管理员仍可见", async () => {
    // 通过后台 API 关闭（PUT 立即失效服务端设置缓存，规避 5s TTL 竞态）
    const put = await req("/api/admin/site-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ commentsVisibleToGuests: false }),
    });
    expect(put.status).toBe(200);

    // 游客（无 cookie）：评论区标题/列表/提交框/空状态一概不渲染
    const guest = await req("/posts/hello-world", {}, { useJar: false });
    expect(guest.status).toBe(200);
    const guestDom = visibleDom(await guest.text());
    expect(guestDom).not.toMatch(/comment/i);
    expect(guestDom).not.toContain("评论");

    // 管理员（登录态）：预览/调试不受开关影响，评论区仍完整渲染
    const adminPage = await req("/posts/hello-world");
    expect(adminPage.status).toBe(200);
    expect(visibleDom(await adminPage.text())).toContain('id="comment-body"');
  });

  it("开关开启：游客文章页恢复正常渲染评论区", async () => {
    const put = await req("/api/admin/site-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ commentsVisibleToGuests: true }),
    });
    expect(put.status).toBe(200);

    const guest = await req("/posts/hello-world", {}, { useJar: false });
    expect(guest.status).toBe(200);
    const guestDom = visibleDom(await guest.text());
    expect(guestDom).toContain('id="comment-body"');
    expect(guestDom).toContain("评论");
  });
});

describe("分类标签管理 taxonomy", () => {
  // 惰性取 csrfToken（describe 收集期该变量尚未由登录流程赋值）
  const jsonHeaders = () => ({
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfToken,
  });

  it("未登录访问 taxonomy API 一律 401", async () => {
    expect((await req("/api/admin/taxonomy", {}, { useJar: false })).status).toBe(401);
    const post = await req("/api/admin/taxonomy/category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "游客分类" }),
    }, { useJar: false });
    expect(post.status).toBe(401);
    const del = await req("/api/admin/taxonomy/tag/whatever", {
      method: "DELETE",
    }, { useJar: false });
    expect(del.status).toBe(401);
  });

  it("登录后无 CSRF 的写操作 403", async () => {
    const res = await req("/api/admin/taxonomy/category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "无CSRF分类" }),
    });
    expect(res.status).toBe(403);
  });

  it("GET 列表包含预置分类/标签（seed 幂等写入）", async () => {
    const res = await req("/api/admin/taxonomy");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      categories: { name: string }[];
      tags: { name: string }[];
    };
    const catNames = body.categories.map((c) => c.name);
    const tagNames = body.tags.map((t) => t.name);
    for (const name of ["技术", "部署运维", "AI", "随笔"]) {
      expect(catNames).toContain(name);
    }
    for (const name of ["计算机基础", "算法", "Linux系统", "Windows系统", "环境", "AI智能体", "git", "docker"]) {
      expect(tagNames).toContain(name);
    }
  });

  it("POST 分类：正常创建 201；重名 409；列表可见", async () => {
    const create = await req("/api/admin/taxonomy/category", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "集成测试分类" }),
    });
    expect(create.status).toBe(201);
    const dup = await req("/api/admin/taxonomy/category", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "集成测试分类" }),
    });
    expect(dup.status).toBe(409);
    const list = (await (await req("/api/admin/taxonomy")).json()) as {
      categories: { name: string }[];
    };
    expect(list.categories.some((c) => c.name === "集成测试分类")).toBe(true);
  });

  it("POST 标签：正常创建 201；重名 409", async () => {
    const create = await req("/api/admin/taxonomy/tag", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "集成测试标签" }),
    });
    expect(create.status).toBe(201);
    const dup = await req("/api/admin/taxonomy/tag", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "集成测试标签" }),
    });
    expect(dup.status).toBe(409);
  });

  it("PUT 分类重命名：200 且文章引用同步改写；改成已存在名 409", async () => {
    const created = (await (
      await req("/api/admin/taxonomy/category", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "重命名前分类" }),
      })
    ).json()) as { category: { id: string } };
    // 让一篇文章引用该分类，验证重命名级联改写字符串字段
    const article = (await db!.article.findUnique({
      where: { slug: "hello-world" },
    })) as { id: string } | null;
    expect(article).toBeTruthy();
    await db!.article.update({
      where: { id: article!.id },
      data: { category: "重命名前分类" },
    });

    const renamed = await req(
      `/api/admin/taxonomy/category/${created.category.id}`,
      { method: "PUT", headers: jsonHeaders(), body: JSON.stringify({ name: "重命名后分类" }) }
    );
    expect(renamed.status).toBe(200);
    const after = (await db!.article.findUnique({
      where: { slug: "hello-world" },
    })) as { category: string } | null;
    expect(after?.category).toBe("重命名后分类");

    // 与预置分类「技术」重名 → 409
    const conflict = await req(
      `/api/admin/taxonomy/category/${created.category.id}`,
      { method: "PUT", headers: jsonHeaders(), body: JSON.stringify({ name: "技术" }) }
    );
    expect(conflict.status).toBe(409);
  });

  it("DELETE 分类：被文章引用 409；无引用 200 且列表移除", async () => {
    // 上一个用例中 hello-world 仍引用「重命名后分类」，需要先找到其 id
    const list = (await (await req("/api/admin/taxonomy")).json()) as {
      categories: { id: string; name: string }[];
    };
    const referenced = list.categories.find((c) => c.name === "重命名后分类");
    expect(referenced).toBeTruthy();
    const denied = await req(`/api/admin/taxonomy/category/${referenced!.id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
    expect(denied.status).toBe(409);
    const deniedBody = (await denied.json()) as { error?: string };
    expect(deniedBody.error).toContain("引用");

    const created = (await (
      await req("/api/admin/taxonomy/category", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "待删分类" }),
      })
    ).json()) as { category: { id: string } };
    const removed = await req(`/api/admin/taxonomy/category/${created.category.id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
    expect(removed.status).toBe(200);
    const after = (await (await req("/api/admin/taxonomy")).json()) as {
      categories: { name: string }[];
    };
    expect(after.categories.some((c) => c.name === "待删分类")).toBe(false);
  });

  it("PUT 标签重命名 200；DELETE 被引用 409、解除引用后 200", async () => {
    const created = (await (
      await req("/api/admin/taxonomy/tag", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "生命周期标签" }),
      })
    ).json()) as { tag: { id: string } };
    const tagId = created.tag.id;

    const renamed = await req(`/api/admin/taxonomy/tag/${tagId}`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "生命周期标签改" }),
    });
    expect(renamed.status).toBe(200);

    // 关联一篇文章后删除被拒（ArticleTag 关联表计数）
    const article = (await db!.article.findUnique({
      where: { slug: "hello-world" },
    })) as { id: string } | null;
    expect(article).toBeTruthy();
    await db!.articleTag.create({
      data: { articleId: article!.id, tagId },
    });
    const denied = await req(`/api/admin/taxonomy/tag/${tagId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
    expect(denied.status).toBe(409);
    expect(((await denied.json()) as { error?: string }).error).toContain("引用");

    await db!.articleTag.deleteMany({ where: { tagId } });
    const removed = await req(`/api/admin/taxonomy/tag/${tagId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
    expect(removed.status).toBe(200);
  });
});

describe("文章物理删除与存档（方案 C）", () => {
  const jsonHeaders = () => ({
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfToken,
  });
  let articleId = "";
  let deletedArticleId = "";
  const SLUG = "physical-del-test";
  const TITLE = "物理删除测试文章";
  const BODY_MARKER = "存档快照正文标记XYZ";
  const COMMENT_APPROVED = "存档批准评论ABC";
  const COMMENT_PENDING = "存档待审评论DEF";

  it("删除已发布文章：200、列表不再出现、公开页 404、DB 记录消失", async () => {
    // 建文 → 发布 → 造两条不同状态的评论 → 删除
    const create = await req("/api/admin/posts", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        slug: SLUG,
        title: TITLE,
        summary: "物理删除链路验证",
        status: "draft",
        category: "测试",
        tags: ["集成测试"],
        body: `# 物理删除\n\n${BODY_MARKER}。`,
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { post: { id: string } };
    articleId = created.post.id;
    const publish = await req(`/api/admin/posts/${articleId}/publish`, {
      method: "POST",
      headers: jsonHeaders(),
      body: "{}",
    });
    expect(publish.status).toBe(200);
    await db!.comment.create({
      data: { articleId, bodyText: COMMENT_APPROVED, status: "approved" },
    });
    await db!.comment.create({
      data: { articleId, bodyText: COMMENT_PENDING, status: "pending" },
    });

    const del = await req(`/api/admin/posts/${articleId}`, {
      method: "DELETE",
      headers: jsonHeaders(),
    });
    expect(del.status).toBe(200);
    const delBody = (await del.json()) as { deletedArticleId?: string };
    expect(delBody.deletedArticleId).toBeTruthy();
    deletedArticleId = delBody.deletedArticleId!;

    // 管理列表（任一状态筛选）不再出现
    const list = (await (await req("/api/admin/posts")).json()) as {
      items: { id: string }[];
    };
    expect(list.items.some((p) => p.id === articleId)).toBe(false);
    // 公开页 404，DB 记录物理消失
    expect((await req(`/posts/${SLUG}`)).status).toBe(404);
    const gone = (await db!.article.findUnique({ where: { id: articleId } })) as {
      id: string;
    } | null;
    expect(gone).toBeNull();
  });

  it("删除后再次删除 → 404（不再报 git 错误）", async () => {
    const res = await req(`/api/admin/posts/${articleId}`, {
      method: "DELETE",
      headers: jsonHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("DeletedArticle/DeletedComment 存档记录完整（快照/版本/评论）", async () => {
    const archived = (await db!.deletedArticle.findFirst({
      where: { originalId: articleId },
    })) as Record<string, unknown> | null;
    expect(archived).toBeTruthy();
    expect(archived!.slug).toBe(SLUG);
    expect(archived!.title).toBe(TITLE);
    expect(archived!.status).toBe("public");
    expect(archived!.id).toBe(deletedArticleId);
    // md 快照含正文与 frontmatter
    expect(String(archived!.rawMarkdown)).toContain(BODY_MARKER);
    expect(String(archived!.rawMarkdown)).toContain(TITLE);
    // 版本历史快照：此前 create/update 记录 + 删除提交记录
    const versions = JSON.parse(String(archived!.versionsJson)) as {
      commitSha: string;
      action: string;
    }[];
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions[versions.length - 1].action).toBe("delete");
    expect(versions[versions.length - 1].commitSha).toBeTruthy();
    expect(String(archived!.commitSha)).toBe(
      versions[versions.length - 1].commitSha
    );
    // 评论逐条存档，状态保留
    const comments = (await db!.deletedComment.findFirst({
      where: { deletedArticleId: deletedArticleId },
    })) as { bodyText: string } | null;
    expect(comments).toBeTruthy();
    const archivedComments = await db!.deletedComment.count({
      where: { deletedArticleId: deletedArticleId },
    });
    expect(archivedComments).toBe(2);
  });

  it("已删文章评论出现在 scope=deleted，且不在正常列表", async () => {
    const deletedScope = (await (
      await req("/api/admin/comments?scope=deleted")
    ).json()) as {
      items: {
        bodyText: string;
        isFromDeletedArticle?: boolean;
        deletedArticleTitle?: string;
      }[];
    };
    const archivedOne = deletedScope.items.find(
      (c) => c.bodyText === COMMENT_APPROVED
    );
    expect(archivedOne).toBeTruthy();
    expect(archivedOne!.isFromDeletedArticle).toBe(true);
    expect(archivedOne!.deletedArticleTitle).toBe(TITLE);

    const normalScope = (await (await req("/api/admin/comments")).json()) as {
      items: { bodyText: string }[];
    };
    expect(normalScope.items.some((c) => c.bodyText === COMMENT_APPROVED)).toBe(
      false
    );
    expect(normalScope.items.some((c) => c.bodyText === COMMENT_PENDING)).toBe(
      false
    );
  });

  it("删除后编辑该文章 → 404", async () => {
    const res = await req(`/api/admin/posts/${articleId}`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({
        slug: SLUG,
        title: TITLE,
        status: "draft",
        body: "# 不应成功",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("已删文章评论可物理删除：200 后记录消失，再删 404", async () => {
    const target = (await db!.deletedComment.findFirst({
      where: { deletedArticleId: deletedArticleId, bodyText: COMMENT_PENDING },
    })) as { id: string } | null;
    expect(target).toBeTruthy();
    const del = await req(`/api/admin/deleted-comments/${target!.id}`, {
      method: "DELETE",
      headers: jsonHeaders(),
    });
    expect(del.status).toBe(200);
    const gone = (await db!.deletedComment.findUnique({
      where: { id: target!.id },
    })) as { id: string } | null;
    expect(gone).toBeNull();
    const again = await req(`/api/admin/deleted-comments/${target!.id}`, {
      method: "DELETE",
      headers: jsonHeaders(),
    });
    expect(again.status).toBe(404);
  });

  it("存档评论不支持审核：approve 端点对存档 id 返回 404", async () => {
    const remaining = (await db!.deletedComment.findFirst({
      where: { deletedArticleId: deletedArticleId, bodyText: COMMENT_APPROVED },
    })) as { id: string } | null;
    expect(remaining).toBeTruthy();
    const res = await req(`/api/admin/comments/${remaining!.id}/approve`, {
      method: "POST",
      headers: jsonHeaders(),
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});

describe("登录限流（最后执行，避免污染 IP 桶）", () => {
  it("连续 5 次失败后锁定：第 6 次即使密码正确也 429", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await req("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: admin.username, password: "wrong-password" }),
      }, { useJar: false });
      expect([401, 429]).toContain(res.status);
    }
    const locked = await req("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(admin),
    }, { useJar: false });
    expect(locked.status).toBe(429);
  });
});

describe("ComfyUI 公共端点（P0-1/P0-2 回归）", () => {
  function minimalPng(): Buffer {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdrData = Buffer.alloc(13, 0);
    ihdrData.writeUInt32BE(1, 0);
    ihdrData.writeUInt32BE(1, 4);
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 2; // truecolor
    const ihdr = Buffer.concat([
      Buffer.from([0, 0, 0, 13]),
      Buffer.from("IHDR"),
      ihdrData,
      Buffer.from([0, 0, 0, 0]),
    ]);
    const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    return Buffer.concat([sig, ihdr, iend]);
  }

  it("GET /comfyui 页面返回 200（P0-1：SQLite 迁移存在性回归）", async () => {
    const res = await req("/comfyui");
    expect(res.status).toBe(200);
  });

  it("登录态 FormData 上传 JSON 工作流 → 200 → 下载/详情校验 → 删除 200（P0-2 回归）", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from('{"nodes":[]}')], { type: "application/json" }), "workflow.json");
    form.append("title", "集成测试-工作流");
    const res = await req("/api/comfy/upload", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: form,
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as { id: string; type: string };
    expect(created.type).toBe("WORKFLOW");

    // 详情接口不泄露服务器路径（P2-2 回归）
    const detail = (await (await req(`/api/comfy/${created.id}`)).json()) as Record<string, unknown>;
    expect(detail.filePath).toBeUndefined();

    // 下载 Content-Type 白名单（P2-3 回归）
    const dl = await req(`/api/comfy/${created.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toContain("application/json");

    const del = await req(`/api/comfy/${created.id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
    expect(del.status).toBe(200);
  });

  it("登录态 FormData 上传 PNG 图片 → 200 → 下载 Content-Type=image/png → 删除 200", async () => {
    const form = new FormData();
    form.append("file", new Blob([minimalPng()], { type: "image/png" }), "pixel.png");
    form.append("title", "集成测试-图片");
    const res = await req("/api/comfy/upload", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: form,
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as { id: string };
    const dl = await req(`/api/comfy/${created.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("image/png");
    const del = await req(`/api/comfy/${created.id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
    expect(del.status).toBe(200);
  });

  it("未登录上传 → 401；分页参数非法 → 回退默认不 500", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("{}")], { type: "application/json" }), "x.json");
    const anon = await fetch(`${BASE}/api/comfy/upload`, { method: "POST", body: form });
    expect(anon.status).toBe(401);

    const badPage = await req("/api/comfy?page=-5&limit=99999");
    expect(badPage.status).toBe(200);
    const body = (await badPage.json()) as { pagination: { limit: number } };
    expect(body.pagination.limit).toBeLessThanOrEqual(100);
  });
});

describe("i18n 导航 SSR（v2 任务书：P2-5 回归）", () => {
  it("英文 cookie 下首页 HTML 含英文导航（Home/Posts/About）", async () => {
    const res = await fetch(`${BASE}/`, {
      headers: { cookie: "locale=en" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    // 至少其中一个英文标签要出现在 SSR HTML 中（不是依赖客户端 useEffect）
    expect(html).toMatch(/>(Home|Posts|About)</);
  });

  it("中文 cookie 下首页 HTML 含中文导航（首页/文章/关于）", async () => {
    const res = await fetch(`${BASE}/`, {
      headers: { cookie: "locale=zh-CN" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/(首页|文章|关于)/);
  });
});
