/**
 * 搜索纯函数单测（lib/search.ts，node 环境无 DB/DOM）。
 */
import { describe, it, expect } from "vitest";
import {
  splitQuery,
  scoreArticle,
  extractSnippet,
  highlightTokens,
  type SearchableArticle,
} from "@/lib/search";

function article(partial: Partial<SearchableArticle>): SearchableArticle {
  return {
    title: "",
    summary: "",
    category: "",
    plainTextCache: "",
    tagNames: [],
    ...partial,
  };
}

describe("splitQuery", () => {
  it("trim → 空白切分 → 去空 → 去重 → 小写", () => {
    expect(splitQuery("Docker  compose docker")).toEqual(["docker", "compose"]);
  });

  it("空查询返回空数组", () => {
    expect(splitQuery("   ")).toEqual([]);
  });
});

describe("scoreArticle", () => {
  it("大小写不敏感：标题含 Docker 命中 token docker（标题权重 3）", () => {
    const hit = scoreArticle(article({ title: "Docker 入门" }), ["docker"]);
    expect(hit).not.toBeNull();
    expect(hit!.score).toBe(3);
    expect(hit!.matchedTokens).toEqual(["docker"]);
  });

  it("标题命中得分高于仅正文命中", () => {
    const titleHit = scoreArticle(
      article({ title: "Docker 指南", plainTextCache: "无关内容" }),
      ["docker"]
    )!;
    const bodyHit = scoreArticle(
      article({ plainTextCache: "讲讲 docker 的用法" }),
      ["docker"]
    )!;
    expect(titleHit.score).toBe(3);
    expect(bodyHit.score).toBe(1);
    expect(titleHit.score).toBeGreaterThan(bodyHit.score);
  });

  it("OR 召回：只含『安装』的文章对 tokens=[docker, 安装] 仍命中", () => {
    const hit = scoreArticle(article({ summary: "环境安装教程" }), ["docker", "安装"]);
    expect(hit).not.toBeNull();
    expect(hit!.matchedTokens).toEqual(["安装"]);
    expect(hit!.score).toBe(2);
  });

  it("多 token 得分求和；标签命中按 tag 权重", () => {
    const hit = scoreArticle(article({ title: "docker", tagNames: ["compose"] }), [
      "docker",
      "compose",
    ]);
    expect(hit!.score).toBe(5);
  });

  it("全不命中返回 null", () => {
    expect(scoreArticle(article({ title: "foo" }), ["bar"])).toBeNull();
  });
});

describe("extractSnippet", () => {
  const longBody = "前".repeat(300) + "关键词出现" + "后".repeat(300);

  it("命中正文：返回含关键词、长度约 120、两侧带省略号的窗口", () => {
    const s = extractSnippet(longBody, ["关键词"])!;
    expect(s).toContain("关键词");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeGreaterThanOrEqual(120);
    expect(s.length).toBeLessThanOrEqual(122);
  });

  it("命中在文首：无前省略号", () => {
    const s = extractSnippet("关键词在最前面，" + "x".repeat(200), ["关键词"])!;
    expect(s.startsWith("关键词")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
  });

  it("正文不含任何 token 返回 null（标题/标签命中不出片段框）", () => {
    expect(extractSnippet("完全没有相关内容", ["docker"])).toBeNull();
  });

  it("大小写不敏感（正文大写、token 小写）", () => {
    expect(extractSnippet("Learn DOCKER today", ["docker"])).not.toBeNull();
  });
});

describe("highlightTokens", () => {
  function markTexts(nodes: ReturnType<typeof highlightTokens>): string[] {
    return nodes.filter(
      (n): n is { type: string; props: { children: string } } =>
        typeof n === "object" &&
        n !== null &&
        (n as { type?: unknown }).type === "mark"
    ).map((m) => m.props.children);
  }

  it("含正则元字符的 token（c++）不抛错、能正常包裹", () => {
    const nodes = highlightTokens("I love c++ very much", ["c++"]);
    expect(markTexts(nodes)).toEqual(["c++"]);
    // 多次出现时逐一包裹
    expect(markTexts(highlightTokens("c++ and c++", ["c++"]))).toEqual(["c++", "c++"]);
  });

  it("mark 带指定 className，children 为原文大小写", () => {
    const nodes = highlightTokens("使用 Docker 部署", ["docker"]);
    const marks = nodes.filter(
      (n): n is { type: string; props: { className: string; children: string } } =>
        typeof n === "object" && n !== null && (n as { type?: unknown }).type === "mark"
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].props.children).toBe("Docker");
    expect(marks[0].props.className).toContain("bg-yellow-200/70");
  });
});
