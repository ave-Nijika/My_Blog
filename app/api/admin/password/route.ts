/**
 * PATCH /api/admin/password
 *
 * 管理员自助修改账号密码（仅管理员会话可用）。
 * 实现要点（回溯指引）：
 *  - 鉴权：requireAdminApi（与会话机制一致）；
 *  - CSRF：双提交 cookie 校验（与其它写接口一致）；
 *  - 验证当前密码：bcrypt.compare（与登录路由同款比较逻辑）；
 *  - 新密码用 bcrypt 哈希（cost 与登录路由相同，10）后写 adminUser.passwordHash；
 *  - 不改动 AdminSession：当前会话与密码哈希解耦，改密后本会话保持登录；
 *  - 审计：AUDIT_ACTIONS.PASSWORD_CHANGE，metadata 只记 adminId/时间，绝不记录任何密码内容。
 *  - 无新表/新字段/新依赖（复用 adminUser.passwordHash 列与 bcryptjs）。
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
  newPassword: z
    .string()
    .min(8, { message: "新密码至少 8 位" })
    .max(100, { message: "新密码最长 100 位" }),
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
  // 注意：AdminSession 与 AdminUser 无外键（单管理员设计），无法从会话定位用户。
  // 以「当前密码」对全部 active 管理员做比对自证身份（与登录路由同款 bcrypt.compare）：
  // 匹配成功者即目标账号；这也天然防止改到其他账号（不知道对方当前密码）。
  const candidates = await db.adminUser.findMany({ where: { active: true } });
  let admin: { id: string; username: string; passwordHash: string } | null = null;
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
  if (data.currentPassword === data.newPassword) {
    return jsonError(400, "新密码不能与当前密码相同");
  }

  const passwordHash = await bcrypt.hash(data.newPassword, 10);
  await db.adminUser.update({
    where: { id: admin.id },
    data: { passwordHash },
  });

  await logAudit({
    adminId: admin.id,
    action: AUDIT_ACTIONS.PASSWORD_CHANGE,
    targetType: "admin_user",
    targetId: admin.id,
    metadata: { username: admin.username, at: new Date().toISOString() },
  });

  return NextResponse.json({ ok: true });
}
