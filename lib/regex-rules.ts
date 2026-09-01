/**
 * lib/regex-rules.ts
 *
 * RE2 风格的安全正则规则引擎（M3b）。
 *
 * 设计要点：
 *   - 规则从 RegexRule 表加载，仅处理 enabled=true 的，按 priority 升序（数值大优先）。
 *   - 使用 Node 原生 RegExp（不引入第三方 RE2 库）；通过限制 pattern 长度 + 简单语法
 *     + try/catch 包裹避免灾难性回溯。匹配使用 matchAll 找到全部区间。
 *   - 多条规则触发时：reject 优先（一旦命中 reject 立即返回，不继续 evaluate），
 *     其次 review，最后 replace。replace 会把所有规则按 priority 顺序串行应用。
 *   - 失败（语法错、pattern 超长等）一律记 warning，不影响其它规则。
 */
import { db } from "./db";

export type RegexAction = "reject" | "replace" | "review";

export interface RegexRuleRow {
  id: string;
  name: string;
  pattern: string;
  enabled: boolean;
  priority: number;
  action: string;
  replacementText: string;
  warningIncrement: number;
}

export type RegexResult =
  | { action: "none" }
  | {
      action: "reject";
      matchedRule: RegexRuleRow;
      matchedText: string;
    }
  | {
      action: "replace";
      replacementText: string;
      appliedRules: RegexRuleRow[];
    }
  | {
      action: "review";
      matchedRule: RegexRuleRow;
      matchedText: string;
    };

const MAX_PATTERN_LENGTH = 500;
const MAX_COMPILED_RULES = 200;
const COMPILE_TIMEOUT_MS = 200;

function isValidAction(s: string): s is RegexAction {
  return s === "reject" || s === "replace" || s === "review";
}

function safeCompile(pattern: string): RegExp | null {
  if (!pattern) return null;
  if (pattern.length > MAX_PATTERN_LENGTH) return null;
  // RE2 兼容：禁止 lookahead/lookbehind/backreference 等非 RE2 特性
  const banned = [/\(\?[=!]/, /\(\?<[=!]/, /\\\d/];
  for (const b of banned) {
    if (b.test(pattern)) return null;
  }
  // ReDoS 护栏（审核报告 P2）：拒绝经典的嵌套量词结构（如 (a+)+、(.*)*），
  // 这类模式在中等长度输入上即可触发灾难性回溯。保守启发式，
  // 只拦截"量词组内含未限量词"的最危险形态，误杀率低。
  if (/\([^()]*[+*][^()]*\)[+*{]/.test(pattern)) return null;
  try {
    // 显式 u flag 视需要启用；这里只用 g 即可
    return new RegExp(pattern, "g");
  } catch {
    return null;
  }
}

export interface CompiledRegexRule {
  rule: RegexRuleRow;
  re: RegExp;
}

/**
 * 加载并编译当前所有 enabled 规则。返回按 priority 降序（数值大优先）排列。
 * 编译失败的规则被丢弃。
 */
export async function loadCompiledRules(): Promise<CompiledRegexRule[]> {
  const rows = await db.regexRule.findMany({
    where: { enabled: true },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: MAX_COMPILED_RULES,
  });
  const out: CompiledRegexRule[] = [];
  for (const r of rows) {
    if (!isValidAction(r.action)) continue;
    const re = safeCompile(r.pattern);
    if (!re) continue;
    out.push({ rule: { ...r }, re });
  }
  return out;
}

/**
 * 测试用：在不写库的前提下对一段文本跑规则，回报每条命中规则。
 */
export interface RegexTestHit {
  ruleId: string;
  ruleName: string;
  action: RegexAction;
  pattern: string;
  matches: string[];
}

export interface RegexTestResult {
  finalText: string;
  hits: RegexTestHit[];
  action: RegexAction | "none";
}

export async function testRules(text: string): Promise<RegexTestResult> {
  const compiled = await loadCompiledRules();
  const hits: RegexTestHit[] = [];
  let current = text;

  // 遍历所有 reject 规则，任一命中即返回（修复 P1-8：不能被顺序击穿）
  const rejectRules = compiled.filter((c) => c.rule.action === "reject");
  for (const rejectHit of rejectRules) {
    const matches: string[] = [];
    for (const m of current.matchAll(rejectHit.re)) {
      matches.push(m[0]);
      if (matches.length >= 50) break;
    }
    if (matches.length > 0) {
      return {
        finalText: current,
        hits: [
          {
            ruleId: rejectHit.rule.id,
            ruleName: rejectHit.rule.name,
            action: "reject",
            pattern: rejectHit.rule.pattern,
            matches,
          },
        ],
        action: "reject",
      };
    }
  }

  // 串行应用 replace 规则
  const replaceRules = compiled.filter((c) => c.rule.action === "replace");
  for (const c of replaceRules) {
    const matches: string[] = [];
    for (const m of current.matchAll(c.re)) {
      matches.push(m[0]);
      if (matches.length >= 50) break;
    }
    if (matches.length === 0) continue;
    const replacement = c.rule.replacementText ?? "";
    current = current.replace(c.re, replacement);
    hits.push({
      ruleId: c.rule.id,
      ruleName: c.rule.name,
      action: "replace",
      pattern: c.rule.pattern,
      matches,
    });
  }

  // 检查 review
  const reviewRule = compiled.find((c) => c.rule.action === "review");
  if (reviewRule) {
    const matches: string[] = [];
    for (const m of current.matchAll(reviewRule.re)) {
      matches.push(m[0]);
      if (matches.length >= 50) break;
    }
    if (matches.length > 0) {
      hits.push({
        ruleId: reviewRule.rule.id,
        ruleName: reviewRule.rule.name,
        action: "review",
        pattern: reviewRule.rule.pattern,
        matches,
      });
      return { finalText: current, hits, action: "review" };
    }
  }

  return {
    finalText: current,
    hits,
    action: hits.length > 0 ? "replace" : "none",
  };
}

/**
 * 提交流程用：处理一段文本，返回 { action, ... }。
 *   - reject   → 立即拒绝；调用方应配合 applyWarning 增加警告
 *   - replace  → finalText 是替换后的内容，继续提交
 *   - review   → 标记人工审核，调用方把 status 设为 pending
 *   - none     → 无任何规则命中，按原内容提交
 */
export async function processComment(bodyText: string): Promise<RegexResult> {
  const compiled = await loadCompiledRules();
  if (compiled.length === 0) {
    return { action: "none" };
  }

  // reject 优先：遍历所有 reject 规则，任一命中即拒绝（修复 P1-8：不能被顺序击穿）
  const rejectRules = compiled.filter((c) => c.rule.action === "reject");
  for (const rejectRule of rejectRules) {
    const m = bodyText.match(rejectRule.re);
    if (m && m[0]) {
      return {
        action: "reject",
        matchedRule: rejectRule.rule,
        matchedText: m[0],
      };
    }
  }

  // replace 串行应用
  let current = bodyText;
  const applied: RegexRuleRow[] = [];
  for (const c of compiled) {
    if (c.rule.action !== "replace") continue;
    if (!current.match(c.re)) continue;
    current = current.replace(c.re, c.rule.replacementText ?? "");
    applied.push(c.rule);
  }

  // review
  const reviewRule = compiled.find((c) => c.rule.action === "review");
  if (reviewRule) {
    const m = current.match(reviewRule.re);
    if (m && m[0]) {
      return {
        action: "review",
        matchedRule: reviewRule.rule,
        matchedText: m[0],
      };
    }
  }

  if (applied.length > 0) {
    return {
      action: "replace",
      replacementText: current,
      appliedRules: applied,
    };
  }

  return { action: "none" };
}
