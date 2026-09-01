/**
 * 站点设置读取（修复审核报告 P1-5）。
 *
 * 此前 SiteSettings 表只被 seed 和后台 API 写入，评论/封禁管线从未读取，
 * 后台改配置完全不生效。现在：
 *   - 冷却/长度/字节上限/自动封禁阈值/LLM 失败兜底开关：DB 优先（有行即生效），
 *     DB 不可用或无行时回退到环境变量，环境变量再回退到代码默认值。
 *   - 限流窗口/次数（COMMENT_RATE_LIMIT_*）：仍以环境变量为准（表内无对应字段）。
 *
 * 附带 5 秒进程内缓存，避免高频评论请求反复打 DB。
 */
import { db } from "./db";
import type { SiteSettings } from "@prisma/client";

export interface EffectiveCommentConfig {
  cooldownSeconds: number;
  minLength: number;
  maxLength: number;
  bodyMaxBytes: number;
  rateWindowSeconds: number;
  rateMaxAttempts: number;
  autoBanWarningThreshold: number;
  allowRegexOnlyOnLlmFailure: boolean;
}

const CACHE_TTL_MS = 5_000;
let cache: { value: SiteSettings | null; expiresAt: number } | null = null;

function envInt(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function loadRow(): Promise<SiteSettings | null> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  try {
    const row = await db.siteSettings.findFirst();
    cache = { value: row, expiresAt: now + CACHE_TTL_MS };
    return row;
  } catch {
    // DB 不可用时回退 env（并短暂缓存空值避免每次请求都撞错误）
    cache = { value: null, expiresAt: now + CACHE_TTL_MS };
    return null;
  }
}

/** 后台保存后调用，立刻失效缓存。 */
export function invalidateSiteSettingsCache(): void {
  cache = null;
}

export async function getEffectiveSiteSettings(): Promise<EffectiveCommentConfig> {
  const row = await loadRow();
  return {
    cooldownSeconds: row?.commentCooldownSeconds ?? envInt("COMMENT_COOLDOWN_SECONDS", 600),
    minLength: row?.commentMinLength ?? envInt("COMMENT_MIN_LENGTH", 2),
    maxLength: row?.commentMaxLength ?? envInt("COMMENT_MAX_LENGTH", 2000),
    bodyMaxBytes: row?.commentBodyMaxBytes ?? envInt("COMMENT_BODY_MAX_BYTES", 10000),
    rateWindowSeconds: envInt("COMMENT_RATE_LIMIT_WINDOW_SECONDS", 60),
    rateMaxAttempts: envInt("COMMENT_RATE_LIMIT_MAX_ATTEMPTS", 3),
    autoBanWarningThreshold:
      row?.autoBanWarningThreshold ?? envInt("COMMENT_AUTO_BAN_THRESHOLD", 3),
    allowRegexOnlyOnLlmFailure: row?.allowRegexOnlyOnLlmFailure ?? false,
  };
}

/** 关于页联系方式卡片（管理员可配；kind=copy 点击复制，kind=link 点击跳转） */
export interface AboutContactCard {
  id: string;
  label: string;
  value: string;
  href?: string;
  kind: "copy" | "link";
}

export interface AboutPageConfig {
  notes: string | null;
  contacts: AboutContactCard[] | null;
}

/** 读取关于页配置（DB 为空 → null，由调用方用内置默认兜底）。JSON 损坏按 null 处理。 */
export async function getAboutPageConfig(): Promise<AboutPageConfig> {
  const row = await loadRow();
  let contacts: AboutContactCard[] | null = null;
  if (row?.aboutContacts) {
    try {
      const parsed: unknown = JSON.parse(row.aboutContacts);
      if (Array.isArray(parsed)) {
        contacts = parsed
          .filter(
            (c): c is AboutContactCard =>
              !!c &&
              typeof c === "object" &&
              typeof (c as AboutContactCard).label === "string" &&
              typeof (c as AboutContactCard).value === "string" &&
              ((c as AboutContactCard).kind === "copy" ||
                (c as AboutContactCard).kind === "link")
          )
          .slice(0, 8);
      }
    } catch {
      contacts = null;
    }
  }
  return {
    notes: row?.aboutNotes?.trim() ? row.aboutNotes : null,
    contacts,
  };
}
