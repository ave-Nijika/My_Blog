/**
 * GET /api/posts/categories
 *
 * 公开接口（游客可访问）：返回公开文章的分类聚合，供 /posts 分类 chip 栏
 * 与外部调用。数据随 DB 实时变化（force-dynamic、无缓存）：新建/删除/改
 * 分类的文章保存后，下次请求自然增减对应分类。
 *
 * 返回：Array<{ name: string, count: number }>
 * 排序：文章数降序，相同文章数按分类名字典序升序。
 */
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.article.groupBy({
    by: ["category"],
    where: { status: "public", category: { not: "" } },
    _count: { category: true },
    orderBy: [{ _count: { category: "desc" } }, { category: "asc" }],
  });
  return new Response(
    JSON.stringify(rows.map((r) => ({ name: r.category, count: r._count.category }))),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}
