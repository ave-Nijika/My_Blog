/**
 * 管理员认证工具：会话解析与权限守卫。
 *
 * 设计要点：
 *   - Cookie 中只放明文随机 token（256 bit），数据库只存 SHA-256(token)，
 *     即使数据库泄露也无法直接重放会话。
 *   - getSession() 仅做"无副作用"读取；登录后会由路由处理 lastSeenAt 刷新，
 *     避免在每次请求里都写入数据库。
 *   - requireAdmin() 根据调用上下文（API 路由 / 页面）返回不同结果：
 *     401 JSON 给 API，redirect 给页面。调用方在页面里可以直接 await，
 *     因为 redirect() 内部会抛 NEXT_REDIRECT 让控制流不继续。
 */
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";

export const SESSION_COOKIE_NAME = "SESSION";
const SESSION_TTL_DAYS = 7;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getAdminLoginPath(): string {
  const raw = process.env.ADMIN_LOGIN_PATH?.trim();
  if (!raw) return "/private-admin-login";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export type AdminSession = {
  id: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
};

/**
 * 读取并校验当前请求的会话。仅返回"未吊销且未过期"的会话。
 * 不存在或失效时返回 null。
 */
export async function getSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await db.adminSession.findFirst({
    where: { tokenHash },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  return session;
}

/**
 * 页面场景下的权限守卫：未登录则 302 跳到登录页。
 * 用法：在 server component 顶部 `await requireAdmin();`。
 */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) {
    const loginPath = getAdminLoginPath();
    redirect(loginPath);
  }
  return session;
}

/**
 * API 场景下的权限守卫：未登录返回 401 Response。
 * 用法：`const guard = await requireAdminApi(); if (guard) return guard;`
 */
export async function requireAdminApi(): Promise<Response | null> {
  const session = await getSession();
  if (!session) {
    return new Response(
      JSON.stringify({ error: "未登录或会话已过期" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  return null;
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function hashSessionToken(token: string): string {
  return hashToken(token);
}

/**
 * 吊销全部管理员会话并清掉当前 SESSION cookie。
 * AdminSession 无 adminId 外键（单管理员设计），无法定位"某人的会话"，只能全量吊销。
 * 改密/改名后调用：所有旧会话（含当前会话）立即失效，返回吊销条数。
 * （安全审查 P0.1 修复：旧会话在改密后必须立即失效。）
 */
export async function revokeAllAdminSessions(): Promise<number> {
  const { count } = await db.adminSession.updateMany({
    where: { revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return count;
}
