// Centralised admin API middleware
import { NextRequest } from "next/server";
import { requireAdminApi, getSession } from "./auth";
import { verifyCsrfToken } from "./csrf";
import { ZodError } from "zod";

/**
 * Wrap an API handler with common admin checks:
 *   - requireAdminApi (401 if not logged in)
 *   - CSRF verification for unsafe methods (POST, PUT, DELETE) – 403 on failure
 *   - Unified error handling: Zod validation errors -> 400, unexpected -> 500
 */
export function wrap<T extends (...args: any[]) => Promise<Response>>(
  handler: T
) {
  return async function (req: Request, ...rest: any[]): Promise<Response> {
    // Cast to NextRequest when needed for type safety
    const nextReq = req as unknown as NextRequest;
    // Admin guard
    const guard = await requireAdminApi();
    if (guard) return guard;

    // CSRF for unsafe methods
    if (nextReq.method && ["POST", "PUT", "DELETE"].includes(nextReq.method)) {
      const ok = await verifyCsrfToken(req);
      if (!ok) {
        return new Response(JSON.stringify({ error: "CSRF 验证失败" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    try {
      return await handler(req, ...rest);
    } catch (e) {
      if (e instanceof ZodError) {
        return new Response(JSON.stringify({ error: e.message, details: e.errors }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      // For other errors, hide stack
      return new Response(JSON.stringify({ error: "服务器内部错误" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}
