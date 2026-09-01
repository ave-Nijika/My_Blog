import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import {
  parseSlug,
  parseStatus,
  parsePublishedAt,
  parseTags,
  estimateReadingTime,
  readAllPosts,
  getAllPosts,
  getPublicPosts,
  getPostBySlug,
  clearPostsCacheForTest,
} from "../../lib/content";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      readdirSync: vi.fn(() => []),
      readFileSync: vi.fn(() => ""),
    },
  };
});

function mockFiles(files: string[], content: string) {
  vi.mocked(fs.readdirSync).mockImplementation(() => files as never[]);
  vi.mocked(fs.readFileSync).mockImplementation(() => content);
}

describe("lib/content.ts", () => {
  beforeEach(() => {
    clearPostsCacheForTest();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearPostsCacheForTest();
  });

  describe("parseSlug（slug 校验）", () => {
    it("接受合法 slug：小写字母/数字/单个中划线分隔", () => {
      for (const slug of ["hello-world", "test123", "a-b-c", "123-456", "a"]) {
        expect(parseSlug(slug)).toBe(slug);
      }
    });

    it("拒绝非法 slug（大写/下划线/空格/连续中划线/首尾中划线/特殊字符/空）", () => {
      const invalid = [
        "Hello-World",
        "hello_world",
        "hello world",
        "hello--world",
        "-hello",
        "hello-",
        "",
        "hello.world",
        "hello@world",
        "../etc/passwd",
        "a/b",
      ];
      for (const slug of invalid) {
        expect(() => parseSlug(slug)).toThrow(/Invalid slug/);
      }
    });

    it("拒绝非字符串输入", () => {
      expect(() => parseSlug(undefined)).toThrow(/Invalid slug/);
      expect(() => parseSlug(123)).toThrow(/Invalid slug/);
      expect(() => parseSlug(null)).toThrow(/Invalid slug/);
    });
  });

  describe("parseStatus（状态校验）", () => {
    it("接受 draft / public / private", () => {
      expect(parseStatus("draft")).toBe("draft");
      expect(parseStatus("public")).toBe("public");
      expect(parseStatus("private")).toBe("private");
    });

    it("其它值一律回退为 draft（不抛错）", () => {
      expect(parseStatus("published")).toBe("draft");
      expect(parseStatus("")).toBe("draft");
      expect(parseStatus(null)).toBe("draft");
      expect(parseStatus(undefined)).toBe("draft");
      expect(parseStatus(1)).toBe("draft");
    });
  });

  describe("parsePublishedAt", () => {
    it("合法日期解析为 ISO 字符串", () => {
      expect(parsePublishedAt("2024-01-15T10:30:00Z")).toBe("2024-01-15T10:30:00.000Z");
    });

    it("非法日期/空值返回 null", () => {
      expect(parsePublishedAt(null)).toBeNull();
      expect(parsePublishedAt(undefined)).toBeNull();
      expect(parsePublishedAt("")).toBeNull();
      expect(parsePublishedAt("not-a-date")).toBeNull();
      expect(parsePublishedAt(123)).toBeNull();
    });
  });

  describe("parseTags", () => {
    it("保留字符串数组元素", () => {
      expect(parseTags(["a", "b"])).toEqual(["a", "b"]);
    });

    it("过滤非字符串元素；非数组返回空数组", () => {
      expect(parseTags(["a", 1, null, "b"])).toEqual(["a", "b"]);
      expect(parseTags(null)).toEqual([]);
      expect(parseTags("a")).toEqual([]);
    });
  });

  describe("estimateReadingTime（阅读时间估算）", () => {
    it("按 300 字符/分钟向上取整", () => {
      expect(estimateReadingTime("a".repeat(300))).toBe(1);
      expect(estimateReadingTime("a".repeat(301))).toBe(2);
      expect(estimateReadingTime("a".repeat(600))).toBe(2);
    });

    it("忽略空白字符", () => {
      const text = "a".repeat(150) + " \n\t".repeat(100) + "a".repeat(150);
      expect(estimateReadingTime(text)).toBe(1);
    });

    it("最少 1 分钟", () => {
      expect(estimateReadingTime("")).toBe(1);
      expect(estimateReadingTime("hello")).toBe(1);
    });
  });

  describe("readAllPosts（frontmatter 解析）", () => {
    it("解析完整 frontmatter", () => {
      mockFiles(
        ["post.md"],
        `---
title: Test Post
slug: test-post
summary: A test post
status: public
publishedAt: 2024-01-15T10:30:00Z
tags: [javascript, testing]
category: tech
pinned: true
---
Body content here.`
      );
      const posts = readAllPosts();
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({
        title: "Test Post",
        slug: "test-post",
        summary: "A test post",
        status: "public",
        category: "tech",
        pinned: true,
        tags: ["javascript", "testing"],
        publishedAt: "2024-01-15T10:30:00.000Z",
      });
      expect(posts[0].content).toContain("Body content here.");
    });

    it("缺省字段：状态回退 draft、空摘要、无标签、未置顶", () => {
      mockFiles(["minimal.md"], `---\ntitle: Minimal\nslug: minimal\n---\nContent`);
      const posts = readAllPosts();
      expect(posts[0]).toMatchObject({
        title: "Minimal",
        slug: "minimal",
        summary: "",
        status: "draft",
        category: "",
        pinned: false,
        tags: [],
        publishedAt: null,
      });
    });

    it("非法 status 回退 draft", () => {
      mockFiles(
        ["bad-status.md"],
        `---\ntitle: X\nslug: bad-status\nstatus: published\n---\nBody`
      );
      expect(readAllPosts()[0].status).toBe("draft");
    });

    it("非法 slug 抛错（阻止坏数据进入索引）", () => {
      mockFiles(["bad.md"], `---\ntitle: X\nslug: Bad_Slug\n---\nBody`);
      expect(() => readAllPosts()).toThrow(/Invalid slug/);
    });

    it("只处理 .md 文件", () => {
      mockFiles(["a.md", "b.txt", "c.md.bak"], `---\ntitle: X\nslug: x\n---\nBody`);
      expect(readAllPosts()).toHaveLength(1);
    });
  });

  describe("公共查询函数", () => {
    it("getAllPosts 返回全部文章（含 draft/private）", () => {
      mockFiles(
        ["draft.md"],
        `---\ntitle: D\nslug: draft-post\nstatus: draft\n---\nBody`
      );
      const posts = getAllPosts();
      expect(posts).toHaveLength(1);
      expect(posts[0].status).toBe("draft");
    });

    it("getPublicPosts 只返回 public，且置顶优先、其余按发布时间倒序", () => {
      clearPostsCacheForTest();
      const files = new Map<string, string>([
        [
          "a.md",
          `---\ntitle: Old\nslug: old-post\nstatus: public\npublishedAt: 2024-01-01T00:00:00Z\n---\nA`,
        ],
        [
          "b.md",
          `---\ntitle: New\nslug: new-post\nstatus: public\npublishedAt: 2024-02-01T00:00:00Z\n---\nB`,
        ],
        [
          "c.md",
          `---\ntitle: Pinned\nslug: pinned-post\nstatus: public\npublishedAt: 2024-01-15T00:00:00Z\npinned: true\n---\nC`,
        ],
        ["d.md", `---\ntitle: Draft\nslug: draft-post\nstatus: draft\n---\nD`],
        ["e.md", `---\ntitle: Priv\nslug: private-post\nstatus: private\n---\nE`],
      ]);
      vi.mocked(fs.readdirSync).mockImplementation(() => [...files.keys()] as never[]);
      vi.mocked(fs.readFileSync).mockImplementation(((p: unknown) => {
        const name = String(p).split(/[/\\]/).pop() as string;
        return files.get(name) ?? "";
      }) as typeof fs.readFileSync);

      const posts = getPublicPosts();
      expect(posts.map((p) => p.slug)).toEqual(["pinned-post", "new-post", "old-post"]);
    });

    it("getPostBySlug 命中与未命中", () => {
      clearPostsCacheForTest();
      mockFiles(["a.md"], `---\ntitle: A\nslug: a-post\nstatus: public\n---\nBody`);
      expect(getPostBySlug("a-post")?.title).toBe("A");
      expect(getPostBySlug("nope")).toBeUndefined();
    });
  });
});
