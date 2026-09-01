/**
 * 管理员初始化脚本。
 *
 * 用法（环境变量必填，禁止硬编码默认密码）：
 *   ADMIN_USERNAME=<用户名> ADMIN_PASSWORD=<至少 8 位密码> pnpm admin:create
 *
 * 行为：
 *   - 用户名为空或密码长度 < 8：报错并以非 0 退出。
 *   - 用户已存在：更新 passwordHash 并将 active 置为 true。
 *   - 用户不存在：创建新记录。
 *
 * 关于密码哈希算法的说明：
 *   规格第 11 章优先推荐 Argon2id，但允许"必要时支持 bcrypt"。
 *   本项目选择 bcryptjs（纯 JS、零原生编译依赖、跨平台兼容良好），
 *   成本因子 10 起步，足以在常见开发与小型部署上抵御离线爆破。
 *   若未来需要更高强度，可在不破坏 AdminUser.passwordHash 兼容性的前提下
 *   切换到 argon2（在登录时按 "$argon2" 前缀识别算法）。
 */
import bcrypt from "bcryptjs";
import { db } from "../lib/db.ts";

const BCRYPT_COST = 10;
const MIN_PASSWORD_LENGTH = 8;

async function main() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!username) {
    console.error(
      "[admin:create] 请先设置环境变量 ADMIN_USERNAME（不允许为空或默认值）。"
    );
    process.exit(1);
  }

  if (!password) {
    console.error(
      "[admin:create] 请先设置环境变量 ADMIN_PASSWORD（不允许为空或默认值）。"
    );
    process.exit(1);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `[admin:create] 密码长度至少 ${MIN_PASSWORD_LENGTH} 位，当前 ${password.length} 位。`
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const existing = await db.adminUser.findUnique({ where: { username } });
  if (existing) {
    await db.adminUser.update({
      where: { id: existing.id },
      data: { passwordHash, active: true },
    });
    console.log(`[admin:create] 管理员「${username}」已存在，已更新密码并启用。`);
  } else {
    await db.adminUser.create({
      data: { username, passwordHash, active: true },
    });
    console.log(`[admin:create] 管理员「${username}」已创建。`);
  }

  console.log("管理员已创建");
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("[admin:create] 初始化失败：", error);
    await db.$disconnect();
    process.exit(1);
  });
