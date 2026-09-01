/**
 * POST /api/comfy/upload
 *
 * Upload ComfyUI workflows and images (admin only).
 * - Validates file type (json, png, jpg, jpeg, webp) and size limits
 * - Stores files in uploads/comfy/ directory
 * - Creates ComfyItem record in database
 */
import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import sharp from "sharp";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth";
import { verifyCsrfToken } from "@/lib/csrf";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const ALLOWED_TYPES = {
  WORKFLOW: ["application/json"] as const,
  IMAGE: ["image/png", "image/jpeg", "image/webp"] as const
} as const;

const SIZE_LIMITS = {
  WORKFLOW: 2 * 1024 * 1024, // 2MB
  IMAGE: 10 * 1024 * 1024 // 10MB
} as const;

/**
 * 解析 PNG tEXt/iTXt 文本块（ComfyUI 会把工作流 JSON 嵌在 keyword 为
 * "prompt"/"workflow" 的文本块中）。纯内置实现，无新依赖。
 */
function extractPngTextChunks(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  const SIG_LEN = 8;
  let off = SIG_LEN;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    if (type === "IEND") break;
    const dataStart = off + 8;
    if (dataStart + len > buf.length) break;
    if (type === "tEXt") {
      const data = buf.subarray(dataStart, dataStart + len);
      const nul = data.indexOf(0);
      if (nul > 0) {
        out[data.toString("latin1", 0, nul)] = data.toString("latin1", nul + 1);
      }
    } else if (type === "iTXt") {
      const data = buf.subarray(dataStart, dataStart + len);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const keyword = data.toString("utf8", 0, nul);
        let p = nul + 1;
        const compFlag = data[p];
        p += 1; // compression flag
        p += 1; // compression method
        const langEnd = data.indexOf(0, p);
        if (langEnd === -1) { off += 12 + len; continue; }
        p = langEnd + 1;
        const translatedEnd = data.indexOf(0, p);
        if (translatedEnd === -1) { off += 12 + len; continue; }
        p = translatedEnd + 1;
        try {
          const raw = compFlag === 1
            ? inflateSync(data.subarray(p))
            : data.subarray(p);
          out[keyword] = raw.toString("utf8");
        } catch {
          // 压缩块损坏则跳过该块
        }
      }
    }
    off += 12 + len;
  }
  return out;
}

function extractWorkflowFromPng(buf: Buffer): string | null {
  const chunks = extractPngTextChunks(buf);
  for (const key of ["workflow", "prompt"]) {
    const raw = chunks[key];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return raw;
    } catch {
      // 该块不是合法 JSON，尝试下一个关键字
    }
  }
  return null;
}

function determineType(mimeType: string): "WORKFLOW" | "IMAGE" | null {
  if (ALLOWED_TYPES.WORKFLOW.includes(mimeType as any)) return "WORKFLOW";
  if (ALLOWED_TYPES.IMAGE.includes(mimeType as any)) return "IMAGE";
  return null;
}

async function validateFileTypeWithMagicNumber(file: File): Promise<{ type: "WORKFLOW" | "IMAGE" | null; error?: string }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  
  // Check magic numbers for each file type
  if (file.type === "application/json" || file.name.endsWith('.json')) {
    // JSON: first character should be { or [
    if (buffer.length > 0) {
      const firstChar = String.fromCharCode(buffer[0]);
      if (firstChar === '{' || firstChar === '[') {
        try {
          JSON.parse(buffer.toString());
          return { type: "WORKFLOW" };
        } catch {
          return { type: null, error: "Invalid JSON file" };
        }
      }
    }
    return { type: null, error: "Invalid JSON file format" };
  }
  
  if (file.type === "image/png" || file.name.endsWith('.png')) {
    // PNG: first 8 bytes should be 89 50 4E 47 0D 0A 1A 0A
    const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    if (buffer.slice(0, 8).equals(pngSignature)) {
      return { type: "IMAGE" };
    }
    return { type: null, error: "Invalid PNG file format" };
  }
  
  if (file.type === "image/jpeg" || file.name.endsWith('.jpg') || file.name.endsWith('.jpeg')) {
    // JPEG: first 3 bytes should be FF D8 FF
    const jpegSignature = Buffer.from([0xFF, 0xD8, 0xFF]);
    if (buffer.slice(0, 3).equals(jpegSignature)) {
      return { type: "IMAGE" };
    }
    return { type: null, error: "Invalid JPEG file format" };
  }
  
  if (file.type === "image/webp" || file.name.endsWith('.webp')) {
    // WEBP: first 4 bytes should be RIFF, bytes 8-11 should be WEBP
    const riffSignature = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
    const webpSignature = Buffer.from([0x57, 0x45, 0x42, 0x50]); // "WEBP"
    if (buffer.slice(0, 4).equals(riffSignature) && 
        buffer.slice(8, 12).equals(webpSignature)) {
      return { type: "IMAGE" };
    }
    return { type: null, error: "Invalid WEBP file format" };
  }
  
  return { type: null, error: "Unsupported file type" };
}

/** 扩展名按已校验的类型白名单推导，不采信原始文件名扩展名（审核报告 P3） */
const EXT_BY_TYPE: Record<"WORKFLOW" | "IMAGE", string> = {
  WORKFLOW: "json",
  IMAGE: "png", // 具体图片扩展名由调用方按 mime 细化
};

function generateSafeFileName(originalName: string, ext: string): string {
  const timestamp = Date.now();
  const random = randomBytes(8).toString("hex");
  const baseName = originalName.split(".")[0]?.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 50) || "unnamed";
  return `${timestamp}_${random}_${baseName}.${ext}`;
}

function imageExtByMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export async function POST(req: NextRequest) {
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
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string | null;
    const description = formData.get("description") as string | null;
    // 上传面板的期望类型（workflow 模式接受 png 并尝试提取内嵌工作流）
    const mode = formData.get("mode") === "WORKFLOW" ? "WORKFLOW" : "IMAGE";
    const keepImage = formData.get("keepImage") === "1";

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    const fileSize = file.size;
    
    // Validate file type using magic number validation
    const magicValidation = await validateFileTypeWithMagicNumber(file);
    if (!magicValidation.type) {
      return NextResponse.json(
        { error: magicValidation.error || "Invalid file type. Allowed: JSON, PNG, JPG, JPEG, WEBP" },
        { status: 400 }
      );
    }
    
    let fileType = magicValidation.type;
    const mimeType = file.type; // Keep original MIME type for database

    // 工作流模式上传 PNG：尝试从文本块提取内嵌工作流 JSON。
    // 提取成功 → 落库为 WORKFLOW（可选保留原图入展示）；
    // 提取失败 → 按主人要求明确提示"不包含工作流"。
    let workflowJson: string | null = null;
    const isPng = mimeType === "image/png" || file.name.endsWith(".png");
    if (mode === "WORKFLOW" && isPng) {
      const pngBuffer = Buffer.from(await file.arrayBuffer());
      workflowJson = extractWorkflowFromPng(pngBuffer);
      if (!workflowJson) {
        return NextResponse.json(
          { error: "该 PNG 图片不包含 ComfyUI 工作流元数据，请直接以图片形式上传" },
          { status: 400 }
        );
      }
      fileType = "WORKFLOW";
    }

    const isPngWorkflow = fileType === "WORKFLOW" && workflowJson !== null;
    const sizeLimit = !isPngWorkflow && fileType === "WORKFLOW" ? SIZE_LIMITS.WORKFLOW : SIZE_LIMITS.IMAGE;
    if (fileSize > sizeLimit) {
      const maxSizeMB = !isPngWorkflow && fileType === "WORKFLOW" ? "2MB" : "10MB";
      return NextResponse.json(
        { error: `File too large. Maximum size for ${fileType.toLowerCase()} files is ${maxSizeMB}` },
        { status: 400 }
      );
    }

    // 元数据长度上限（审核报告 P3）
    const trimmedTitle = title?.trim() || "";
    const trimmedDescription = description?.trim() || "";
    if (trimmedTitle.length > 200) {
      return NextResponse.json({ error: "Title too long (max 200)" }, { status: 400 });
    }
    if (trimmedDescription.length > 1000) {
      return NextResponse.json({ error: "Description too long (max 1000)" }, { status: 400 });
    }

    // 魔数校验阶段已读取过一次内容，这里复用同一个 Buffer，避免 10MB 文件双倍峰值内存
    const safeExt =
      fileType === "WORKFLOW" && workflowJson === null
        ? EXT_BY_TYPE.WORKFLOW
        : imageExtByMime(file.type || "");
    const uploadDir = join(process.cwd(), "uploads", "comfy");
    
    try {
      await mkdir(uploadDir, { recursive: true });
    } catch {
      return NextResponse.json(
        { error: "Failed to create upload directory" },
        { status: 500 }
      );
    }

    let buffer = Buffer.from(await file.arrayBuffer());
    let storeExt = safeExt;
    let storeMime = mimeType;

    // png 内嵌工作流：磁盘上落标准 JSON 文件
    if (workflowJson !== null) {
      buffer = Buffer.from(workflowJson, "utf8");
      storeExt = "json";
      storeMime = "application/json";
    }

    const safeFileName = generateSafeFileName(
      file.name,
      storeExt
    );
    const filePath = join(uploadDir, safeFileName);

    await writeFile(filePath, buffer);

    const session = await (await import("@/lib/auth")).getSession();
    const comfyItem = await db.comfyItem.create({
      data: {
        title: trimmedTitle || safeFileName,
        type: fileType,
        fileName: safeFileName,
        filePath: `uploads/comfy/${safeFileName}`,
        mimeType: storeMime,
        sizeBytes: buffer.byteLength,
        description: trimmedDescription || null,
      },
    });

    // IMAGE 类型生成瀑布墙缩略图（宽 480px，目标几十 KB）。
    // 降级策略：生成失败不导致上传失败，console.warn 后瀑布墙回退加载原图。
    if (fileType === "IMAGE" && workflowJson === null) {
      try {
        const thumbDir = join(process.cwd(), "uploads", "comfy", "thumb");
        const mediumDir = join(process.cwd(), "uploads", "comfy", "medium");
        await mkdir(thumbDir, { recursive: true });
        await mkdir(mediumDir, { recursive: true });
        await sharp(buffer)
          .rotate()
          .resize({ width: 480, withoutEnlargement: true })
          .jpeg({ quality: 72 })
          .toFile(join(thumbDir, safeFileName + ".jpg"));
        // 中图档（灯箱预览用，宽 1600px）：解码快、不阻塞主线程
        await sharp(buffer)
          .rotate()
          .resize({ width: 1600, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(join(mediumDir, safeFileName + ".jpg"));
      } catch (thumbErr) {
        console.warn(
          "[comfy/upload] thumbnail generation failed, gallery will fall back to original:",
          thumbErr
        );
      }
    }

    // 可选：同时保留原图入展示
    let imageItem: {
      id: string;
      title: string;
      type: string;
      fileName: string;
      createdAt: Date;
    } | null = null;
    if (workflowJson !== null && keepImage) {
      const imgSafeName = generateSafeFileName(file.name, imageExtByMime(mimeType || ""));
      const imgPath = join(uploadDir, imgSafeName);
      const imgBuffer = Buffer.from(await file.arrayBuffer());
      await writeFile(imgPath, imgBuffer);
      imageItem = await db.comfyItem.create({
        data: {
          title: trimmedTitle ? `${trimmedTitle}（图）` : imgSafeName,
          type: "IMAGE",
          fileName: imgSafeName,
          filePath: `uploads/comfy/${imgSafeName}`,
          mimeType: mimeType || "image/png",
          sizeBytes: imgBuffer.byteLength,
          description: trimmedDescription || null,
        },
      });
    }

    await logAudit({
      adminId: session?.id || "",
      action: AUDIT_ACTIONS.CREATE,
      targetType: "comfy_item",
      targetId: comfyItem.id,
      metadata: { 
        fileName: safeFileName,
        fileType,
        fileSize 
      },
    });

    return NextResponse.json({
      ok: true,
      id: comfyItem.id,
      title: comfyItem.title,
      type: comfyItem.type,
      fileName: comfyItem.fileName,
      createdAt: comfyItem.createdAt,
      ...(imageItem
        ? {
            imageItem: {
              id: imageItem.id,
              title: imageItem.title,
              type: imageItem.type,
              fileName: imageItem.fileName,
              createdAt: imageItem.createdAt,
            },
          }
        : {}),
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}