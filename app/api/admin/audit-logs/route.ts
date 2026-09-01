/**
 * /api/admin/audit-logs
 *
 * GET - 列出审计日志，按 createdAt desc，简单分页。
 *     可选参数 ?targetType=post|comment|...&adminId=...&page=&perPage=
 *     全部经 wrap() 包装：401 + CSRF（GET 仍走权限但不发 CSRF 检查）。
 */
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { listAuditLogs } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_TYPES = new Set([
  "auth",
  "post",
  "comment",
  "visitor",
  "regex_rule",
  "site_settings",
  "captcha",
  "session",
  "llm",
  "comfy_item", // ComfyUI 上传/删除审计
]);

function parseIntParam(value: string | null, fallback: number, max: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = wrap(async (req: NextRequest) => {
  const url = new URL(req.url);
  const page = parseIntParam(url.searchParams.get("page"), 1, 1000);
  const perPage = parseIntParam(url.searchParams.get("perPage"), 20, 100);
  const rawTargetType = url.searchParams.get("targetType") ?? "";
  const targetType = TARGET_TYPES.has(rawTargetType) ? rawTargetType : undefined;
  const adminId = url.searchParams.get("adminId") ?? undefined;
  const result = await listAuditLogs({ page, perPage, targetType, adminId });
  return jsonOk(result);
});
