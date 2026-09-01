/**
 * /api/admin/llm-settings
 *
 * GET   - 读取已配置的 LLM 提供商列表（顺序即路由顺序）
 * PUT   - 保存提供商列表（zod 校验，最多 10 条）
 * POST  - action=test    ：对指定提供商发一次真实审核请求，返回连通性与耗时
 *         action=models  ：拉取提供商的 /models 模型列表（OpenAI 兼容），供 GUI 搜索选择
 *
 * 所有操作仅管理员可用（requireAdminApi + CSRF）。
 * API Key 以明文存于 SiteSettings.llmProviders（单管理员个人站，可接受；
 * GUI 中以密码框展示，可随时覆盖）。
 */
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth";
import { verifyCsrfToken } from "@/lib/csrf";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import {
  getLlmProviders,
  type LlmProviderConfig,
} from "@/lib/llm-moderation";
import { invalidateSiteSettingsCache } from "@/lib/site-settings";

export const runtime = "nodejs";

const providerSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(50),
  baseUrl: z.string().min(1).max(300),
  apiKey: z.string().min(1).max(300),
  model: z.string().min(1).max(200),
  timeoutSec: z.number().int().min(1).max(120),
  enabled: z.boolean(),
});

const putSchema = z.object({
  providers: z.array(providerSchema).max(10),
});

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

async function ensureSettingsRow() {
  const existing = await db.siteSettings.findFirst();
  if (existing) return existing;
  return db.siteSettings.create({ data: {} });
}

export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const providers = await getLlmProviders();
  return NextResponse.json({ ok: true, providers });
}

export async function PUT(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  if (!(await verifyCsrfToken(req))) {
    return jsonError(403, "Invalid CSRF token");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "请求体不是合法 JSON");
  }
  let data: z.infer<typeof putSchema>;
  try {
    data = putSchema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      return jsonError(400, e.issues[0]?.message ?? "参数错误");
    }
    throw e;
  }

  // 去重 id
  const seen = new Set<string>();
  for (const p of data.providers) {
    if (seen.has(p.id)) return jsonError(400, `提供商 id 重复: ${p.id}`);
    seen.add(p.id);
  }

  const row = await ensureSettingsRow();
  const before = row.llmProviders ?? null;
  const next = await db.siteSettings.update({
    where: { id: row.id },
    data: { llmProviders: JSON.stringify(data.providers) },
  });
  invalidateSiteSettingsCache();
  const session = await (await import("@/lib/auth")).getSession();
  await logAudit({
    adminId: session?.id ?? "",
    action: AUDIT_ACTIONS.SITE_SETTINGS_UPDATE,
    targetType: "site_settings",
    targetId: next.id,
    metadata: { llmProvidersCount: data.providers.length, beforeLength: before?.length ?? 0 },
  });
  return NextResponse.json({ ok: true, providers: data.providers });
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  if (!(await verifyCsrfToken(req))) {
    return jsonError(403, "Invalid CSRF token");
  }

  let body: {
    action?: string;
    provider?: Partial<LlmProviderConfig>;
    baseUrl?: string;
    apiKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "请求体不是合法 JSON");
  }

  if (body.action === "models") {
    const baseUrl = normalizeBaseUrl(String(body.baseUrl ?? ""));
    const apiKey = String(body.apiKey ?? "");
    if (!baseUrl || !apiKey) return jsonError(400, "baseUrl 与 apiKey 不能为空");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        return jsonError(502, `上游返回 HTTP ${res.status}`);
      }
      const payload = (await res.json()) as {
        data?: Array<{ id?: unknown }>;
      };
      const models = (payload?.data ?? [])
        .map((m) => (typeof m?.id === "string" ? m.id : ""))
        .filter(Boolean)
        .slice(0, 300);
      return NextResponse.json({ ok: true, models });
    } catch (e) {
      const err = e as { name?: string };
      return jsonError(
        502,
        err?.name === "AbortError" ? "拉取模型列表超时" : "网络错误，无法访问该站点"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  if (body.action === "test") {
    const p = body.provider;
    if (
      !p ||
      typeof p.baseUrl !== "string" ||
      typeof p.apiKey !== "string" ||
      typeof p.model !== "string" ||
      typeof p.timeoutSec !== "number"
    ) {
      return jsonError(400, "测试参数不完整");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.round(p.timeoutSec * 1000));
    const started = Date.now();
    try {
      const res = await fetch(`${normalizeBaseUrl(p.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${p.apiKey}`,
        },
        body: JSON.stringify({
          model: p.model,
          temperature: 0,
          tools: [],
          tool_choice: "none",
          messages: [
            {
              role: "user",
              content:
                'Connectivity test. Reply with exactly this JSON: {"decision":"approve","category":"other","reason":"ping"}',
            },
          ],
        }),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return NextResponse.json({
          ok: false,
          error: `上游返回 HTTP ${res.status}`,
          latencyMs,
        });
      }
      const payload = (await res.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      } | null;
      const content = payload?.choices?.[0]?.message?.content;
      return NextResponse.json({
        ok: true,
        latencyMs,
        sample: typeof content === "string" ? content.slice(0, 120) : "",
      });
    } catch (e) {
      const err = e as { name?: string };
      const latencyMs = Date.now() - started;
      return NextResponse.json({
        ok: false,
        error: err?.name === "AbortError" ? `超时（>${p.timeoutSec}s）` : "网络错误",
        latencyMs,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return jsonError(400, "未知 action");
}
