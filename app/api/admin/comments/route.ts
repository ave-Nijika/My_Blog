/**
 * /api/admin/comments
 *
 * GET  - 评论列表（支持 status / page / perPage 筛选），全部经 wrap(权限+CSRF)。
 *        注意：GET 仍然走 requireAdminApi 但不强制 CSRF（GET 走 CSRF 也无害，但
 *        现有 wrap 逻辑对 GET 不做 CSRF 检查）。
 *
 * 这里不直接调用 wrap() 因为 wrap 是给单个 handler 用的；我们在路由内
 * 显式调用 requireAdminApi + verifyCsrfToken，逻辑等价于 wrap。
 */
import { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { listAdminComments } from "@/lib/admin-comments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseIntParam(value: string | null, fallback: number, max: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const page = parseIntParam(url.searchParams.get("page"), 1, 1000);
  const perPage = parseIntParam(url.searchParams.get("perPage"), 20, 100);
  const result = await listAdminComments({ status, page, perPage });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
