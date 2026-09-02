/**
 * /api/admin/taxonomy/tag/[id]
 *
 * PUT    - 重命名标签（同步更新 slug；ArticleTag 以 tagId 关联，重命名自动生效）。
 * DELETE - 删除标签（软删保护：仍被文章引用则 409 拒绝；无引用才真删）。
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

export const PUT = wrap(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await getSession();
    const { id } = await ctx.params;
    const existing = await db.tag.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "标签不存在");

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
    if (name === existing.name) {
      return jsonOk({ ok: true, tag: toTaxonomyDto(existing) });
    }

    const slug = slugifyName(name);
    const conflict = await db.tag.findFirst({
      where: { OR: [{ name }, { slug }], id: { not: id } },
    });
    if (conflict) {
      return jsonError(409, "标签名称或 slug 已存在");
    }
    try {
      const renamed = await db.tag.update({
        where: { id },
        data: { name, slug },
      });
      await logAudit({
        adminId: session?.id ?? "",
        action: AUDIT_ACTIONS.TAXONOMY_TAG_UPDATE,
        targetType: "tag",
        targetId: id,
        metadata: {
          before: { name: existing.name, slug: existing.slug },
          after: { name, slug },
        },
      });
      return jsonOk({ ok: true, tag: toTaxonomyDto(renamed) });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return jsonError(409, "标签名称或 slug 已存在");
      }
      throw e;
    }
  }
);

export const DELETE = wrap(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await getSession();
    const { id } = await ctx.params;
    const existing = await db.tag.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "标签不存在");

    const refCount = await db.articleTag.count({ where: { tagId: id } });
    if (refCount > 0) {
      return jsonError(409, `该标签仍被 ${refCount} 篇文章引用，无法删除`);
    }

    await db.tag.delete({ where: { id } });
    await logAudit({
      adminId: session?.id ?? "",
      action: AUDIT_ACTIONS.TAXONOMY_TAG_DELETE,
      targetType: "tag",
      targetId: id,
      metadata: { name: existing.name, slug: existing.slug },
    });
    return jsonOk({ ok: true, id });
  }
);
