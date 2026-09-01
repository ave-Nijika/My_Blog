// CSRF double‑submit cookie implementation
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

export const CSRF_COOKIE_NAME = "CSRF";

/** Get token from cookie or generate a new one */
export async function getCsrfToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CSRF_COOKIE_NAME)?.value;
  if (existing) return existing;
  const token = randomBytes(24).toString("hex");
  // cookie readable by JS, not HttpOnly
  store.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return token;
}

/** Verify request CSRF token matches cookie */
export async function verifyCsrfToken(req: Request): Promise<boolean> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  const header = req.headers.get("x-csrf-token");
  return !!(cookie && header && cookie === header);
}
