/**
 * /api/posts/[slug]/comments
 *
 * GET  - 公开：返回该文章 status=approved 的评论（按 createdAt 升序）
 * POST - 公开：提交新评论（待审核）。
 *
 * 提交顺序（规格第 14-16 章 / M3c）：
 *   验证码 → 封禁检查 → 冷却 → 限流 → 长度校验 → 文本清洗 →
 *   正则规则 → LLM 审核 → 保存。
 *
 *   - 验证码失败 / 封禁命中 → 通用错误
 *   - 正则 reject  → 拒绝 + 警告（即使 LLM 之后会 approve 也无法绕过）
 *   - 正则 review  → 标为 pending，跳过 LLM
 *   - 正则 replace → 替换后继续；走 LLM
 *   - LLM approve  → approved
 *   - LLM reject   → rejected + 警告 +1
 *   - LLM review   → pending
 *   - LLM 失败/超时/未配置 → pending（不直接批准）
 */
import { db } from "@/lib/db";
import {
  COMMENT_GENERIC_ERROR,
  COMMENT_GENERIC_SUCCESS,
  checkCooldown,
  checkRateLimit,
  commentErrorResponse,
  listApprovedComments,
  recordSubmit,
  resolveVisitorIdentity,
  setVisitorTokenCookie,
  validateAndSanitize,
} from "@/lib/comments";
import { commentBodySchema } from "@/lib/validation";
import { verifyCaptcha } from "@/lib/captcha";
import { processComment, loadCompiledRules } from "@/lib/regex-rules";
import { getEffectiveSiteSettings } from "@/lib/site-settings";
import { applyWarning, checkBan } from "@/lib/visitor";
import {
  isLlmModerationReady,
  moderateComment,
  type LlmModerationOutcome,
} from "@/lib/llm-moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const article = await db.article.findFirst({
    where: { slug, status: "public" },
    select: { id: true },
  });
  if (!article) {
    return jsonOk({ comments: [] });
  }
  const comments = await listApprovedComments(article.id);
  return jsonOk({ comments });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // 0. 找到文章
  const article = await db.article.findFirst({
    where: { slug, status: "public" },
    select: { id: true },
  });
  if (!article) {
    return commentErrorResponse(404, COMMENT_GENERIC_ERROR);
  }

  // 1. 解析访客身份（必要时写 cookie）
  const identity = resolveVisitorIdentity(req);
  if (identity.isNew) {
    try {
      await setVisitorTokenCookie(identity.token);
    } catch {
      // cookie 写失败不影响主流程
    }
  }

  // 2. 解析 + 校验请求体（先拿到 captchaToken 才能走验证码；长度 / 清洗放到后面）
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return commentErrorResponse(400, COMMENT_GENERIC_ERROR);
  }
  const parsed = commentBodySchema.safeParse(raw);
  if (!parsed.success) {
    return commentErrorResponse(400, COMMENT_GENERIC_ERROR);
  }
  const captchaToken = parsed.data.captchaToken ?? "";

  // 3. 验证码（在封禁/冷却/限流之前，避免被恶意探测消耗资源）
  const captchaResult = await verifyCaptcha(captchaToken, req);
  if (!captchaResult.success) {
    return commentErrorResponse(400, COMMENT_GENERIC_ERROR);
  }

  // 4. 封禁检查：处于封禁状态的访客直接返回通用错误
  const ban = await checkBan(identity.ipHmac, identity.tokenHash);
  if (ban) {
    return commentErrorResponse(403, COMMENT_GENERIC_ERROR);
  }

  // 5. 冷却
  const cooldown = await checkCooldown(identity.ipHmac, identity.tokenHash);
  if (cooldown.coolingDown) {
    return commentErrorResponse(429, COMMENT_GENERIC_ERROR, cooldown.retryAfterSec);
  }

  // 6. 限流
  const rate = await checkRateLimit(identity.ipHmac);
  if (rate.limited) {
    return commentErrorResponse(429, COMMENT_GENERIC_ERROR, rate.retryAfterSec);
  }

  // 7. 长度校验 + 文本清洗
  const validated = await validateAndSanitize(parsed.data.bodyText);
  if (!validated.ok) {
    return commentErrorResponse(400, COMMENT_GENERIC_ERROR);
  }

  // 8. 正则规则
  const regexOutcome = await processComment(validated.bodyText);

  // 8a. reject → 立即拒绝，增加警告
  if (regexOutcome.action === "reject") {
    let applied = 0;
    try {
      const w = await applyWarning({
        ipHmac: identity.ipHmac,
        visitorTokenHash: identity.tokenHash,
        delta: regexOutcome.matchedRule.warningIncrement ?? 1,
        source: "regex",
        reason: `regex reject: ${regexOutcome.matchedRule.name}`,
      });
      applied = w.warningCount;
    } catch (e) {
      console.error("[comments] apply warning failed", e);
    }
    return jsonOk({
      ok: true,
      message: COMMENT_GENERIC_SUCCESS,
      warningCount: applied,
    });
  }

  // 8b. 计算最终文本 + 初始状态
  let finalBody = validated.bodyText;
  let finalStatus: "pending" | "approved" | "rejected" = "pending";
  let regexDecision: string | null = null;
  let warningApplied = 0;

  if (regexOutcome.action === "replace") {
    finalBody = regexOutcome.replacementText;
    regexDecision = "replace";
  } else if (regexOutcome.action === "review") {
    finalStatus = "pending";
    regexDecision = "review";
  } else {
    regexDecision = "none";
  }

  // 9. LLM 审核（可选；仅在已配置 + 已启用时真正调用）
  //    正则 review 已经强制人工审核，跳过 LLM；正则为 replace / none 时才走 LLM。
  //    失败/未配置 → 默认 pending，不直接批准。
  let aiOutcome: LlmModerationOutcome | null = null;
  // 是否配置了启用中的正则规则（区分"规则说安全"与"根本没配规则"）
  const compiledRules = await loadCompiledRules();
  const rulesConfigured = compiledRules.length > 0;
  const effectiveCfg = await getEffectiveSiteSettings();
  const llmReady = await isLlmModerationReady();
  const shouldCallLlm = llmReady && regexOutcome.action !== "review";
  if (!shouldCallLlm) {
    if (regexOutcome.action === "review") {
      // 正则明确要求人工：保持 pending，不受规则数量影响
      finalStatus = "pending";
    } else if (rulesConfigured) {
      // 未启用 LLM 且配置了正则：走到这里结论必为 none/replace（安全）→ 自动通过
      finalStatus = "approved";
    } else {
      // 正则与 LLM 都未配置：保守转人工（主人伪代码最后分支）
      finalStatus = "pending";
    }
  }
  if (shouldCallLlm) {
    try {
      aiOutcome = await moderateComment(finalBody);
    } catch (e) {
      console.error("[comments] LLM moderation threw", e);
      aiOutcome = {
        ok: false,
        errorCode: "network",
      };
    }
    if (aiOutcome.ok) {
      if (aiOutcome.decision === "approve") {
        finalStatus = "approved";
      } else if (aiOutcome.decision === "reject") {
        finalStatus = "rejected";
        warningApplied = 1;
      } else {
        finalStatus = "pending";
      }
    } else {
      // LLM 失败（超时/非法响应）：按"LLM 失败时信任正则结果"开关决定。
      // 正则此时已判定安全（none/replace），信任则自动通过，否则保守挂起。
      finalStatus = effectiveCfg.allowRegexOnlyOnLlmFailure
        ? "approved"
        : "pending";
    }
  }

  // 10. 入库
  let createdId: string | null = null;
  try {
    const created = await db.comment.create({
      data: {
        articleId: article.id,
        bodyText: finalBody,
        status: finalStatus,
        ipHmac: identity.ipHmac,
        visitorTokenHash: identity.tokenHash,
        regexDecision,
        warningApplied,
        aiDecision: aiOutcome?.ok ? aiOutcome.decision : null,
        aiCategory: aiOutcome?.ok ? aiOutcome.category : null,
        aiReason: aiOutcome?.ok ? aiOutcome.reason : null,
        aiErrorCode: aiOutcome && !aiOutcome.ok ? aiOutcome.errorCode : null,
      },
      select: { id: true },
    });
    createdId = created.id;
    await recordSubmit(identity.ipHmac, identity.tokenHash);
  } catch (error) {
    console.error("[comments] submit failed", error);
    return commentErrorResponse(500, COMMENT_GENERIC_ERROR);
  }

  // 11. LLM reject 之后增加访客警告
  if (warningApplied > 0) {
    try {
      await applyWarning({
        commentId: createdId ?? undefined,
        ipHmac: identity.ipHmac,
        visitorTokenHash: identity.tokenHash,
        delta: 1,
        source: "llm",
        reason: aiOutcome?.ok
          ? `llm reject: ${aiOutcome.category}`
          : "llm reject",
      });
    } catch (e) {
      console.error("[comments] apply llm warning failed", e);
    }
  }

  return jsonOk({ ok: true, message: COMMENT_GENERIC_SUCCESS });
}
