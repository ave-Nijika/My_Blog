import { getCsrfToken } from "@/lib/csrf";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const token = await getCsrfToken();
  return NextResponse.json({ csrfToken: token });
}
