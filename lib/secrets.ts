/**
 * HMAC 密钥读取（审核报告 P2"弱密钥静默兜底"修复）。
 *
 * 生产环境必须显式配置强随机密钥：未设置或仍是 .env.example 占位值时
 * 直接抛错拒绝启动，绝不带弱密钥上线。开发环境保留默认值便于开箱即用。
 */
export function requireSecret(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  if (v) {
    if (process.env.NODE_ENV === "production" && /^replace-with-/i.test(v)) {
      throw new Error(
        `[config] 生产环境检测到未替换的占位密钥 ${name}，请在 .env 中设置强随机值`
      );
    }
    return v;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(`[config] 生产环境必须设置 ${name} 环境变量`);
  }
  return fallback;
}
