"use client";

/**
 * 文章列表行内操作：发布 / 私有 / 删除。
 * - 发布和私有走专用 API 端点（生成 Git 提交 + 同步 DB）。
 * - 删除用 window.confirm 做二次确认，命中后跳专用 API。
 * - 操作进行中禁用按钮 + 显示 pending 状态。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithCsrf } from "@/lib/fetchWithCsrf";

type Props = {
  postId: string;
  status: string;
};

export function PostRowActions({ postId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  function run(
    action: "publish" | "private" | "delete",
    confirmMessage?: string
  ) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setError(null);
    setPendingAction(action);
    startTransition(async () => {
      try {
        const url =
          action === "delete"
            ? `/api/admin/posts/${postId}`
            : `/api/admin/posts/${postId}/${action}`;
        const res = await fetchWithCsrf(url, {
          method: action === "delete" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: action === "delete" ? undefined : "{}",
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error || `${action} 失败`);
          return;
        }
        router.refresh();
      } catch {
        setError("网络异常，请重试");
      } finally {
        setPendingAction(null);
      }
    });
  }

  const busy = pending;

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
        <Link
          href={`/admin/posts/${postId}/edit`}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          编辑
        </Link>
        {status !== "public" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run("publish")}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
          >
            {pendingAction === "publish" ? "发布中…" : "发布"}
          </button>
        ) : null}
        {status !== "private" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run("private")}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {pendingAction === "private" ? "处理中…" : "改为私有"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(
              "delete",
              "确认删除这篇文章？此操作不可撤销，对应的 Markdown 文件也会被删除并产生 Git 提交。"
            )
          }
          className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/40"
        >
          {pendingAction === "delete" ? "删除中…" : "删除"}
        </button>
      </div>
      {error ? (
        <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
      ) : null}
    </div>
  );
}
