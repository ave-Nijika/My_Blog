/**
 * 分类/标签预置数据 seed（幂等：upsert，重复执行不报错、不重复创建）。
 *
 * 用法：
 *   pnpm taxonomy:seed
 *   docker compose exec app node scripts/seed-taxonomy.ts   （生产容器）
 *
 * 也可作为模块引入（prisma/seed.ts、集成测试），此时不会自动执行。
 *
 * 注意：slug 生成沿用 lib/content-sync.ts 的 slugifyName 同款规则。此处不能直接
 * import 该函数——content-sync.ts 内部存在无扩展名相对导入（./content-paths），
 * node 直接运行 TS 脚本无法解析；故复制其实现并保持一致（改动时需两处同步）。
 */
import { pathToFileURL } from "node:url";
import { db } from "../lib/db.ts";

/** 与 lib/content-sync.ts 的 slugifyName 保持一致 */
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

export const PRESET_CATEGORIES = ["技术", "生活", "随笔", "未分类"] as const;
export const PRESET_TAGS = [
  "学习",
  "算法",
  "计算机基础",
  "前端",
  "后端",
  "随笔",
  "草稿",
] as const;

export async function seedTaxonomy(): Promise<{
  categories: number;
  tags: number;
}> {
  let categoryCount = 0;
  for (const name of PRESET_CATEGORIES) {
    const existing = await db.category.findUnique({ where: { name } });
    if (existing) continue;
    await db.category.create({ data: { name, slug: slugifyName(name) } });
    categoryCount += 1;
  }

  let tagCount = 0;
  for (const name of PRESET_TAGS) {
    const existing = await db.tag.findUnique({ where: { name } });
    if (existing) continue;
    await db.tag.create({ data: { name, slug: slugifyName(name) } });
    tagCount += 1;
  }

  return { categories: categoryCount, tags: tagCount };
}

async function main() {
  const { categories, tags } = await seedTaxonomy();
  console.log(
    `[taxonomy:seed] 完成：新增分类 ${categories} 个、新增标签 ${tags} 个（已存在的跳过）。`
  );
}

// 仅直接运行本文件时执行 CLI（被 import 时不执行，供 prisma/seed.ts 与测试复用）
const isDirectRun =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main()
    .then(async () => {
      await db.$disconnect();
      process.exit(0);
    })
    .catch(async (error: unknown) => {
      console.error("[taxonomy:seed] 预置失败：", error);
      await db.$disconnect();
      process.exit(1);
    });
}
