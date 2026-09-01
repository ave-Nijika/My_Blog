/**
 * /api/admin/regex-rules/[id]
 *
 * PUT    - 更新规则
 * DELETE - 删除规则
 *
 * 全部经 wrap() 包装。
 */
import { z, ZodError } from "zod";
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  pattern: z.string().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  action: z
    .enum(["reject", "replace", "review"], {
      errorMap: () => ({ message: "action 必须是 reject/replace/review" }),
    })
    .optional(),
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

export const PUT = wrap(
  async (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const session = await getSession();
    const { id } = await ctx.params;
    const existing = await db.regexRule.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "规则不存在");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "请求体不是合法 JSON");
    }
    let data: z.infer<typeof updateSchema>;
    try {
      data = updateSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        return jsonError(400, e.issues[0]?.message ?? "参数错误");
      }
      throw e;
    }
    const updated = await db.regexRule.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.pattern !== undefined ? { pattern: data.pattern } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.action !== undefined ? { action: data.action } : {}),
        ...(data.replacementText !== undefined
          ? { replacementText: data.replacementText }
          : {}),
        ...(data.warningIncrement !== undefined
          ? { warningIncrement: data.warningIncrement }
          : {}),
      },
    });
    await logAudit({
      adminId: session?.id ?? "",
      action: AUDIT_ACTIONS.REGEX_UPDATE,
      targetType: "regex_rule",
      targetId: id,
      metadata: {
        name: updated.name,
        action: updated.action,
        enabled: updated.enabled,
        priority: updated.priority,
      },
    });
    return jsonOk({
      ok: true,
      rule: {
        id: updated.id,
        name: updated.name,
        pattern: updated.pattern,
        enabled: updated.enabled,
        priority: updated.priority,
        action: updated.action,
        replacementText: updated.replacementText,
        warningIncrement: updated.warningIncrement,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  }
);

export const DELETE = wrap(
  async (
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const session = await getSession();
    const { id } = await ctx.params;
    const existing = await db.regexRule.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "规则不存在");
    await db.regexRule.delete({ where: { id } });
    await logAudit({
      adminId: session?.id ?? "",
      action: AUDIT_ACTIONS.REGEX_DELETE,
      targetType: "regex_rule",
      targetId: id,
      metadata: { name: existing.name },
    });
    return jsonOk({ ok: true, id });
  }
);
