import { searchArticles } from "@/lib/queries";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const page = Number(searchParams.get("page")) || 1;
  const perPage = 10;
  
  if (!query) {
    return Response.json(
      { error: "请输入搜索关键词" },
      { status: 400 }
    );
  }
  
  if (query.length > 100) {
    return Response.json(
      { error: "搜索词长度不能超过100个字符" },
      { status: 400 }
    );
  }
  
  const result = await searchArticles(query, page, perPage);
  
  return Response.json({
    ...result,
    query,
    page,
    perPage,
    hasMore: result.totalCount > page * perPage,
  });
}
