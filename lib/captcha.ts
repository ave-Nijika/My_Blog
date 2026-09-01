/**
 * lib/captcha.ts
 *
 * 验证码 Provider 抽象层（M3b）。
 *
 * 设计要点：
 *   - 抽象接口 verifyCaptcha(token, req) -> { success, errorCode? }。
 *   - MockProvider：CAPTCHA_ENABLED=false 或 CAPTCHA_PROVIDER=mock 时启用，
 *     始终返回 success=true，方便本地开发。
 *   - TurnstileProvider：CAPTCHA_PROVIDER=turnstile 时启用，调用 Cloudflare
 *     Turnstile verify 接口（https://challenges.cloudflare.com/turnstile/v0/siteverify）。
 *   - 每次验证都尝试把结果写入 CaptchaVerification（tokenHash 唯一约束防重放）；
 *     重复 token 直接跳过写入。
 *   - 错误一律记录到 errorCode，对外不暴露具体原因。
 */
import { createHash } from "node:crypto";
import { db } from "./db";

export interface CaptchaResult {
  success: boolean;
  errorCode?: string;
}

export interface CaptchaProvider {
  name: string;
  verify(token: string, req: Request): Promise<CaptchaResult>;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}

/**
 * 读取 CAPTCHA 配置。enabled=false 时短路走 mock；
 * provider 仅在 enabled=true 时才决定走哪个实现。
 */
export function getCaptchaConfig() {
  const enabledRaw = (process.env.CAPTCHA_ENABLED ?? "false").trim().toLowerCase();
  const enabled = enabledRaw === "true" || enabledRaw === "1" || enabledRaw === "yes";
  const provider = (process.env.CAPTCHA_PROVIDER ?? "mock").trim().toLowerCase();
  const secret = (process.env.CAPTCHA_SECRET_KEY ?? "").trim();
  const hostname = (process.env.CAPTCHA_EXPECTED_HOSTNAME ?? "").trim();
  const action = (process.env.CAPTCHA_EXPECTED_ACTION ?? "comment").trim();
  return { enabled, provider, secret, hostname, action };
}

class MockCaptchaProvider implements CaptchaProvider {
  name = "mock";
  async verify(_token: string, _req: Request): Promise<CaptchaResult> {
    return { success: true };
  }
}

class TurnstileCaptchaProvider implements CaptchaProvider {
  name = "turnstile";
  constructor(
    private readonly secret: string,
    private readonly expectedHostname: string,
    private readonly expectedAction: string
  ) {}

  async verify(token: string, req: Request): Promise<CaptchaResult> {
    if (!this.secret) {
      return { success: false, errorCode: "missing_secret" };
    }
    if (!token) {
      return { success: false, errorCode: "missing_token" };
    }
    const ip = readClientIp(req);
    const form = new URLSearchParams();
    form.set("secret", this.secret);
    form.set("response", token);
    if (ip && ip !== "0.0.0.0") {
      form.set("remoteip", ip);
    }
    let res: Response;
    try {
      res = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        }
      );
    } catch {
      return { success: false, errorCode: "network_error" };
    }
    if (!res.ok) {
      return { success: false, errorCode: `http_${res.status}` };
    }
    let payload: {
      success?: boolean;
      "error-codes"?: string[];
      hostname?: string;
      action?: string;
    };
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      return { success: false, errorCode: "invalid_response" };
    }
    if (!payload.success) {
      const first = payload["error-codes"]?.[0] ?? "verify_failed";
      return { success: false, errorCode: first };
    }
    if (this.expectedHostname && payload.hostname && payload.hostname !== this.expectedHostname) {
      return { success: false, errorCode: "hostname_mismatch" };
    }
    if (this.expectedAction && payload.action && payload.action !== this.expectedAction) {
      return { success: false, errorCode: "action_mismatch" };
    }
    return { success: true };
  }
}

let cachedProvider: CaptchaProvider | null = null;

/**
 * 根据环境变量选择 provider。enabled=false 时始终使用 mock，
 * 但调用方应当用 isCaptchaEnabled() 决定是否真正调用 verify。
 */
export function getCaptchaProvider(): CaptchaProvider {
  if (cachedProvider) return cachedProvider;
  const cfg = getCaptchaConfig();
  if (cfg.provider === "turnstile" && cfg.enabled) {
    cachedProvider = new TurnstileCaptchaProvider(
      cfg.secret,
      cfg.hostname,
      cfg.action
    );
  } else {
    cachedProvider = new MockCaptchaProvider();
  }
  return cachedProvider;
}

export function isCaptchaEnabled(): boolean {
  return getCaptchaConfig().enabled;
}

/**
 * 把验证结果写入 CaptchaVerification。
 * tokenHash 唯一约束：重复使用同一 token 直接忽略，不抛错。
 */
async function recordVerification(params: {
  tokenHash: string;
  provider: string;
  hostname: string;
  action: string;
  success: boolean;
  errorCode?: string;
}) {
  try {
    await db.captchaVerification.create({
      data: {
        tokenHash: params.tokenHash,
        provider: params.provider,
        hostname: params.hostname,
        action: params.action,
        success: params.success,
        errorCode: params.errorCode ?? null,
      },
    });
  } catch (e) {
    // 唯一约束冲突 → 视为已记录过；其它错误吞掉不抛
    if (process.env.NODE_ENV !== "production") {
      console.warn("[captcha] record verification failed", e);
    }
  }
}

/**
 * 验证入口：返回 { success, errorCode }。调用方负责把失败映射为统一提示。
 * 任何时刻都尝试记录一次结果（即便 token 为空）。
 */
export async function verifyCaptcha(
  token: string,
  req: Request
): Promise<CaptchaResult> {
  const cfg = getCaptchaConfig();
  const provider = getCaptchaProvider();
  const trimmed = (token ?? "").trim();
  const tokenHash = sha256Hex(trimmed || "empty");
  const hostname = (() => {
    try {
      return new URL(req.url).hostname;
    } catch {
      return "";
    }
  })();

  if (!cfg.enabled) {
    // 未启用验证码：视为通过，并记录一次 mock 成功（便于审计）
    await recordVerification({
      tokenHash,
      provider: provider.name,
      hostname,
      action: cfg.action,
      success: true,
      errorCode: "disabled",
    });
    return { success: true };
  }

  const result = await provider.verify(trimmed, req);
  await recordVerification({
    tokenHash,
    provider: provider.name,
    hostname,
    action: cfg.action,
    success: result.success,
    errorCode: result.errorCode,
  });
  return result;
}
