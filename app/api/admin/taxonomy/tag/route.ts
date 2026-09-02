/**
 * /api/admin/taxonomy/tag
 *
 * POST - 新建自定义标签 { name }（slug 自动生成；重名/slug 冲突 409）。
 */
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { wrap } from "@/lib/admin-api";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import {
  jsonOk,
  jsonError,
  taxonomyNameSchema,
  slugifyName,
  toTaxonomyDto,
} from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = wrap(async (req: Request) => {
  const session = await getSession();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "请求体不是合法 JSON");
  }
  let data: z.infer<typeof taxonomyNameSchema>;
  try {
    data = taxonomyNameSchema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      return jsonError(400, e.issues[0]?.message ?? "参数错误");
    }
    throw e;
  }

  const name = data.name;
  const slug = slugifyName(name);
  const conflict = await db.tag.findFirst({
    where: { OR: [{ name }, { slug }] },
  });
  if (conflict) {
    return jsonError(409, "标签名称或 slug 已存在");
  }

  try {
    const row = await db.tag.create({ data: { name, slug } });
    await logAudit({
      adminId: session?.id ?? "",
      action: AUDIT_ACTIONS.TAXONOMY_TAG_CREATE,
      targetType: "tag",
      targetId: row.id,
      metadata: { name, slug },
    });
    return jsonOk({ ok: true, tag: toTaxonomyDto(row) }, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError(409, "标签名称或 slug 已存在");
    }
    throw e;
  }
});
