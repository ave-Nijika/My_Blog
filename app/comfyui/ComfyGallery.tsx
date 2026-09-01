"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { fetchWithCsrf, resetCsrfToken } from "@/lib/fetchWithCsrf";
import { Reveal } from "@/components/Reveal";
import { BaLazyImage } from "@/components/BaLazyImage";

export type ComfyItemView = {
  id: string;
  title: string;
  type: "WORKFLOW" | "IMAGE";
  fileName: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type ComfyApiItem = {
  id: string;
  title: string;
  type: "WORKFLOW" | "IMAGE";
  fileName: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = { items: ComfyApiItem[] };

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileIcon(item: ComfyItemView): string {
  if (item.type === "WORKFLOW") return "📋";
  if (item.mimeType === "image/png") return "🖼️";
  if (item.mimeType === "image/jpeg") return "🖼️";
  if (item.mimeType === "image/webp") return "🖼️";
  return "📄";
}

export function ComfyGallery({
  isAdmin,
  initialItems,
}: {
  isAdmin: boolean;
  initialItems: ComfyItemView[];
}) {
  const { t, locale } = useLocale();
  const dict = t("comfyui");
  const common = t("common");
  const [items, setItems] = useState<ComfyItemView[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ComfyItemView | null>(null);
  const [workflowPreview, setWorkflowPreview] = useState<ComfyItemView | null>(null);
  const [filter, setFilter] = useState<"ALL" | "IMAGE" | "WORKFLOW">("ALL");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadType, setUploadType] = useState<"WORKFLOW" | "IMAGE">("WORKFLOW");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function triggerDownload(item: ComfyItemView) {
    const a = document.createElement("a");
    a.href = `/api/comfy/${item.id}/download`;
    a.download = item.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function showToast(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/comfy?limit=100", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setItems(data.items);
      showToast("ok", dict.refreshSuccess);
    } catch (e) {
      console.error(e);
      showToast("err", dict.uploadFailed);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(item: ComfyItemView) {
    const ok = window.confirm(dict.confirmDelete.replace("{{title}}", item.title));
    if (!ok) return;
    // 乐观删除：立即从列表移除（UI 永不被排队中的网络请求阻塞——
    // 此前 DELETE 排在图片流后面导致"删除卡死整页"），失败则回滚。
    const snapshot = items;
    setItems((prev) => prev.filter((x) => x.id !== item.id));
    try {
      const res = await fetchWithCsrf(`/api/comfy/${item.id}`, {
        method: "DELETE",
      });
      if (res.status === 401) {
        resetCsrfToken();
        setItems(snapshot);
        showToast("err", dict.loginRequiredDelete);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `${dict.uploadFailed} (HTTP ${res.status})`);
      }
      showToast("ok", dict.deletedMsg.replace("{{title}}", item.title));
    } catch (e) {
      console.error(e);
      setItems(snapshot);
      showToast("err", e instanceof Error ? e.message : dict.uploadFailed);
    }
  }

  const filtered = items.filter((x) =>
    filter === "ALL" ? true : x.type === filter
  );

  return (
    <div className="space-y-8">
      {toast && (
        <div
          className={`fixed top-20 right-4 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg backdrop-blur ${
            toast.kind === "ok"
              ? "bg-emerald-100/95 text-emerald-800 dark:bg-emerald-900/80 dark:text-emerald-200"
              : "bg-rose-100/95 text-rose-800 dark:bg-rose-900/80 dark:text-rose-200"
          }`}
          role="status"
        >
          {toast.msg}
        </div>
      )}

      {/* Admin Upload Section - Completely hidden from non-admins.
          常驻触发按钮 + 手风琴展开（修复"上传一次后入口消失"） */}
      {isAdmin && (
        <Reveal translateY={10} className="mb-6">
          <div className="ba-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2.5">
                <span className="ba-tri h-4 w-5" aria-hidden />
                <h2 className="ba-font-round text-lg text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
                  {dict.uploadManage}
                </h2>
                <span className="ba-pill ba-pill--soft">{dict.adminMode}</span>
              </div>
              <div className="flex items-center gap-2">
                {(
                  [
                    ["WORKFLOW", dict.uploadWorkflow],
                    ["IMAGE", dict.uploadImage],
                  ] as const
                ).map(([typeValue, label]) => (
                  <button
                    key={typeValue}
                    type="button"
                    aria-expanded={uploadOpen && uploadType === typeValue}
                    onClick={() => {
                      if (uploadOpen && uploadType === typeValue) {
                        setUploadOpen(false);
                        return;
                      }
                      setUploadType(typeValue);
                      setUploadOpen(true);
                    }}
                    className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-all duration-200 max-sm:text-sm ${
                      uploadOpen && uploadType === typeValue
                        ? "border-transparent bg-[rgb(var(--ba-primary))] text-white shadow-[0_3px_10px_rgba(18,137,249,0.35)]"
                        : "border-[rgb(var(--ba-primary))]/45 bg-[color:rgb(var(--color-surface))] text-[color:rgb(var(--ba-primary))] hover:-translate-y-0.5 hover:bg-[color:rgb(var(--ba-primary-soft))]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 手风琴：grid-rows 0fr→1fr 流畅上下展开 */}
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                uploadOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden">
                <UploadPanel
                  open={uploadOpen}
                  onClose={() => setUploadOpen(false)}
                  uploadType={uploadType}
                  onTypeChange={setUploadType}
                  onUploaded={(newItems) => {
                    setItems((prev) => [...newItems, ...prev]);
                    showToast("ok", dict.uploadSuccess);
                  }}
                  onError={(msg) => showToast("err", msg)}
                />
              </div>
            </div>
          </div>
        </Reveal>
      )}

      <Reveal translateY={8} delay={60} className="flex flex-wrap items-center gap-2">
        <FilterChip
          active={filter === "ALL"}
          onClick={() => setFilter("ALL")}
          label={`${common.total.replace("{{total}}", String(items.length))} · ${locale === "zh-CN" ? "全部" : "All"}`}
        />
        <FilterChip
          active={filter === "IMAGE"}
          onClick={() => setFilter("IMAGE")}
          label={`${dict.image} (${items.filter((x) => x.type === "IMAGE").length})`}
        />
        <FilterChip
          active={filter === "WORKFLOW"}
          onClick={() => setFilter("WORKFLOW")}
          label={`${dict.workflow} (${items.filter((x) => x.type === "WORKFLOW").length})`}
        />
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:bg-slate-900/60 dark:text-sky-300 dark:hover:bg-sky-950/40"
          aria-label="refresh"
        >
          {loading ? (
            <>
              <span className="ba-spinner" aria-hidden />
              {common.loading}
            </>
          ) : (
            <span aria-hidden>↻</span>
          )}
        </button>
      </Reveal>

      {/* Workflow Cards Section */}
      {filter === "ALL" || filter === "WORKFLOW" ? (
        <div className="space-y-4">
          {(filter === "ALL" ? filtered.filter(x => x.type === "WORKFLOW") : filtered).length === 0 ? (
            <Reveal className="ba-card p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <span className="ba-tri h-9 w-11 opacity-70" aria-hidden />
                <div>
                  <h3 className="ba-font-round text-lg font-semibold text-[color:rgb(var(--color-text-primary))] dark:text-slate-100 mb-2">
                    {filter === "ALL" ? dict.noWorkflowAll : dict.noWorkflowFilter}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 max-sm:text-sm">
                    {filter === "ALL"
                      ? dict.noWorkflowAllHint
                      : dict.noWorkflowFilterHint
                    }
                  </p>
                </div>
                {filter === "ALL" && isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadType("WORKFLOW");
                      setUploadOpen(true);
                    }}
                    className="ba-btn-primary ba-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
                  >
                    {dict.uploadFirstWorkflow}
                  </button>
                )}
              </div>
            </Reveal>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {(filter === "ALL" ? filtered.filter(x => x.type === "WORKFLOW") : filtered).map((item, index) => (
                <Reveal
                  key={item.id}
                  as="article"
                  delay={Math.min(index, 6) * 60}
                  translateY={12}
                  className="ba-card group relative overflow-hidden p-5 block"
                >
                  <div className="flex items-start gap-4">
                    {/* 官网母题：黄三角 + 浅黄软底（工作流类型标识） */}
                    <div className="flex h-14 w-16 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--ba-yellow))]/18" aria-hidden>
                      <span className="ba-tri h-7 w-8" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="ba-font-round text-lg font-semibold text-[color:rgb(var(--color-text-primary))] dark:text-slate-100 truncate">
                          {item.title}
                        </h3>
                        <span className="ba-font-display text-[11px] tracking-[0.1em] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                          {new Date(item.createdAt).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US")}
                        </span>
                      </div>

                      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                        {item.description || dict.noDescription}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 max-sm:text-sm">
                        <span className="flex min-w-0 items-center gap-1">
                          <span aria-hidden>📄</span>
                          <span className="truncate">{item.fileName}</span>
                        </span>
                        <span className="flex items-center gap-1 whitespace-nowrap">
                          <span aria-hidden>💾</span>
                          {formatBytes(item.sizeBytes)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[color:rgb(var(--ba-line))] pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = `/api/comfy/${item.id}/download`;
                        a.download = item.fileName;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                      }}
                      className="ba-btn px-4 py-1.5 text-xs"
                    >
                      {dict.download}
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPreview(null);
                          setWorkflowPreview(item);
                        }}
                        className="ba-btn px-3 py-1.5 text-xs"
                      >
                        {dict.preview}
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDelete(item)}
                          className="rounded-full border border-rose-300 bg-[color:rgb(var(--color-surface))] px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:-translate-y-0.5 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                          title={common.delete}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Image Waterfall Gallery */}
      {filter === "ALL" || filter === "IMAGE" ? (
        <div className="space-y-4">
          {(filter === "ALL" ? filtered.filter(x => x.type === "IMAGE") : filtered).length === 0 ? (
            <Reveal className="ba-card p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <span className="ba-tri h-9 w-11 rotate-180 opacity-70" aria-hidden />
                <div>
                  <h3 className="ba-font-round text-lg font-semibold text-[color:rgb(var(--color-text-primary))] dark:text-slate-100 mb-2">
                    {filter === "ALL" ? dict.noImageAll : dict.noImageFilter}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 max-sm:text-sm">
                    {filter === "ALL"
                      ? dict.noImageAllHint
                      : dict.noImageFilterHint
                    }
                  </p>
                </div>
                {filter === "ALL" && isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadType("IMAGE");
                      setUploadOpen(true);
                    }}
                    className="ba-btn-primary ba-btn inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
                  >
                    {dict.uploadFirstImage}
                  </button>
                )}
              </div>
            </Reveal>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* grid 固定列数 + 每张固定 4:3 比例（object-cover）：
                  图片加载不再改变任何容器高度，消除 columns 布局的多列反复重排 */}
              {(filter === "ALL" ? filtered.filter(x => x.type === "IMAGE") : filtered).map((item, index) => (
                <Reveal
                  key={item.id}
                  as="div"
                  delay={Math.min(index, 6) * 60}
                  translateY={14}
                  className="ba-card group overflow-hidden rounded-xl block"
                >
                  <div className="relative aspect-[4/3] overflow-hidden ba-card-image-wrap">
                    {/* 并发受控懒加载缩略图（480px，几十 KB）：解码不再阻塞主线程；
                        导航请求不再被图片流挤占连接池。灯箱仍加载原图（用户主动点击）。 */}
                    <BaLazyImage
                      src={`/api/comfy/${item.id}/download?thumb=1`}
                      alt={item.title}
                      className="ba-card-image h-full w-full object-cover cursor-pointer"
                      onClick={() => setPreview(item)}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <div className="absolute bottom-0 left-0 right-0 p-3 text-white translate-y-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                      <h3 className="text-sm font-semibold truncate">{item.title}</h3>
                      <p className="text-xs opacity-90">{formatBytes(item.sizeBytes)}</p>
                    </div>
                  </div>

                  <div className="p-3">
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2 line-clamp-2">
                      {item.description || dict.noDescription}
                    </p>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(item.createdAt).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US")}
                      </span>
                      <div className="flex items-center gap-1">
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                              className="rounded-full border border-rose-300 bg-[color:rgb(var(--color-surface))] px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:-translate-y-0.5 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            title={common.delete}
                          >
✕
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => triggerDownload(item)}
                          className="ba-btn px-2.5 py-1 text-xs"
                        >
                          {dict.download}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreview(item)}
                          className="ba-btn px-2.5 py-1 text-xs"
                        >
                          {dict.preview}
                        </button>
                      </div>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {preview && (
        <ImageLightbox item={preview} onClose={() => setPreview(null)} />
      )}

      {workflowPreview && (
        <WorkflowPreview item={workflowPreview} onClose={() => setWorkflowPreview(null)} />
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-xs font-medium tracking-wide transition-all duration-200 max-sm:text-sm ${
        active
          ? "border-transparent bg-[rgb(var(--ba-primary))] text-white shadow-[0_3px_10px_rgba(18,137,249,0.35)]"
          : "border-[rgb(var(--ba-primary))]/45 bg-[color:rgb(var(--color-surface))] text-[color:rgb(var(--ba-primary))] hover:-translate-y-0.5 hover:bg-[color:rgb(var(--ba-primary-soft))]"
      }`}
    >
      {label}
    </button>
  );
}

function UploadPanel({
  onUploaded,
  onError,
  open,
  onClose,
  uploadType,
  onTypeChange,
}: {
  onUploaded: (items: ComfyItemView[]) => void;
  onError: (msg: string) => void;
  open: boolean;
  onClose: () => void;
  uploadType: "WORKFLOW" | "IMAGE";
  onTypeChange: (type: "WORKFLOW" | "IMAGE") => void;
}) {
  const { t } = useLocale();
  const dict = t("comfyui");
  const common = t("common");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [keepImage, setKeepImage] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      onError(dict.uploadFailed);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", uploadType);
      // 工作流模式上传 png 时：是否同时保留原图入展示
      form.append("keepImage", keepImage ? "1" : "0");
      if (title.trim()) form.append("title", title.trim());
      if (description.trim()) form.append("description", description.trim());
      const res = await fetchWithCsrf("/api/comfy/upload", {
        method: "POST",
        body: form,
      });
      if (res.status === 401) {
        resetCsrfToken();
        onError(dict.loginRequired);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        id: string;
        title: string;
        type: "WORKFLOW" | "IMAGE";
        fileName: string;
        filePath: string;
        mimeType: string;
        sizeBytes: number;
        description: string | null;
        createdAt: string;
        updatedAt: string;
        imageItem?: {
          id: string;
          title: string;
          type: "WORKFLOW" | "IMAGE";
          fileName: string;
          createdAt: string;
        };
      };
      const toView = (
        it: {
          id: string;
          title: string;
          type: "WORKFLOW" | "IMAGE";
          fileName: string;
          createdAt: string;
        },
        fallbackDescription: string | null,
        fallbackSize: number
      ): ComfyItemView => ({
        id: it.id,
        title: it.title,
        type: it.type,
        fileName: it.fileName,
        filePath: "",
        mimeType: it.type === "WORKFLOW" ? "application/json" : "image/png",
        sizeBytes: it.type === "WORKFLOW" ? fallbackSize : 0,
        description: fallbackDescription,
        createdAt: it.createdAt,
        updatedAt: it.createdAt,
      });
      const uploaded: ComfyItemView[] = [
        toView(body, description.trim() || null, file.size),
      ];
      if (body.imageItem) {
        uploaded.push(
          toView(body.imageItem, description.trim() || null, file.size)
        );
      }
      onUploaded(uploaded);
      // 成功后保留面板并清空表单，支持连续上传多个文件
      reset();
    } catch (err) {
      console.error(err);
      onError(err instanceof Error ? err.message : dict.uploadFailed);
    } finally {
      setUploading(false);
    }
  }

  // 保持挂载以支持手风琴动画与连续上传（显隐由外层 grid-rows 控制）
  return (
    <form
      onSubmit={handleSubmit}
      className="ba-card mt-4 space-y-5 p-6"
      hidden={!open}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-8 w-10 items-center justify-center rounded-md ${
            uploadType === "WORKFLOW"
              ? "bg-[rgb(var(--ba-yellow))]/18"
              : "bg-[color:rgb(var(--ba-primary-soft))]"
          }`} aria-hidden>
            <span className={`ba-tri h-3.5 w-4 ${uploadType === "IMAGE" ? "rotate-180" : ""}`} />
          </div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {uploadType === "WORKFLOW" ? dict.uploadWorkflow : dict.uploadImage}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => {
            reset();
            onClose();
          }}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          aria-label={common.cancel}
        >
          <span className="text-xl">✕</span>
        </button>
      </div>

      {/* Type Selection */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onTypeChange("WORKFLOW")}
          className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition max-sm:text-sm ${
            uploadType === "WORKFLOW"
              ? "border-[rgb(var(--ba-yellow))] bg-[rgb(var(--ba-yellow))]/15 text-[#7a6a00] dark:bg-[rgb(var(--ba-yellow))]/12 dark:text-[rgb(var(--ba-yellow))]"
              : "border-[color:rgb(var(--color-border))] bg-[color:rgb(var(--color-surface))] text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          {dict.workflowFile}
        </button>
        <button
          type="button"
          onClick={() => onTypeChange("IMAGE")}
          className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition max-sm:text-sm ${
            uploadType === "IMAGE"
              ? "border-[rgb(var(--ba-primary))] bg-[color:rgb(var(--ba-primary-soft))] text-[color:rgb(var(--ba-primary))] dark:text-[color:rgb(var(--ba-primary-light))]"
              : "border-[color:rgb(var(--color-border))] bg-[color:rgb(var(--color-surface))] text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          {dict.imageArtwork}
        </button>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {dict.titleLabel} · {dict.titlePlaceholder}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={dict.titlePlaceholder}
          className="w-full rounded-lg border border-sky-200 bg-white px-4 py-3 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent dark:border-sky-800 dark:bg-slate-900"
          maxLength={200}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {dict.descLabel}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={dict.descPlaceholder}
          rows={3}
          className="w-full rounded-lg border border-sky-200 bg-white px-4 py-3 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent dark:border-sky-800 dark:bg-slate-900"
          maxLength={500}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {dict.selectFile}
        </label>
        <div
          className="rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/50 p-6 text-center transition-all hover:border-sky-400 hover:bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/30 dark:hover:border-sky-600"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const f = e.dataTransfer.files?.[0];
            if (f && validateFileType(f)) setFile(f);
          }}
        >
          <input
            ref={fileInput}
            type="file"
            accept={uploadType === "WORKFLOW" 
              ? ".json,.png,application/json,image/png" 
              : ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            }
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && validateFileType(f)) setFile(f);
            }}
            className="hidden"
          />
          
          <div className="flex flex-col items-center gap-3">
            <div className={`flex h-12 w-14 items-center justify-center rounded-lg ${
              uploadType === "WORKFLOW"
                ? "bg-[rgb(var(--ba-yellow))]/18"
                : "bg-[color:rgb(var(--ba-primary-soft))]"
            }`} aria-hidden>
              <span className={`ba-tri h-5 w-6 ${uploadType === "IMAGE" ? "rotate-180" : ""}`} />
            </div>
            
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-sky-700 shadow-sm transition hover:bg-sky-50 dark:bg-slate-900 dark:text-sky-300"
            >
              {dict.orSelectFile}
            </button>
            
            <div className="text-center">
              {file ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {file.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatBytes(file.size)}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {uploadType === "WORKFLOW"
                    ? dict.workflowFileHint
                    : `${dict.imageFiles} · ${dict.maxSizeImage}`}
                </p>
              )}
            </div>
          </div>
        </div>

        {uploadType === "WORKFLOW" && (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300 max-sm:text-sm">
            <input
              type="checkbox"
              checked={keepImage}
              onChange={(e) => setKeepImage(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-[rgb(var(--ba-primary))]"
            />
            {dict.keepImageNote}
          </label>
        )}
      </div>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => {
            reset();
            onClose();
          }}
          className="rounded-lg border border-sky-200 bg-white px-6 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-sky-800 dark:bg-slate-900 dark:text-slate-300"
        >
          {common.cancel}
        </button>
        <button
          type="submit"
          disabled={uploading || !file}
          className="ba-button-primary px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {uploading ? (
            <div className="flex items-center gap-2">
              <span className="ba-spinner" aria-hidden />
              {common.loading}
            </div>
          ) : (
            dict.uploadButton
          )}
        </button>
      </div>
    </form>
  );

  function validateFileType(file: File): boolean {
    if (uploadType === "WORKFLOW") {
      return (
        file.type === "application/json" ||
        file.name.endsWith(".json") ||
        file.type === "image/png" ||
        file.name.endsWith(".png")
      );
    }
    return ["image/png", "image/jpeg", "image/webp"].includes(file.type);
  }
}

function ImageLightbox({
  item,
  onClose,
}: {
  item: ComfyItemView;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const common = t("common");
  const dict = t("comfyui");
  // 中图（1600px 档）经 fetch + AbortController 加载：
  // 点 ✕ 卸载时 abort() 立即掐断后台下载，杜绝"关闭后浏览器继续拉原图、
  // 下载完在主线程解码 4MB 大图"的残留卡顿（主人实测复现的问题）。
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setSrc(null);
    setFailed(false);
    fetch(`/api/comfy/${item.id}/download?size=1600`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        setSrc(URL.createObjectURL(blob));
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setFailed(true);
      });
    return () => {
      controller.abort(); // 叉掉即停止后台下载
    };
  }, [item.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // objectURL 生命周期：卸载时释放，避免内存泄漏
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="ba-card relative max-h-[90vh] max-w-[90vw] overflow-hidden p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-3 px-2">
          <h3 className="line-clamp-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
            {item.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={common.cancel}
          >
            ✕
          </button>
        </div>
        {src ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={src}
            alt={item.title}
            decoding="async"
            className="max-h-[80vh] max-w-full rounded-lg object-contain"
          />
        ) : (
          <div
            className="flex h-[60vh] w-[60vw] max-w-[80vw] items-center justify-center rounded-lg bg-[color:rgb(var(--ba-primary-soft))] dark:bg-slate-800"
            role="status"
          >
            {failed ? (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {dict.loadFailed.replace("{{error}}", "preview")}
              </span>
            ) : (
              <span className="ba-spinner" aria-hidden />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowPreview({
  item,
  onClose,
}: {
  item: ComfyItemView;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const dict = t("comfyui");
  const common = t("common");
  const [jsonContent, setJsonContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadJson() {
      try {
        const response = await fetch(`/api/comfy/${item.id}/download`);
        if (!response.ok) throw new Error("Failed to load workflow");
        const text = await response.text();
        setJsonContent(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load workflow");
      } finally {
        setLoading(false);
      }
    }

    loadJson();
  }, [item.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="ba-card relative max-h-[90vh] max-w-[90vw] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-4 border-b border-sky-100 dark:border-sky-900">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {item.title}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const a = document.createElement("a");
                a.href = `/api/comfy/${item.id}/download`;
                a.download = item.fileName;
                document.body.appendChild(a);
                a.click();
                a.remove();
              }}
              className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-50 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-950/40"
            >
              {dict.downloadJson}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={common.cancel}
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {loading && (
            <div className="flex items-center justify-center h-64 gap-3 text-sm text-slate-400">
              <span className="ba-spinner" aria-hidden />
              {dict.loadingWorkflow}
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-64">
              <div className="text-sm text-rose-500">
                {dict.loadFailed.replace("{{error}}", error)}
              </div>
            </div>
          )}

          {jsonContent && !loading && !error && (
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-xs bg-slate-900/50 p-4 rounded-lg overflow-auto max-h-full">
                <code>{jsonContent}</code>
              </pre>
            </div>
          )}

          <div className="p-4 border-t border-sky-100 dark:border-sky-900 text-xs text-slate-500 dark:text-slate-400">
            {dict.fileSizeCreated
              .replace("{{size}}", formatBytes(item.sizeBytes))
              .replace("{{date}}", new Date(item.createdAt).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US"))}
          </div>
        </div>
      </div>
    </div>
  );
}
