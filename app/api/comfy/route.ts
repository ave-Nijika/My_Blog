/**
 * GET /api/comfy
 *
 * List all ComfyUI items (public, read-only).
 * Returns paginated list of workflows and images.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    // 分页参数校验（审核报告 P3）：非法值回退默认，防止负数/超大值导致 500
    const page = Math.max(parseInt(searchParams.get("page") || "1", 10) || 1, 1);
    const rawLimit = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1), 100);
    const type = searchParams.get("type") as "WORKFLOW" | "IMAGE" | null;

    const skip = (page - 1) * limit;

    const where = type ? { type } : {};

    const [items, total] = await Promise.all([
      db.comfyItem.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.comfyItem.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        description: item.description,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("List error:", error);
    return NextResponse.json(
      { error: "Failed to fetch items" },
      { status: 500 }
    );
  }
}