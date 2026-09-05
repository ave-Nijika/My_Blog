/**
 * 通用内存滑动窗口限流（进程内，重启清零，键数上限防膨胀）。
 * 安全审查 P1.10：搜索为全表扫描 + 无限流，需按 IP 限流。
 * 生产为单容器部署（blog-app-1），进程内桶足够；多实例需换 Redis（本批不做）。
 */
export interface Bucket {
  count: number;
  windowStart: number;
}

const BUCKET_MAX_KEYS = 10_000;

function pruneBuckets(buckets: Map<string, Bucket>, now: number, windowMs: number): void {
  if (buckets.size < BUCKET_MAX_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > windowMs) buckets.delete(key);
    if (buckets.size < BUCKET_MAX_KEYS / 2) break;
  }
}

/** 纯函数：消费一次配额。返回是否放行 + 建议重试秒数。便于 node 环境单测。 */
export function consume(
  buckets: Map<string, Bucket>,
  key: string,
  max: number,
  windowMs: number,
  now: number
): { allowed: boolean; retryAfterSec: number } {
  pruneBuckets(buckets, now, windowMs);
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - bucket.windowStart)) / 1000)),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Next.js dev 下页面与路由处理器可能各自持有本模块实例（分层编译），
// 桶挂到 globalThis 保证搜索 API 与 SSR 页共享同一份限流状态
// （同 lib/site-settings.ts 缓存槽的先例）。
const globalForRateLimit = globalThis as unknown as {
  __searchRateBuckets?: Map<string, Bucket>;
};
export const searchBuckets: Map<string, Bucket> =
  globalForRateLimit.__searchRateBuckets ?? new Map<string, Bucket>();
globalForRateLimit.__searchRateBuckets = searchBuckets;
/** 搜索限流入口：按客户端 IP，默认 30 次/60 秒，可用 env 覆盖（测试注入小值）。 */
export function tryConsumeSearch(
  ip: string
): { allowed: boolean; retryAfterSec: number } {
  const max = envInt("SEARCH_RATE_LIMIT_MAX_ATTEMPTS", 30);
  const windowMs = envInt("SEARCH_RATE_LIMIT_WINDOW_SECONDS", 60) * 1000;
  return consume(searchBuckets, `search:${ip}`, max, windowMs, Date.now());
}
