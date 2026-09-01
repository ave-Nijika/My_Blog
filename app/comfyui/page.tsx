import type { Metadata } from "next";
import Image from "next/image";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ComfyGallery, type ComfyItemView } from "./ComfyGallery";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ComfyUI",
  description: "Share ComfyUI workflows and artworks",
};

const ALLOWED_MIME = new Set([
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function normalizeType(value: string): "WORKFLOW" | "IMAGE" {
  return value === "WORKFLOW" ? "WORKFLOW" : "IMAGE";
}

function toView(row: {
  id: string;
  title: string;
  type: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ComfyItemView {
  return {
    id: row.id,
    title: row.title,
    type: normalizeType(row.type),
    fileName: row.fileName,
    filePath: row.filePath,
    mimeType: ALLOWED_MIME.has(row.mimeType) ? row.mimeType : "application/octet-stream",
    sizeBytes: row.sizeBytes,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export default async function ComfyUIPage() {
  const [session, rows, cookieStore] = await Promise.all([
    getSession(),
    db.comfyItem.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    cookies(),
  ]);
  const isEn = cookieStore.get("locale")?.value === "en";
  const items = rows.map(toView);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      {/* 官网横幅式区头（主人要求恢复的覆盖式视觉）：标题覆盖在场景图上，
          object-[center_28%] 把取景框锚定在画面中上部——四个角色的头部/脖子/
          大部分上半身始终入画，不裁头。 */}
      <header className="relative mb-10 overflow-hidden rounded-xl">
        <Image
          src="/ba/BG_CS_Decagrammaton_03.jpg"
          alt={isEn ? "ComfyUI zone banner" : "ComfyUI 专区横幅"}
          fill
          priority
          sizes="(max-width: 1080px) 100vw, 1024px"
          className="object-cover object-[center_28%]"
        />
        {/* 轻渐变保证标题可读（不糊图，右侧让角色透出） */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#091222]/72 via-[#0a1a36]/28 to-transparent" />
        <div className="relative flex min-h-[150px] items-center justify-between gap-4 px-7 py-6 sm:px-9">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="ba-tri h-5 w-6 shrink-0 drop-shadow-[0_2px_6px_rgba(9,18,34,0.6)]" aria-hidden />
              <h1 className="ba-font-round text-2xl text-white drop-shadow-[0_3px_12px_rgba(9,18,34,0.65)] sm:text-3xl">
                {isEn ? "ComfyUI Zone" : "ComfyUI 专区"}
              </h1>
            </div>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-white/92 [text-shadow:0_1px_8px_rgba(9,18,34,0.7)] max-sm:text-sm">
              {session
                ? isEn
                  ? "Manage and share your ComfyUI workflows and artworks"
                  : "管理并分享你的 ComfyUI 工作流与艺术作品"
                : isEn
                  ? "Browse ComfyUI workflows & artworks · Admins can upload"
                  : "浏览 ComfyUI 工作流与艺术作品 · 管理员可上传分享"}
            </p>
          </div>
          <span className="ba-pill hidden shrink-0 !bg-[rgb(var(--ba-yellow))] !text-[#3a3000] sm:inline-flex">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#3a3000]/70" aria-hidden />
            {isEn ? "Online" : "在线"}
          </span>
        </div>
        {/* 官网签名黄蓝条带收边 */}
        <div
          className="absolute inset-x-0 bottom-0 h-1 bg-[linear-gradient(90deg,rgb(var(--ba-yellow))_0_18%,rgb(var(--ba-primary))_18%_100%)]"
          aria-hidden
        />
      </header>

      <ComfyGallery isAdmin={Boolean(session)} initialItems={items} />
    </div>
  );
}
