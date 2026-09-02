/**
 * /admin/taxonomy — 分类与标签管理页。
 *
 * 服务端组件：requireAdmin 守卫 + 直接读 DB（Category/Tag 表）渲染初始数据，
 * 交互（新增/重命名/删除）由 TaxonomyManager 客户端组件走 /api/admin/taxonomy*。
 */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { sortByName, type TaxonomyItem } from "@/lib/taxonomy";
import { LogoutButton } from "../LogoutButton";
import { TaxonomyManager } from "./TaxonomyManager";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "分类与标签管理",
  robots: { index: false, follow: false },
};

export default async function TaxonomyPage() {
  await requireAdmin();

  const [categories, tags, articleCategories] = await Promise.all([
    db.category.findMany(),
    db.tag.findMany(),
    // 文章 category 为字符串字段（无外键）：聚合未入库的引用，仅展示
    db.article.groupBy({ by: ["category"], where: { category: { not: "" } } }),
  ]);

  const knownNames = new Set(categories.map((c) => c.name));
  const aggregated: TaxonomyItem[] = articleCategories
    .map((row) => row.category)
    .filter((name) => !knownNames.has(name))
    .map((name) => ({ id: "", name, slug: "" }));

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <a href="/admin" className="hover:text-sky-600 dark:hover:text-sky-300">
              ← 后台首页
            </a>
            <span>/</span>
            <span>分类与标签</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            分类与标签
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            预置与自定义分类/标签统一管理；被文章引用的项不可删除。文章正文里的
            frontmatter 仍是内容源，保存文章时同步引擎会按其 upsert。
          </p>
        </div>
        <LogoutButton />
      </header>

      <TaxonomyManager
        initialCategories={sortByName(categories.map((c) => ({ ...c })))}
        initialTags={sortByName(tags.map((row) => ({ ...row })))}
        aggregatedCategories={sortByName(aggregated)}
      />
    </div>
  );
}
