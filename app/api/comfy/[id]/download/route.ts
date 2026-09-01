/**
 * GET /api/comfy/[id]/download
 *
 * Download ComfyUI item file (public access).
 * - IMAGE: served inline with the original mime type.
 * - WORKFLOW: forced download as JSON attachment.
 */
import { NextRequest, NextResponse } from "next/server";
import { stat, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join, basename } from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** Content-Type 白名单：按文件扩展名映射，不信任 DB 中的客户端声明（审核报告 P2-3） */
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  json: "application/json; charset=utf-8",
};

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

    const filePath = join(process.cwd(), item.filePath);

    try {
      await stat(filePath);
    } catch {
      return NextResponse.json(
        { error: "File not found on disk" },
        { status: 404 }
      );
    }

    // 派生图档位（瀑布墙缩略图 / 灯箱中图）：
    //  - ?thumb=1 → 480px（uploads/comfy/thumb/<名>.jpg）
    //  - ?size=1600 → 1600px 中图（uploads/comfy/medium/<名>.jpg，灯箱用）
    //  - 仅 IMAGE 类型提供；已生成直接流式返回，缺失则惰性生成一次并落盘；
    //  - 生成失败降级为原图（维持现状），console.warn 记录。
    //  注意：servePath 必须贯穿到最后 createReadStream（凛修复过误用原图的回归）。
    let servePath = filePath;
    let serveType: string | null = null;
    if (item.type === "IMAGE") {
      const sp = req.nextUrl.searchParams;
      const wantThumb = sp.get("thumb") === "1";
      const sizeParam = Number.parseInt(sp.get("size") ?? "", 10);
      const wantMedium = sizeParam >= 200 && sizeParam <= 4000;
      const ext = item.filePath.split(".").pop()?.toLowerCase() || "";
      if ((wantThumb || wantMedium) && EXT_MIME[ext]?.startsWith("image/")) {
        const width = wantMedium ? sizeParam : 480;
        const dirName = wantMedium ? "medium" : "thumb";
        const quality = wantMedium ? 80 : 72;
        const dir = join(process.cwd(), "uploads", "comfy", dirName);
        const derivedPath = join(dir, `${basename(item.fileName)}.jpg`);
        try {
          await stat(derivedPath);
          servePath = derivedPath;
          serveType = "image/jpeg";
        } catch {
          try {
            await mkdir(dir, { recursive: true });
            await sharp(filePath)
              .rotate()
              .resize({ width, withoutEnlargement: true })
              .jpeg({ quality })
              .toFile(derivedPath);
            servePath = derivedPath;
            serveType = "image/jpeg";
          } catch (thumbErr) {
            console.warn(
              "[comfy/download] lazy derived-image generation failed, falling back to original:",
              thumbErr
            );
          }
        }
      }
    }

    const statInfo = await stat(servePath);
    const headers = new Headers();
    const safeName = basename(item.fileName) || "download";

    if (serveType) {
      // 缩略图分支
      headers.set("Content-Type", serveType);
      headers.set("Content-Disposition", `inline; filename="thumb-${safeName}.jpg"`);
    } else if (item.type === "WORKFLOW") {
      headers.set("Content-Type", "application/json; charset=utf-8");
      headers.set(
        "Content-Disposition",
        `attachment; filename="${safeName}"`
      );
    } else {
      const ext = item.filePath.split(".").pop()?.toLowerCase() || "";
      headers.set("Content-Type", EXT_MIME[ext] || "application/octet-stream");
      headers.set(
        "Content-Disposition",
        `inline; filename="${safeName}"`
      );
    }
    // 流式发送：不再整文件读入内存，TTFB 更快，画廊多图并发时更快释放连接，
    // 避免占满浏览器同源连接池导致站内导航请求排队（主人反馈"加载中无法切换栏目"）。
    headers.set("Content-Length", String(statInfo.size));
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    const stream = Readable.toWeb(
      createReadStream(servePath)
    ) as unknown as ReadableStream;
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json(
      { error: "Failed to download item" },
      { status: 500 }
    );
  }
}
