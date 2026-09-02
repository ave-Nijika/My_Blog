/**
 * /api/admin/taxonomy
 *
 * GET - 分类与标签列表（预置 + 自定义 + 从文章聚合，按 name 去重排序）。
 *       数据源为 Category/Tag 表：content-sync 会在每次后台文章写入后按
 *       frontmatter upsert，两表已是三个来源的并集；仅分类字符串存在极端
 *       未同步场景，此处再从 Article.category 聚合补入（无 id，仅展示）。
 */
import { wrap } from "@/lib/admin-api";
import { db } from "@/lib/db";
import {
  jsonOk,
  sortByName,
  toTaxonomyDto,
  slugifyName,
  type TaxonomyItem,
} from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = wrap(async () => {
  const [categories, tags, articleCategories] = await Promise.all([
    db.category.findMany(),
    db.tag.findMany(),
    db.article.groupBy({ by: ["category"], where: { category: { not: "" } } }),
  ]);

  const knownNames = new Set(categories.map((c) => c.name));
  const aggregated: TaxonomyItem[] = articleCategories
    .map((row) => row.category)
    .filter((name) => !knownNames.has(name))
    .map((name) => ({ id: "", name, slug: slugifyName(name) }));

  return jsonOk({
    ok: true,
    categories: sortByName([
      ...categories.map(toTaxonomyDto),
      ...aggregated,
    ]),
    tags: sortByName(tags.map(toTaxonomyDto)),
  });
});
