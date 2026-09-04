import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  extractSnippet,
  scoreArticle,
  splitQuery,
  type SearchableArticle,
} from "@/lib/search";

export type ArticleWithTags = Prisma.ArticleGetPayload<{
  include: {
    tags: { include: { tag: true } };
  };
}>;

export async function getPublicArticles(
  limit?: number
): Promise<ArticleWithTags[]> {
  return db.article.findMany({
    where: { status: "public" },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    ...(limit ? { take: limit } : {}),
    include: {
      tags: {
        include: { tag: true },
      },
    },
  });
}

export async function getPublicArticlesPage(
  page: number,
  perPage: number
): Promise<ArticleWithTags[]> {
  return db.article.findMany({
    where: { status: "public" },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    skip: Math.max((page - 1) * perPage, 0),
    take: perPage,
    include: {
      tags: {
        include: { tag: true },
      },
    },
  });
}

export async function countPublicArticles(): Promise<number> {
  return db.article.count({ where: { status: "public" } });
}

export async function getPublicArticleBySlug(
  slug: string
): Promise<ArticleWithTags | null> {
  return db.article.findFirst({
    where: { slug, status: "public" },
    include: {
      tags: {
        include: { tag: true },
      },
    },
  });
}

export async function getPublicArticleSlugs(): Promise<string[]> {
  const rows = await db.article.findMany({
    where: { status: "public" },
    select: { slug: true },
  });
  return rows.map((r) => r.slug);
}

export async function getSiteProfile() {
  const profile = await db.siteProfile.findFirst();
  if (profile) return profile;
  return db.siteProfile.create({
    data: {
      nickname: "主人",
      biography: "个人学习博客",
    },
  });
}

export async function getAllTagsWithCount() {
  const tags = await db.tag.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
    },
    orderBy: {
      name: "asc",
    },
  });
  
  const tagsWithCount = await Promise.all(
    tags.map(async (tag) => {
      const count = await db.article.count({
        where: {
          status: "public",
          tags: {
            some: {
              tag: {
                id: tag.id,
              },
            },
          },
        },
      });
      return {
        ...tag,
        _count: {
          articles: count,
        },
      };
    })
  );
  
  return tagsWithCount;
}

export async function getAllCategories() {
  const categories = await db.category.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
    },
    orderBy: {
      name: "asc",
    },
  });
  
  const categoriesWithCount = await Promise.all(
    categories.map(async (category) => {
      const count = await db.article.count({
        where: {
          status: "public",
          category: category.name,
        },
      });
      return {
        ...category,
        _count: {
          articles: count,
        },
      };
    })
  );
  
  return categoriesWithCount;
}

export async function getArticlesByTagSlug(tagSlug: string, page?: number, perPage?: number) {
  const articles = await db.article.findMany({
    where: {
      status: "public",
      tags: {
        some: {
          tag: {
            slug: tagSlug,
          },
        },
      },
    },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    include: {
      tags: {
        include: {
          tag: true,
        },
      },
    },
    ...(page && perPage
      ? {
          skip: Math.max((page - 1) * perPage, 0),
          take: perPage,
        }
      : {}),
  });
  return articles;
}

export async function getArticlesByCategorySlug(
  categorySlug: string,
  page?: number,
  perPage?: number
) {
  const articles = await db.article.findMany({
    where: {
      status: "public",
      category: categorySlug,
    },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    include: {
      tags: {
        include: {
          tag: true,
        },
      },
    },
    ...(page && perPage
      ? {
          skip: Math.max((page - 1) * perPage, 0),
          take: perPage,
        }
      : {}),
  });
  return articles;
}

export async function countArticlesByTagSlug(tagSlug: string): Promise<number> {
  return db.article.count({
    where: {
      status: "public",
      tags: {
        some: {
          tag: {
            slug: tagSlug,
          },
        },
      },
    },
  });
}

export async function countArticlesByCategorySlug(
  categorySlug: string
): Promise<number> {
  return db.article.count({
    where: {
      status: "public",
      category: categorySlug,
    },
  });
}

export interface SearchRunResult {
  /** 命中文章，相关度降序（同分按发布时间降序） */
  matched: ArticleWithTags[];
  /** 文章 id → 正文匹配片段（仅正文命中的文章有） */
  snippets: Record<string, string>;
}

/**
 * 搜索核心：取全量公开文章后，在应用层完成大小写不敏感匹配、打分、排序
 * 与片段提取（lib/search.ts 纯函数）。SQLite 与 PG 行为完全一致，零迁移零依赖。
 */
async function runSearch(query: string): Promise<SearchRunResult> {
  const tokens = splitQuery(query);
  if (tokens.length === 0) return { matched: [], snippets: {} };

  const articles = await db.article.findMany({
    where: { status: "public" },
    include: {
      tags: {
        include: {
          tag: true,
        },
      },
    },
    orderBy: { publishedAt: "desc" },
  });

  const scored = articles
    .map((article) => {
      const searchable: SearchableArticle = {
        title: article.title,
        summary: article.summary,
        category: article.category,
        plainTextCache: article.plainTextCache,
        tagNames: article.tags.map((t) => t.tag.name),
      };
      const hit = scoreArticle(searchable, tokens);
      return hit ? { article, score: hit.score } : null;
    })
    .filter((x): x is { article: ArticleWithTags; score: number } => x !== null);

  // 相关度降序，同分按发布时间降序
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.article.publishedAt?.getTime() ?? 0) -
        (a.article.publishedAt?.getTime() ?? 0)
  );

  const snippets: Record<string, string> = {};
  for (const { article } of scored) {
    const snippet = extractSnippet(article.plainTextCache, tokens);
    if (snippet) snippets[article.id] = snippet;
  }

  return { matched: scored.map((s) => s.article), snippets };
}

export async function searchArticles(
  query: string,
  page?: number,
  perPage?: number
) {
  const { matched, snippets } = await runSearch(query);
  const totalCount = matched.length;
  if (!page || !perPage) {
    return { articles: matched, totalCount, snippets };
  }
  const start = Math.max((page - 1) * perPage, 0);
  return {
    articles: matched.slice(start, start + perPage),
    totalCount,
    snippets,
  };
}

export async function countSearchResults(query: string): Promise<number> {
  const { matched } = await runSearch(query);
  return matched.length;
}

export async function getArticleWithStats(slug: string) {
  const article = await db.article.findFirst({
    where: {
      slug,
      status: "public",
    },
    include: {
      tags: {
        include: {
          tag: true,
        },
      },
    },
  });
  
  if (!article) return null;
  
  const viewCount = await db.articleViewDedup.count({
    where: {
      articleId: article.id,
    },
  });
  
  return {
    ...article,
    viewCount,
  };
}