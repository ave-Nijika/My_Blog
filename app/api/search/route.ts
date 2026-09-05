import { searchArticles } from "@/lib/queries";
import { getClientIp } from "@/lib/client-ip";
import { tryConsumeSearch } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // 安全审查 P1.10：搜索为全表扫描，按 IP 限流（429 为正常"太快了"语义，
  // 与评论接口的统一 200 不同——搜索是公开功能，不构成状态枚举问题）。
  // 放在参数校验之后：q 缺失/超长是 O(1) 校验，不消耗额度。
  const rl = tryConsumeSearch(getClientIp(request));
  if (!rl.allowed) {
    return Response.json(
      { error: "搜索过于频繁，请稍后再试" },
      { status: 429 }
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
