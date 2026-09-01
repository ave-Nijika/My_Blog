// 统一的后台 API 请求工具：自动携带 CSRF token（双重提交 Cookie 方案）
// 用法：import { fetchWithCsrf } from "@/lib/fetchWithCsrf";
//       await fetchWithCsrf("/api/admin/xxx", { method: "POST", body: ... });

let cachedCsrfToken: string | null = null;
let csrfPromise: Promise<string | null> | null = null;

/** 获取 CSRF token：先请求 /api/csrf 播种 cookie 并返回 token，之后缓存复用 */
async function getCsrfToken(): Promise<string | null> {
  if (cachedCsrfToken) return cachedCsrfToken;
  if (csrfPromise) return csrfPromise;
  csrfPromise = (async () => {
    try {
      const res = await fetch("/api/csrf", { method: "GET", credentials: "same-origin" });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { csrfToken?: string };
        if (data.csrfToken) {
          cachedCsrfToken = data.csrfToken;
          return data.csrfToken;
        }
      }
      // body 没返回 token 时，从 cookie 兜底读取（double-submit 模式下 cookie 值即 token）
      const fromCookie = document.cookie
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("CSRF="));
      if (fromCookie) {
        cachedCsrfToken = fromCookie.split("=").slice(1).join("=");
      }
      return cachedCsrfToken;
    } catch {
      return null;
    }
  })();
  return csrfPromise;
}

/** 带 CSRF 的后台 API 请求（等价于 fetch，自动附加 X-CSRF-Token 头） */
export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers || {});
  // 仅 JSON 请求需要显式 Content-Type；FormData 必须留给浏览器自动生成
  // multipart/form-data; boundary=...（显式设置会丢失 boundary，服务端
  // req.formData() 将解析失败——详见 docs/最终审核报告-UI重构版.md P0-2）
  if (
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type") &&
    options.body
  ) {
    headers.set("Content-Type", "application/json");
  }
  const token = await getCsrfToken();
  if (token) {
    headers.set("X-CSRF-Token", token);
  }
  return fetch(url, { ...options, headers, credentials: "same-origin" });
}

/** 重置缓存的 token（登出或 token 失效时调用） */
export function resetCsrfToken(): void {
  cachedCsrfToken = null;
  csrfPromise = null;
}