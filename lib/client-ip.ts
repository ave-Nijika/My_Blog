// 可信代理 IP 解析（修复 P1-1：X-Forwarded-For 被无条件信任的漏洞）
// 规则：仅当 XFF 链中从右往左遇到第一个"不在 TRUSTED_PROXY_CIDRS 网段内"的地址时，才认定其为真实客户端 IP。
// 若 XFF 缺失或全部位于可信网段，回退到 x-real-ip，最后回退 "0.0.0.0"。
// 用途：评论限流/冷却、IP HMAC 身份、IP 封禁、管理员登录失败锁定等所有基于 IP 的防护。

import { isIP } from "node:net";

interface Cidr {
  ip: number;
  mask: number;
}

/** 解析 CIDR 字符串（仅支持 IPv4，IPv4 地址可用 Number 精确表示，无需 BigInt） */
function parseCidr(cidr: string): Cidr | null {
  const [ipStr, bitsStr] = cidr.split("/");
  if (!ipStr) return null;
  const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
  if (!isIP(ipStr) || isNaN(bits) || bits < 0 || bits > 32) return null;
  const parts = ipStr.split(".").map(Number);
  if (parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
  // IPv4 转 32 位整数（用 Number，范围内精确）
  const ip = parts.reduce((acc, p) => (acc * 256 + p) >>> 0, 0);
  // 高 bits 位置 1 的网络掩码（如 /8 => 0xFF000000）
  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
  return { ip: ip & mask, mask };
}

function ipToNum(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return -1;
  return parts.reduce((acc, p) => (acc * 256 + p) >>> 0, 0);
}

function ipInCidr(ip: string, cidr: Cidr): boolean {
  const n = ipToNum(ip);
  if (n === -1) return false;
  return (n & cidr.mask) === cidr.ip;
}

/** 从环境变量读取可信代理网段；未配置时视为"不可信任何代理"（只信直连） */
function trustedCidrs(): Cidr[] {
  const raw = (process.env.TRUSTED_PROXY_CIDRS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseCidr(s.trim()))
    .filter((c): c is Cidr => c !== null);
}

/** 最小头接口：同时兼容原生 Request 与 Next 的 ReadonlyHeaders */
export interface HeadersLike {
  headers: { get(name: string): string | null };
}

/** 获取真实客户端 IP（对 XFF 做可信代理过滤，从右往左取第一个不可信地址） */
export function getClientIp(req: HeadersLike): string {
  const trusted = trustedCidrs();
  const fwd = req.headers.get("x-forwarded-for");
  // 只有当显式配置了可信代理网段时，才采信 X-Forwarded-For（防伪造）
  if (trusted.length > 0 && fwd) {
    const parts = fwd
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // 从右往左找第一个不可信地址（正向代理会追加，越靠右越接近客户端真实来源）
    for (let i = parts.length - 1; i >= 0; i--) {
      const ip = parts[i];
      if (isIP(ip) && !trusted.some((c) => ipInCidr(ip, c))) {
        return ip;
      }
    }
    // 若全部可信/无效，取最左一个有效地址作为兜底
    const first = parts.find((p) => isIP(p));
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}