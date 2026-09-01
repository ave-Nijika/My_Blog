/**
 * /api/admin/regex-rules
 *
 * GET  - 列表（按 priority desc, createdAt asc）
 * POST - 创建规则
 *
 * 全部经 wrap() 包装：401 + CSRF 403。
 */
import { z, ZodError } from "zod";
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1, { message: "名称不能为空" }).max(100),
  pattern: z.string().min(1, { message: "正则不能为空" }).max(500),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  action: z.enum(["reject", "replace", "review"], {
    errorMap: () => ({ message: "action 必须是 reject/replace/review" }),
  }),
  replacementText: z.string().max(1000).optional(),
  warningIncrement: z.number().int().min(0).max(10).optional(),
});

function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = wrap(async () => {
  const rows = await db.regexRule.findMany({
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  return jsonOk({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      pattern: r.pattern,
      enabled: r.enabled,
      priority: r.priority,
      action: r.action,
      replacementText: r.replacementText,
      warningIncrement: r.warningIncrement,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

export const POST = wrap(async (req: NextRequest) => {
  const session = await getSession();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "请求体不是合法 JSON");
  }
  let data: z.infer<typeof createSchema>;
  try {
    data = createSchema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      return jsonError(400, e.issues[0]?.message ?? "参数错误");
    }
    throw e;
  }
  const created = await db.regexRule.create({
    data: {
      name: data.name,
      pattern: data.pattern,
      enabled: data.enabled ?? true,
      priority: data.priority ?? 0,
      action: data.action,
      replacementText: data.replacementText ?? "",
      warningIncrement: data.warningIncrement ?? 1,
    },
  });
  await logAudit({
    adminId: session?.id ?? "",
    action: AUDIT_ACTIONS.REGEX_CREATE,
    targetType: "regex_rule",
    targetId: created.id,
    metadata: {
      name: created.name,
      action: created.action,
      enabled: created.enabled,
      priority: created.priority,
    },
  });
  return jsonOk({
    ok: true,
    rule: {
      id: created.id,
      name: created.name,
      pattern: created.pattern,
      enabled: created.enabled,
      priority: created.priority,
      action: created.action,
      replacementText: created.replacementText,
      warningIncrement: created.warningIncrement,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    },
  });
});
