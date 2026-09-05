/**
 * 通用滑动窗口限流纯函数单测（lib/rate-limit.ts，node 环境）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { consume, tryConsumeSearch, searchBuckets } from "@/lib/rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
  searchBuckets.clear();
});

describe("consume（滑动窗口纯函数）", () => {
  it("空桶/新窗口 → 放行", () => {
    const buckets = new Map();
    const r = consume(buckets, "ip:1", 3, 1000, 1000);
    expect(r.allowed).toBe(true);
    expect(r.retryAfterSec).toBe(0);
    expect(buckets.get("ip:1")?.count).toBe(1);
  });

  it("同 key 第 1..max 次放行，第 max+1 次拒绝且 retryAfterSec >= 1", () => {
    const buckets = new Map();
    for (let i = 1; i <= 3; i++) {
      expect(consume(buckets, "ip:1", 3, 10_000, 1000).allowed).toBe(true);
    }
    const blocked = consume(buckets, "ip:1", 3, 10_000, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("窗口过期后恢复放行（计数重新开始）", () => {
    const buckets = new Map();
    for (let i = 0; i < 3; i++) consume(buckets, "ip:1", 3, 1000, 1000);
    expect(consume(buckets, "ip:1", 3, 1000, 1000).allowed).toBe(false);
    // now 越过窗口：旧桶失效，重新计数
    const again = consume(buckets, "ip:1", 3, 1000, 1000 + 1000 + 1);
    expect(again.allowed).toBe(true);
    expect(again.retryAfterSec).toBe(0);
  });

  it("不同 key 互不影响；max=1 时第二次即拒绝", () => {
    const buckets = new Map();
    expect(consume(buckets, "ip:a", 1, 10_000, 1000).allowed).toBe(true);
    expect(consume(buckets, "ip:a", 1, 10_000, 1000).allowed).toBe(false);
    expect(consume(buckets, "ip:b", 1, 10_000, 1000).allowed).toBe(true);
  });
});

describe("tryConsumeSearch（env 覆盖）", () => {
  it("SEARCH_RATE_LIMIT_* 环境变量生效", () => {
    vi.stubEnv("SEARCH_RATE_LIMIT_MAX_ATTEMPTS", "2");
    vi.stubEnv("SEARCH_RATE_LIMIT_WINDOW_SECONDS", "60");
    expect(tryConsumeSearch("1.2.3.4").allowed).toBe(true);
    expect(tryConsumeSearch("1.2.3.4").allowed).toBe(true);
    expect(tryConsumeSearch("1.2.3.4").allowed).toBe(false);
  });

  it("非法 env 值回退默认（30 次/60 秒）", () => {
    vi.stubEnv("SEARCH_RATE_LIMIT_MAX_ATTEMPTS", "-5");
    vi.stubEnv("SEARCH_RATE_LIMIT_WINDOW_SECONDS", "abc");
    // 默认 30 次：前 30 次都放行
    let last = { allowed: true, retryAfterSec: 0 };
    for (let i = 0; i < 30; i++) last = tryConsumeSearch("5.6.7.8");
    expect(last.allowed).toBe(true);
    expect(tryConsumeSearch("5.6.7.8").allowed).toBe(false);
  });
});
