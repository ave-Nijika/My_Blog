/**
 * 分类/标签管理（taxonomy）共享助手：仅供 /api/admin/taxonomy* 路由使用。
 *
 * 与内容同步的关系：content-sync 会在每次后台文章写入后按 frontmatter
 * upsert Category/Tag，因此两表即"预置 + 自定义 + 从文章聚合"的并集；
 * 本模块只提供校验与 DTO 工具，不做同步逻辑。
 */
import { z } from "zod";
import { slugifyName } from "./content-sync";

/** 名称约束与文章管理一致（category 64 / tag 64，见 lib/admin-posts.ts） */
export const taxonomyNameSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空").max(64, "名称最长 64 字符"),
});

export function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface TaxonomyItem {
  id: string;
  name: string;
  slug: string;
}

export function toTaxonomyDto(row: {
  id: string;
  name: string;
  slug: string;
}): TaxonomyItem {
  return { id: row.id, name: row.name, slug: row.slug };
}

/** 按 name 排序（中文按拼音区域规则；聚合补入项与表内项统一排序） */
export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

export { slugifyName };
