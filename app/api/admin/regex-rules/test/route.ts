/**
 * /api/admin/regex-rules/test
 *
 * POST - 测试一段文本，调用 processComment/testRules 给出结果，不修改任何数据。
 */
import { z, ZodError } from "zod";
import { NextRequest } from "next/server";
import { wrap } from "@/lib/admin-api";
import { testRules } from "@/lib/regex-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testSchema = z.object({
  text: z.string().max(5000).optional().default(""),
});

function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST = wrap(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "请求体不是合法 JSON");
  }
  let data: z.infer<typeof testSchema>;
  try {
    data = testSchema.parse(body ?? {});
  } catch (e) {
    if (e instanceof ZodError) {
      return jsonError(400, e.issues[0]?.message ?? "参数错误");
    }
    throw e;
  }
  const result = await testRules(data.text);
  return jsonOk({
    ok: true,
    action: result.action,
    finalText: result.finalText,
    hits: result.hits,
  });
});
