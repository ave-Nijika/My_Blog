/**
 * POST /api/admin/logout
 *
 * 吊销当前 AdminSession（写入 revokedAt）并清除 SESSION cookie。
 * 即使没有有效会话，也返回 200 + 清除 cookie，避免泄漏"是否已登录"。
 */
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE_NAME, hashSessionToken, getSession } from "@/lib/auth";
import { verifyCsrfToken } from "@/lib/csrf";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jsonError = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
  // CSRF verification for logout
  const csrfOk = await verifyCsrfToken(req);
  if (!csrfOk) {
    return jsonError(403, "CSRF 验证失败");
  }

  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  let sessionIdForAudit = "";
  if (token) {
    const tokenHash = hashSessionToken(token);
    await db.adminSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {});
  }
  const current = await getSession();
  sessionIdForAudit = current?.id ?? "";
  if (sessionIdForAudit) {
    await logAudit({
      adminId: sessionIdForAudit,
      action: AUDIT_ACTIONS.LOGOUT,
      targetType: "session",
      targetId: sessionIdForAudit,
    });
  }

  // Clear session cookie
  store.set({ name: SESSION_COOKIE_NAME, value: "", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  // Clear CSRF cookie
  store.set({ name: "CSRF", value: "", httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
}
