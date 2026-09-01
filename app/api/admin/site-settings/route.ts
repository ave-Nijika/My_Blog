/**
 * /api/admin/site-settings
 *
 * GET  - 读取 SiteSettings（单行表，仅一条）
 * PUT  - 更新 SiteSettings（审计：site_settings.update）
 *
 * 不暴露任何 secret，仅返回与评论体验直接相关的阈值类配置。
 */
import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { wrap } from "@/lib/admin-api";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { invalidateSiteSettingsCache } from "@/lib/site-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  commentCooldownSeconds: z.number().int().min(0).max(24 * 60 * 60).optional(),
  commentMinLength: z.number().int().min(1).max(2000).optional(),
  commentMaxLength: z.number().int().min(1).max(20000).optional(),
  commentBodyMaxBytes: z.number().int().min(256).max(200000).optional(),
  autoBanWarningThreshold: z.number().int().min(1).max(100).optional(),
  allowRegexOnlyOnLlmFailure: z.boolean().optional(),
  aboutNotes: z.string().max(5000).nullable().optional(),
  aboutContacts: z
    .array(
      z.object({
        id: z.string().min(1).max(50),
        label: z.string().min(1).max(30),
        value: z.string().min(1).max(200),
        href: z.string().max(300).optional(),
        kind: z.enum(["copy", "link"]),
      })
    )
    .max(8)
    .nullable()
    .optional(),
  nickname: z.string().min(1).max(30).optional(),
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

async function ensureSettings() {
  const existing = await db.siteSettings.findFirst();
  if (existing) return existing;
  return db.siteSettings.create({ data: {} });
}

function toJson(row: {
  id: string;
  commentCooldownSeconds: number;
  commentMinLength: number;
  commentMaxLength: number;
  commentBodyMaxBytes: number;
  autoBanWarningThreshold: number;
  allowRegexOnlyOnLlmFailure: boolean;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    commentCooldownSeconds: row.commentCooldownSeconds,
    commentMinLength: row.commentMinLength,
    commentMaxLength: row.commentMaxLength,
    commentBodyMaxBytes: row.commentBodyMaxBytes,
    autoBanWarningThreshold: row.autoBanWarningThreshold,
    allowRegexOnlyOnLlmFailure: row.allowRegexOnlyOnLlmFailure,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const GET = wrap(async () => {
  const row = await ensureSettings();
  return jsonOk({ settings: toJson(row) });
});

export const PUT = wrap(async (req: NextRequest) => {
  const session = await getSession();
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
  const current = await ensureSettings();
  const next = await db.siteSettings.update({
    where: { id: current.id },
    data: {
      ...(data.commentCooldownSeconds !== undefined
        ? { commentCooldownSeconds: data.commentCooldownSeconds }
        : {}),
      ...(data.commentMinLength !== undefined
        ? { commentMinLength: data.commentMinLength }
        : {}),
      ...(data.commentMaxLength !== undefined
        ? { commentMaxLength: data.commentMaxLength }
        : {}),
      ...(data.commentBodyMaxBytes !== undefined
        ? { commentBodyMaxBytes: data.commentBodyMaxBytes }
        : {}),
      ...(data.autoBanWarningThreshold !== undefined
        ? { autoBanWarningThreshold: data.autoBanWarningThreshold }
        : {}),
      ...(data.allowRegexOnlyOnLlmFailure !== undefined
        ? { allowRegexOnlyOnLlmFailure: data.allowRegexOnlyOnLlmFailure }
        : {}),
      ...(data.aboutNotes !== undefined
        ? { aboutNotes: data.aboutNotes === null ? null : data.aboutNotes.trim() || null }
        : {}),
      ...(data.aboutContacts !== undefined
        ? {
            aboutContacts:
              data.aboutContacts === null
                ? null
                : JSON.stringify(data.aboutContacts),
          }
        : {}),
    },
  });

  // 昵称存于 SiteProfile（关于页档案卡展示），随本次设置一并更新
  if (data.nickname !== undefined) {
    const profile = await db.siteProfile.findFirst();
    if (profile) {
      await db.siteProfile.update({
        where: { id: profile.id },
        data: { nickname: data.nickname.trim() },
      });
    }
  }
  // 立即失效进程内缓存，保证新设置即时生效
  invalidateSiteSettingsCache();
  await logAudit({
    adminId: session?.id ?? "",
    action: AUDIT_ACTIONS.SITE_SETTINGS_UPDATE,
    targetType: "site_settings",
    targetId: next.id,
    metadata: {
      before: {
        commentCooldownSeconds: current.commentCooldownSeconds,
        commentMinLength: current.commentMinLength,
        commentMaxLength: current.commentMaxLength,
        commentBodyMaxBytes: current.commentBodyMaxBytes,
        autoBanWarningThreshold: current.autoBanWarningThreshold,
        allowRegexOnlyOnLlmFailure: current.allowRegexOnlyOnLlmFailure,
      },
      after: {
        commentCooldownSeconds: next.commentCooldownSeconds,
        commentMinLength: next.commentMinLength,
        commentMaxLength: next.commentMaxLength,
        commentBodyMaxBytes: next.commentBodyMaxBytes,
        autoBanWarningThreshold: next.autoBanWarningThreshold,
        allowRegexOnlyOnLlmFailure: next.allowRegexOnlyOnLlmFailure,
      },
    },
  });
  return jsonOk({ ok: true, settings: toJson(next) });
});
