/**
 * /api/admin/taxonomy/category/[id]
 *
 * PUT    - 重命名分类（同步更新 slug；重名/slug 冲突 409）。
 *          分类在 Article 表上是字符串字段（无外键），重命名会同步把引用
 *          旧名称的文章记录一并改写，保持 DB 一致；注意 md frontmatter 仍是
 *          内容源，下次 content-sync 会以后者为准。
 * DELETE - 删除分类（软删保护：仍被文章引用则 409 拒绝；无引用才真删）。
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
    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "分类不存在");

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
    if (name !== existing.name) {
      const slug = slugifyName(name);
      const conflict = await db.category.findFirst({
        where: { OR: [{ name }, { slug }], id: { not: id } },
      });
      if (conflict) {
        return jsonError(409, "分类名称或 slug 已存在");
      }
      try {
        const renamed = await db.category.update({
          where: { id },
          data: { name, slug },
        });
        // 字符串字段无外键：把引用旧名称的文章记录一并改写
        const renamedArticles = await db.article.updateMany({
          where: { category: existing.name },
          data: { category: name },
        });
        await logAudit({
          adminId: session?.id ?? "",
          action: AUDIT_ACTIONS.TAXONOMY_CATEGORY_UPDATE,
          targetType: "category",
          targetId: id,
          metadata: {
            before: { name: existing.name, slug: existing.slug },
            after: { name, slug },
            renamedArticles: renamedArticles.count,
          },
        });
        return jsonOk({ ok: true, category: toTaxonomyDto(renamed) });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          return jsonError(409, "分类名称或 slug 已存在");
        }
        throw e;
      }
    }

    // 名称未变化：幂等返回
    return jsonOk({ ok: true, category: toTaxonomyDto(existing) });
  }
);

export const DELETE = wrap(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await getSession();
    const { id } = await ctx.params;
    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "分类不存在");

    const refCount = await db.article.count({
      where: { category: existing.name },
    });
    if (refCount > 0) {
      return jsonError(409, `该分类仍被 ${refCount} 篇文章引用，无法删除`);
    }

    await db.category.delete({ where: { id } });
    await logAudit({
      adminId: session?.id ?? "",
      action: AUDIT_ACTIONS.TAXONOMY_CATEGORY_DELETE,
      targetType: "category",
      targetId: id,
      metadata: { name: existing.name, slug: existing.slug },
    });
    return jsonOk({ ok: true, id });
  }
);
