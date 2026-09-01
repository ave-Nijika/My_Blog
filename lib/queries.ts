import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

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

export async function searchArticles(
  query: string,
  page?: number,
  perPage?: number
) {
  const where: Prisma.ArticleWhereInput = {
    status: "public",
    OR: [
      { title: { contains: query } },
      { summary: { contains: query } },
      { plainTextCache: { contains: query } },
      {
        tags: {
          some: {
            tag: {
              name: { contains: query },
            },
          },
        },
      },
      {
        category: {
          contains: query,
        },
      },
    ],
  };
  
  const articles = await db.article.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }],
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
  
  const totalCount = await db.article.count({ where });
  
  return { articles, totalCount };
}

export async function countSearchResults(query: string): Promise<number> {
  const where: Prisma.ArticleWhereInput = {
    status: "public",
    OR: [
      { title: { contains: query } },
      { summary: { contains: query } },
      { plainTextCache: { contains: query } },
      {
        tags: {
          some: {
            tag: {
              name: { contains: query },
            },
          },
        },
      },
      {
        category: {
          contains: query,
        },
      },
    ],
  };
  
  return db.article.count({ where });
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