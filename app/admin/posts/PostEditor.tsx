"use client";

/**
 * 文章编辑器（新建/编辑共用）。
 *
 * 字段：
 *   - title, slug, summary, category, tags (逗号分隔),
 *     status (draft|public|private), pinned, publishedAt, body (markdown)
 *
 * 行为：
 *   - 保存草稿 → status=draft，写入
 *   - 发布 → status=public，写入
 *   - 改为私有 → status=private，写入
 *   - 预览切换：在编辑器右侧/下方展开 react-markdown 渲染
 *   - 校验：title 非空、slug 合法、status 合法由服务端最终把关
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { fetchWithCsrf } from "@/lib/fetchWithCsrf";

export type PostFormValues = {
  id?: string;
  title: string;
  slug: string;
  summary: string;
  status: "draft" | "public" | "private";
  category: string;
  tagsInput: string;
  pinned: boolean;
  publishedAt: string; // ISO 字符串或空字符串
  body: string;
};

type TaxonomyItem = { id: string; name: string; slug: string };

type Taxonomy = { categories: TaxonomyItem[]; tags: TaxonomyItem[] };

type Props = {
  initial: PostFormValues;
  mode: "create" | "edit";
};

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function toInputDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // 转为 <input type="datetime-local"> 接受的本地时间
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputDateTime(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function PostEditor({ initial, mode }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<PostFormValues>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();

  // 预置分类/标签（含自定义与文章聚合项，见 /api/admin/taxonomy）。
  // 拉取失败不影响编辑器：快捷选择只是增强，输入框始终可用。
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ categories: [], tags: [] });
  useEffect(() => {
    let cancelled = false;
    fetchWithCsrf("/api/admin/taxonomy")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as
          | (Taxonomy & { ok?: boolean })
          | null;
        if (!cancelled && data) {
          setTaxonomy({
            categories: data.categories ?? [],
            tags: data.tags ?? [],
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 分类快捷项：输入时按已填内容过滤（可搜索），空则展示全部
  const categoryInput = values.category.trim();
  const categoryPresets = categoryInput
    ? taxonomy.categories.filter((c) => c.name.includes(categoryInput))
    : taxonomy.categories;
  // 标签快捷项：已加入的置灰不可重复点击
  const currentTags = values.tagsInput
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);

  function addTag(name: string) {
    if (currentTags.includes(name)) return;
    update("tagsInput", [...currentTags, name].join(", "));
  }

  function update<K extends keyof PostFormValues>(key: K, value: PostFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function buildPayload(targetStatus: "draft" | "public" | "private") {
    // 发布时间语义：
    // - 发布时（targetStatus === "public"）：publishedAt 为空则自动设为当前时间
    // - 用户手动输入了时间则用用户输入的值（已发布文章的"更新发布"也尊重用户选择）
    // - 非发布状态（草稿/私有）：存用户输入值或 null
    const publishedAt =
      targetStatus === "public"
        ? fromInputDateTime(values.publishedAt) || new Date().toISOString()
        : fromInputDateTime(values.publishedAt);
    return {
      slug: values.slug.trim(),
      title: values.title.trim(),
      summary: values.summary.trim(),
      status: targetStatus,
      category: values.category.trim(),
      cover: "",
      pinned: values.pinned,
      publishedAt,
      tags: values.tagsInput
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      body: values.body,
    };
  }

  function save(targetStatus: "draft" | "public" | "private") {
    setError(null);
    setSuccess(null);
    if (!values.title.trim()) {
      setError("标题不能为空");
      return;
    }
    if (!SLUG_RE.test(values.slug.trim())) {
      setError("slug 只能包含小写字母、数字和中划线");
      return;
    }
    const payload = buildPayload(targetStatus);
    startTransition(async () => {
      try {
        const url =
          mode === "create"
            ? "/api/admin/posts"
            : `/api/admin/posts/${values.id}`;
        const method = mode === "create" ? "POST" : "PUT";
        const res = await fetchWithCsrf(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          post?: { id: string; slug: string; status: string };
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error || "保存失败");
          return;
        }
        setSuccess("已保存并产生 Git 提交。");
        if (mode === "create" && data.post?.id) {
          router.replace(`/admin/posts/${data.post.id}/edit`);
        } else {
          router.refresh();
        }
        if (data.post) {
          setValues((prev) => ({
            ...prev,
            status: data.post!.status as PostFormValues["status"],
            slug: data.post!.slug,
          }));
        }
      } catch {
        setError("网络异常，请重试");
      }
    });
  }

  function doDelete() {
    if (!values.id) return;
    setError(null);
    setSuccess(null);
    startDelete(async () => {
      try {
        const res = await fetchWithCsrf(`/api/admin/posts/${values.id}`, {
          method: "DELETE",
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error || "删除失败");
          return;
        }
        router.replace("/admin/posts");
        router.refresh();
      } catch {
        setError("网络异常，请重试");
      }
    });
  }

  const isPublic = values.status === "public";
  const isDraft = values.status === "draft";

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
        >
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {success}
        </div>
      ) : null}

      {/* 状态下拉已删除（与三个动作按钮冗余），标题+slug 改两列均分，
          消除原三列栅格第三列的空白（主人截图红圈处） */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="标题" required>
          <input
            type="text"
            value={values.title}
            onChange={(e) => update("title", e.target.value)}
            maxLength={200}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </Field>
        <Field
          label="slug"
          hint="仅小写字母、数字与中划线，作为文件名（content/posts/<slug>.md）"
        >
          <input
            type="text"
            value={values.slug}
            onChange={(e) => update("slug", e.target.value)}
            pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </Field>
      </div>

      <Field label="摘要">
        <textarea
          value={values.summary}
          onChange={(e) => update("summary", e.target.value)}
          rows={2}
          maxLength={500}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </Field>

      <div className="grid gap-4 lg:grid-cols-3">
        <Field label="分类" hint="点击预置项快速填入（输入时可搜索过滤），也可自由输入">
          <input
            type="text"
            value={values.category}
            onChange={(e) => update("category", e.target.value)}
            maxLength={64}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          {categoryPresets.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {categoryPresets.map((c) => (
                <PresetChip
                  key={c.id || c.name}
                  label={c.name}
                  active={categoryInput === c.name}
                  onClick={() => update("category", c.name)}
                />
              ))}
            </div>
          ) : null}
        </Field>
        <Field label="标签" hint="使用逗号分隔；点击预置标签加入，已加入的置灰">
          <input
            type="text"
            value={values.tagsInput}
            onChange={(e) => update("tagsInput", e.target.value)}
            placeholder="例：随笔, 学习, 算法"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          {taxonomy.tags.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {taxonomy.tags.map((tag) => (
                <PresetChip
                  key={tag.id || tag.name}
                  label={tag.name}
                  active={currentTags.includes(tag.name)}
                  dimmed={currentTags.includes(tag.name)}
                  onClick={() => addTag(tag.name)}
                />
              ))}
            </div>
          ) : null}
        </Field>
        <Field label="发布时间" hint="发布时若留空将自动设为现在">
          <input
            type="datetime-local"
            value={toInputDateTime(values.publishedAt)}
            onChange={(e) => update("publishedAt", e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </Field>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={values.pinned}
            onChange={(e) => update("pinned", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 dark:border-slate-600 dark:text-sky-400 dark:focus:ring-sky-400"
          />
          置顶
        </label>
        <span className="ml-3 text-xs text-slate-500 dark:text-slate-400">
          状态：{isDraft ? "草稿" : isPublic ? "已发布" : "私有"}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => save("draft")}
            disabled={pending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            {pending ? "保存中…" : isDraft ? "保存草稿" : "保存为草稿"}
          </button>
          <button
            type="button"
            onClick={() => save("public")}
            disabled={pending}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? "发布中…" : isPublic ? "更新发布" : "发布"}
          </button>
          <button
            type="button"
            onClick={() => save("private")}
            disabled={pending}
            className="rounded-md border border-slate-500 bg-slate-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
          >
            {pending ? "处理中…" : "改为私有"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="ba-btn px-3 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {showPreview ? "隐藏预览" : "实时预览"}
          </button>
          {mode === "edit" ? (
            confirmDelete ? (
              <button
                type="button"
                onClick={doDelete}
                disabled={deleting}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-rose-700 disabled:opacity-60"
              >
                {deleting ? "删除中…" : "再次点击确认删除"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/40"
              >
                删除
              </button>
            )
          ) : null}
        </div>
      </div>

      <div className={showPreview ? "grid gap-4 lg:grid-cols-2" : ""}>
        <Field label="正文（Markdown）" full>
          <textarea
            value={values.body}
            onChange={(e) => update("body", e.target.value)}
            rows={showPreview ? 18 : 24}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </Field>
        {showPreview ? (
          <Field label="预览" full>
            <div className="prose-content min-h-[24rem] rounded-md border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
              {values.body.trim() ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {values.body}
                </ReactMarkdown>
              ) : (
                <p className="text-sm text-slate-400 dark:text-slate-500">暂无内容可预览</p>
              )}
            </div>
          </Field>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  full,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={"flex flex-col gap-1 " + (full ? "w-full" : "")}>
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
        {required ? <span className="ml-1 text-rose-600 dark:text-rose-400">*</span> : null}
      </span>
      {children}
      {hint ? (
        <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span>
      ) : null}
    </label>
  );
}

/** 预置分类/标签 chip：active 表示已选中/已加入，dimmed 表示不可再点（已加入） */
function PresetChip({
  label,
  active,
  dimmed = false,
  onClick,
}: {
  label: string;
  active: boolean;
  dimmed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-disabled={dimmed || undefined}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        active
          ? "border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-300"
          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-400 hover:text-sky-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-sky-500 dark:hover:text-sky-400"
      } ${
        dimmed
          ? "cursor-default opacity-45 hover:border-slate-200 hover:text-slate-600 dark:hover:border-slate-700 dark:hover:text-slate-300"
          : ""
      }`}
    >
      {label}
    </button>
  );
}

export {};
