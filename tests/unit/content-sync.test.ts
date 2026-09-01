import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  hashString,
  slugifyName,
  parseSlug,
  parseStatus,
  parseDate,
  parseTags,
  markdownToPlainText,
  readPostsFromDisk,
  getCurrentCommitSha,
  syncContent,
} from "../../lib/content-sync";

const fsState = vi.hoisted(() => ({
  exists: true,
  files: [] as string[],
  contents: new Map<string, string>(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: () => fsState.exists,
    readdirSync: () => fsState.files,
    readFileSync: (p: unknown) => {
      const name = String(p).split(/[/\\]/).pop() as string;
      const c = fsState.contents.get(name);
      if (c === undefined) throw new Error(`ENOENT: ${name}`);
      return c;
    },
  },
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => "mock-commit-sha\n"),
}));

const mockDb = vi.hoisted(() => ({
  article: {
    findMany: vi.fn(async () => [] as unknown[]),
    upsert: vi.fn(async ({ where }: { where: { slug: string } }) => ({
      id: `id-${where.slug}`,
      slug: where.slug,
    })),
    update: vi.fn(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
    })),
    delete: vi.fn(async () => ({ slug: "" })),
  },
  category: { upsert: vi.fn(async () => ({ id: "cat-1" })) },
  tag: {
    upsert: vi.fn(async ({ where }: { where: { name: string } }) => ({
      id: `tag-${where.name}`,
    })),
  },
  articleTag: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    createMany: vi.fn(async () => ({ count: 1 })),
  },
  articleVersion: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  articleViewDedup: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  comment: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  $transaction: vi.fn(async () => []),
}));

vi.mock("../../lib/db", () => ({
  db: mockDb,
}));

function setDiskPosts(posts: Record<string, string>) {
  fsState.exists = true;
  fsState.files = Object.keys(posts).sort();
  fsState.contents = new Map(Object.entries(posts));
}

function frontmatter(fields: Record<string, string>, body: string): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

describe("lib/content-sync.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.article.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    fsState.files = [];
    fsState.contents.clear();
  });

  describe("hashString（内容哈希，幂等判定基础）", () => {
    it("同输入同输出、不同输入不同、64 位十六进制", () => {
      expect(hashString("abc")).toBe(hashString("abc"));
      expect(hashString("abc")).not.toBe(hashString("abd"));
      expect(hashString("abc")).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("slugifyName（标签/分类 slug 生成）", () => {
    it("小写化并以中划线分隔", () => {
      expect(slugifyName("Hello World")).toBe("hello-world");
      expect(slugifyName("hello_world")).toBe("hello-world");
    });

    it("保留 CJK 字符", () => {
      expect(slugifyName("测试 分类")).toBe("测试-分类");
    });

    it("去除符号、压缩中划线、去首尾中划线；空结果回退 unnamed", () => {
      expect(slugifyName("hello@world!")).toBe("helloworld");
      expect(slugifyName("---a---b---")).toBe("a-b");
      expect(slugifyName("")).toBe("unnamed");
      expect(slugifyName("!!!")).toBe("unnamed");
    });
  });

  describe("frontmatter 解析（parse*）", () => {
    it("parseSlug：合法通过、非法抛错", () => {
      expect(parseSlug("my-post")).toBe("my-post");
      expect(() => parseSlug("My_Post")).toThrow(/Invalid slug in content/);
      expect(() => parseSlug("../evil")).toThrow(/Invalid slug in content/);
      expect(() => parseSlug(undefined)).toThrow(/Invalid slug in content/);
    });

    it("parseStatus：三态校验，非法回退 draft", () => {
      expect(parseStatus("public")).toBe("public");
      expect(parseStatus("private")).toBe("private");
      expect(parseStatus("draft")).toBe("draft");
      expect(parseStatus("live")).toBe("draft");
      expect(parseStatus(null)).toBe("draft");
    });

    it("parseDate：合法返回 Date，非法返回 null", () => {
      expect(parseDate("2024-01-15T10:30:00Z")?.toISOString()).toBe(
        "2024-01-15T10:30:00.000Z"
      );
      expect(parseDate("")).toBeNull();
      expect(parseDate("garbage")).toBeNull();
      expect(parseDate(123)).toBeNull();
    });

    it("parseTags：过滤非字符串", () => {
      expect(parseTags(["a", 1, null, "b"])).toEqual(["a", "b"]);
      expect(parseTags("nope")).toEqual([]);
    });
  });

  describe("markdownToPlainText（搜索用纯文本缓存）", () => {
    it("去除代码块/行内代码/链接 URL/标题/引用/列表/强调/HTML", () => {
      const md = [
        "# Title",
        "> quote",
        "- item `code`",
        "![alt](img.png) [link](https://x.test)",
        "**bold** <span>html</span>",
        "```js",
        "const secret = 1;",
        "```",
      ].join("\n");
      const text = markdownToPlainText(md);
      expect(text).toContain("Title");
      expect(text).toContain("quote");
      expect(text).toContain("item");
      expect(text).toContain("alt");
      expect(text).toContain("link");
      expect(text).toContain("bold");
      expect(text).toContain("html");
      expect(text).not.toContain("https://x.test");
      expect(text).not.toContain("img.png");
      expect(text).not.toContain("const secret");
      expect(text).not.toContain("`");
      expect(text).not.toContain("#");
    });

    it("压缩连续空白", () => {
      expect(markdownToPlainText("a   b\n\n\nc")).toBe("a b c");
    });
  });

  describe("getCurrentCommitSha", () => {
    it("返回 git HEAD（去尾空白）", () => {
      expect(getCurrentCommitSha()).toBe("mock-commit-sha");
    });

    it("git 不可用时返回空字符串", async () => {
      const cp = await import("node:child_process");
      vi.mocked(cp.execSync).mockImplementationOnce(() => {
        throw new Error("no git");
      });
      expect(getCurrentCommitSha()).toBe("");
    });
  });

  describe("readPostsFromDisk（Git 路径校验）", () => {
    it("目录不存在返回空数组", () => {
      fsState.exists = false;
      expect(readPostsFromDisk()).toEqual([]);
    });

    it("sourcePath 固定为 posts/<文件名> 的 POSIX 路径（防止路径穿越参与索引）", () => {
      setDiskPosts({
        "my-post.md": frontmatter(
          { title: "T", slug: "my-post", status: "public" },
          "body"
        ),
      });
      const posts = readPostsFromDisk();
      expect(posts).toHaveLength(1);
      expect(posts[0].sourcePath).toBe("posts/my-post.md");
      expect(posts[0]).toMatchObject({
        slug: "my-post",
        title: "T",
        status: "public",
      });
    });

    it("忽略非 .md 文件", () => {
      setDiskPosts({
        "a.md": frontmatter({ title: "T", slug: "a" }, "body"),
        "b.txt": "not markdown",
      });
      fsState.files = ["a.md", "b.txt"];
      expect(readPostsFromDisk()).toHaveLength(1);
    });
  });

  describe("syncContent（幂等同步）", () => {
    const twoPosts = () =>
      setDiskPosts({
        "alpha.md": frontmatter(
          {
            title: "Alpha",
            slug: "alpha",
            status: "public",
            category: "Tech",
            publishedAt: "2024-01-01T00:00:00Z",
          },
          "alpha body"
        ),
        "beta.md": frontmatter(
          { title: "Beta", slug: "beta", status: "draft" },
          "beta body"
        ),
      });

    it("首次同步：全部为 created，并建立分类/标签计数", () => {
      twoPosts();
      mockDb.article.findMany.mockResolvedValue([]);
      return syncContent().then((result) => {
        expect(result.created).toBe(2);
        expect(result.updated).toBe(0);
        expect(result.archived).toBe(0);
        expect(result.categories).toBe(1);
        expect(result.commitSha).toBe("mock-commit-sha");
        expect(mockDb.article.upsert).toHaveBeenCalledTimes(2);
      });
    });

    it("再次同步相同内容：0 created / 0 archived（幂等）", async () => {
      twoPosts();
      mockDb.article.findMany.mockResolvedValue([
        { id: "id-alpha", slug: "alpha", sourcePath: "posts/alpha.md", archivedAt: null },
        { id: "id-beta", slug: "beta", sourcePath: "posts/beta.md", archivedAt: null },
      ]);
      const result = await syncContent();
      expect(result.created).toBe(0);
      expect(result.updated).toBe(2);
      expect(result.archived).toBe(0);
      expect(mockDb.$transaction).not.toHaveBeenCalled();
    });

    it("磁盘删除文件后同步：文章改为归档（不物理删除，评论/版本保留）", async () => {
      setDiskPosts({
        "alpha.md": frontmatter({ title: "Alpha", slug: "alpha" }, "body"),
      });
      mockDb.article.findMany.mockResolvedValue([
        { id: "id-alpha", slug: "alpha", sourcePath: "posts/alpha.md", archivedAt: null },
        { id: "id-beta", slug: "beta", sourcePath: "posts/beta.md", archivedAt: null },
      ]);
      const result = await syncContent();
      expect(result.archived).toBe(1);
      expect(result.updated).toBe(1);
      // 归档走 article.update，不再级联删除
      expect(mockDb.article.update).toHaveBeenCalledTimes(1);
      const updateArg = mockDb.article.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: "id-beta" });
      expect(updateArg.data.status).toBe("draft");
      expect(updateArg.data.archivedAt).toBeInstanceOf(Date);
      expect(mockDb.$transaction).not.toHaveBeenCalled();
      expect(mockDb.comment.deleteMany).not.toHaveBeenCalled();
      expect(mockDb.article.delete).not.toHaveBeenCalled();
    });

    it("已归档的文章不会重复归档", async () => {
      setDiskPosts({});
      fsState.files = [];
      mockDb.article.findMany.mockResolvedValue([
        { id: "id-old", slug: "old", sourcePath: "posts/old.md", archivedAt: new Date() },
      ]);
      const result = await syncContent();
      expect(result.archived).toBe(0);
      expect(mockDb.article.update).not.toHaveBeenCalled();
    });

    it("sourcePath 为空的记录（非内容来源）不会被同步归档", async () => {
      setDiskPosts({});
      fsState.files = [];
      mockDb.article.findMany.mockResolvedValue([
        { id: "id-manual", slug: "manual", sourcePath: "", archivedAt: null },
      ]);
      const result = await syncContent();
      expect(result.archived).toBe(0);
      expect(mockDb.article.update).not.toHaveBeenCalled();
    });

    it("parseDate 接受 Date 对象（裸 YAML 日期）与 ISO 字符串", () => {
      const d = new Date("2025-06-15T08:00:00.000Z");
      expect(parseDate(d)).toEqual(d);
      expect(parseDate("2025-06-15T08:00:00.000Z")).toEqual(d);
      expect(parseDate("not-a-date")).toBeNull();
      expect(parseDate(null)).toBeNull();
    });
  });
});
