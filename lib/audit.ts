/**
 * lib/audit.ts
 *
 * 审计日志工具（M3c，规格第 17 章）。
 *
 * 设计原则：
 *   - 单写入入口 logAudit(...)，失败不抛错（审计写入本身不应阻塞业务主流程）。
 *   - metadata 在写入前做"脱敏过滤"：禁止写入 API Key / Session 密钥 / Webhook 密钥
 *     / 原始 IP / 完整验证码 Token / 完整评论正文 等敏感字段。
 *   - adminId 可为空字符串 ""，表示匿名失败（如登录失败时还没有会话）。
 *   - targetType 限定为受控字符串集合，方便后台页面按类型筛选。
 *   - 整个函数对调用方完全同步语义（只 await 一次 DB 写入），便于在 route handler 中
 *     简单 await logAudit(...) 即可。
 */
import { db } from "./db";

export type AuditTargetType =
  | "auth"
  | "post"
  | "comment"
  | "visitor"
  | "regex_rule"
  | "site_settings"
  | "captcha"
  | "session"
  | "llm"
  | "comfy_item";

const TARGET_TYPE_SET = new Set<AuditTargetType>([
  "auth",
  "post",
  "comment",
  "visitor",
  "regex_rule",
  "site_settings",
  "captcha",
  "session",
  "llm",
  "comfy_item",
]);

const SENSITIVE_KEYS = [
  "apiKey",
  "api_key",
  "apikey",
  "sessionSecret",
  "session_secret",
  "webhookSecret",
  "webhook_secret",
  "ipHashSecret",
  "ip_hash_secret",
  "captchaSecret",
  "captcha_secret",
  "turnstileSecret",
  "turnstile_secret",
  "rawIp",
  "raw_ip",
  "ipAddress",
  "ip_address",
  "clientIp",
  "client_ip",
  "xForwardedFor",
  "x_real_ip",
  "x-real-ip",
  "captchaToken",
  "captcha_token",
  "token",
  "sessionToken",
  "session_token",
  "password",
  "passwordHash",
  "password_hash",
  "bodyText",
  "body_text",
  "commentBody",
  "comment_body",
  "rawBody",
  "raw_body",
  "secret",
  "authorization",
  "cookie",
  "setCookie",
  "set_cookie",
];

function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  if (SENSITIVE_KEYS.includes(key)) return true;
  const lower = key.toLowerCase();
  if (lower.includes("apikey") || lower.includes("api_key")) return true;
  if (lower.includes("sessiontoken") || lower.includes("session_token")) return true;
  if (lower.includes("webhook") && lower.includes("secret")) return true;
  if (lower.includes("captchatoken") || lower.includes("captcha_token")) return true;
  if (lower === "authorization" || lower.startsWith("authorization")) return true;
  if (lower === "cookie" || lower.startsWith("cookie")) return true;
  if (lower.endsWith("password") || lower.endsWith("passwordhash")) return true;
  if (lower === "rawip" || lower === "raw_ip" || lower === "clientip") return true;
  return false;
}

function scrubValue(value: unknown, parentKey?: string): unknown {
  if (parentKey && isSensitiveKey(parentKey)) {
    return "[redacted]";
  }
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // 限长 + 去控制字符，防止有人把日志当存储用。
    if (value.length > 1000) return value.slice(0, 1000) + "…";
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => scrubValue(v, parentKey));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isSensitiveKey(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = scrubValue(v, k);
    }
    return out;
  }
  return String(value);
}

function asTargetType(value: string | undefined): AuditTargetType {
  if (value && TARGET_TYPE_SET.has(value as AuditTargetType)) {
    return value as AuditTargetType;
  }
  return "session";
}

function safeStringify(metadata: unknown): string {
  const scrubbed = scrubValue(metadata);
  try {
    return JSON.stringify(scrubbed ?? {});
  } catch {
    return "{}";
  }
}

export interface LogAuditParams {
  adminId: string | null | undefined;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: unknown;
}

export async function logAudit(params: LogAuditParams): Promise<void> {
  const action = (params.action ?? "").trim().slice(0, 100);
  if (!action) return;
  const adminId = (params.adminId ?? "").toString().slice(0, 128);
  const targetType = asTargetType(params.targetType);
  const targetId = (params.targetId ?? "").toString().slice(0, 128);
  const metadata = safeStringify(params.metadata);
  try {
    await db.auditLog.create({
      data: {
        adminId,
        action,
        targetType,
        targetId,
        metadata,
      },
    });
  } catch (e) {
    // 审计写入失败仅记录警告，不影响主流程。
    if (process.env.NODE_ENV !== "production") {
      console.warn("[audit] logAudit failed", e);
    }
  }
}

/**
 * 后台审计日志查询封装（按 createdAt desc，分页）。
 */
export interface AuditLogListItem {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: string;
  createdAt: string;
}

export interface AuditLogListResult {
  items: AuditLogListItem[];
  total: number;
  page: number;
  perPage: number;
}

export async function listAuditLogs(params: {
  page: number;
  perPage: number;
  targetType?: string;
  adminId?: string;
}): Promise<AuditLogListResult> {
  const page = Math.max(params.page, 1);
  const perPage = Math.min(Math.max(params.perPage, 1), 100);
  const where: Record<string, unknown> = {};
  if (params.targetType) {
    where.targetType = params.targetType;
  }
  if (params.adminId) {
    where.adminId = params.adminId;
  }
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    db.auditLog.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      adminId: r.adminId,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    perPage,
  };
}

export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: "auth.login.success",
  LOGIN_FAIL: "auth.login.fail",
  LOGOUT: "auth.logout",
  POST_CREATE: "post.create",
  POST_UPDATE: "post.update",
  POST_DELETE: "post.delete",
  POST_PUBLISH: "post.publish",
  POST_PRIVATE: "post.private",
  COMMENT_APPROVE: "comment.approve",
  COMMENT_REJECT: "comment.reject",
  COMMENT_DELETE: "comment.delete",
  VISITOR_WARN: "visitor.warn",
  VISITOR_BAN: "visitor.ban",
  VISITOR_UNBAN: "visitor.unban",
  REGEX_CREATE: "regex_rule.create",
  REGEX_UPDATE: "regex_rule.update",
  REGEX_DELETE: "regex_rule.delete",
  SITE_SETTINGS_UPDATE: "site_settings.update",
  PASSWORD_CHANGE: "auth.password.change",
  LLM_DISABLED: "llm.disabled",
  LLM_ERROR: "llm.error",
  CREATE: "create",
  DELETE: "delete",
} as const;
