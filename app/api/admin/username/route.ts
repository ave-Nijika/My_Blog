/**
 * PATCH /api/admin/username — 管理员自助修改登录用户名（仅管理员会话）。
 *
 * 实现要点（回溯指引，与 password 路由同构）：
 *  - requireAdminApi（会话鉴权）+ CSRF 双提交校验；
 *  - 以「当前密码」对全部 active 管理员 bcrypt.compare 自证身份
 *    （AdminSession 与 AdminUser 无外键，无法从会话定位用户，同 password 路由）；
 *  - 新用户名 zod：3-30 位、小写字母/数字/中划线（与 slug 风格一致，便于输入），
 *    查重 AdminUser.username（@unique）；
 *  - 直接 update username 列（复用现有列，无迁移）；
 *  - 会话零改动（token 与 username 解耦，改名后当前登录保持）；
 *  - 审计 auth.password.change 同款机制，targetType=admin_user。
 */
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireAdminApi, getSession } from "@/lib/auth";
import { verifyCsrfToken } from "@/lib/csrf";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const changeSchema = z.object({
  currentPassword: z.string().min(1, { message: "当前密码不能为空" }),
  newUsername: z
    .string()
    .min(3, { message: "用户名至少 3 位" })
    .max(30, { message: "用户名最长 30 位" })
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: "用户名只能包含小写字母、数字和中划线",
    }),
});

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function PATCH(req: NextRequest) {
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
  let data: z.infer<typeof changeSchema>;
  try {
    data = changeSchema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      return jsonError(400, e.issues[0]?.message ?? "参数错误");
    }
    throw e;
  }

  const session = await getSession();
  if (!session) {
    return jsonError(401, "会话已失效，请重新登录");
  }

  const candidates = await db.adminUser.findMany({ where: { active: true } });
  let admin: { id: string; username: string } | null = null;
  for (const c of candidates) {
    let ok = false;
    try {
      ok = await bcrypt.compare(data.currentPassword, c.passwordHash);
    } catch {
      ok = false;
    }
    if (ok) {
      admin = c;
      break;
    }
  }
  if (!admin) {
    return jsonError(400, "当前密码不正确");
  }
  if (admin.username === data.newUsername) {
    return jsonError(400, "新用户名与当前用户名相同");
  }
  const taken = await db.adminUser.findUnique({
    where: { username: data.newUsername },
  });
  if (taken) {
    return jsonError(400, "该用户名已被占用");
  }

  await db.adminUser.update({
    where: { id: admin.id },
    data: { username: data.newUsername },
  });

  await logAudit({
    adminId: admin.id,
    action: AUDIT_ACTIONS.PASSWORD_CHANGE,
    targetType: "admin_user",
    targetId: admin.id,
    metadata: {
      action: "username_change",
      from: admin.username,
      to: data.newUsername,
      at: new Date().toISOString(),
    },
  });

  return NextResponse.json({ ok: true, username: data.newUsername });
}
