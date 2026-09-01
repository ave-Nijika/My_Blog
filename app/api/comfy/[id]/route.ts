/**
 * GET /api/comfy/[id]
 * DELETE /api/comfy/[id]
 *
 * Get item details (public) or delete item (admin only).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth";
import { verifyCsrfToken } from "@/lib/csrf";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const item = await db.comfyItem.findUnique({
      where: { id },
    });

    if (!item) {
      return NextResponse.json(
        { error: "Item not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: item.id,
      title: item.title,
      type: item.type,
      fileName: item.fileName,
      // 不返回 filePath：向公开访客暴露服务器目录结构（审核报告 P2-2）
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      description: item.description,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  } catch (error) {
    console.error("Get item error:", error);
    return NextResponse.json(
      { error: "Failed to fetch item" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  // Verify CSRF token
  const csrfValid = await verifyCsrfToken(req);
  if (!csrfValid) {
    return NextResponse.json(
      { error: "Invalid CSRF token" },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const session = await (await import("@/lib/auth")).getSession();

    const item = await db.comfyItem.findUnique({
      where: { id },
    });

    if (!item) {
      return NextResponse.json(
        { error: "Item not found" },
        { status: 404 }
      );
    }

    try {
      const fullPath = join(process.cwd(), item.filePath);
      await unlink(fullPath);
    } catch (error) {
      console.error("Failed to delete file:", error);
    }

    await db.comfyItem.delete({
      where: { id },
    });

    await logAudit({
      adminId: session?.id || "",
      action: AUDIT_ACTIONS.DELETE,
      targetType: "comfy_item",
      targetId: id,
      metadata: { 
        fileName: item.fileName,
        fileType: item.type 
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete item error:", error);
    return NextResponse.json(
      { error: "Failed to delete item" },
      { status: 500 }
    );
  }
}