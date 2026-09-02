"use client";

/**
 * 评论列表行内操作。
 * - normal：批准 / 拒绝 / 删除（软删），走 /api/admin/comments/[id]/*。
 * - deleted：已删文章的存档评论（DeletedComment）——文章已删，审核无意义，
 *   只提供"物理删除"（DELETE /api/admin/deleted-comments/[id]）。
 * - 完成后调用 router.refresh() 让 server component 重新拉取列表。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fetchWithCsrf } from "@/lib/fetchWithCsrf";

type Props = {
  commentId: string;
  status: string;
  deletedAt: string | null;
  variant?: "normal" | "deleted";
};

export function CommentRowActions({ commentId, status, deletedAt, variant = "normal" }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  function call(url: string, method: "POST" | "DELETE", label: string) {
    setError(null);
    setBusyAction(label);
    startTransition(async () => {
      try {
        const res = await fetchWithCsrf(url, {
          method,
          headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
          body: method === "POST" ? "{}" : undefined,
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error || `${label} 失败`);
          return;
        }
        router.refresh();
      } catch {
        setError("网络异常，请重试");
      } finally {
        setBusyAction(null);
      }
    });
  }

  // 已删文章的存档评论：只支持物理删除
  if (variant === "deleted") {
    return (
      <div className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("确认物理删除这条存档评论？此操作不可撤销。")) return;
            call(`/api/admin/deleted-comments/${commentId}`, "DELETE", "delete");
          }}
          className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/40"
        >
          {busyAction === "delete" ? "删除中…" : "删除"}
        </button>
        {error ? (
          <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
        ) : null}
      </div>
    );
  }

  const isDeleted = !!deletedAt;
  const busy = pending;

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
        {status !== "approved" && !isDeleted ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              call(
                `/api/admin/comments/${commentId}/approve`,
                "POST",
                "approve"
              )
            }
            className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
          >
            {busyAction === "approve" ? "批准中…" : "批准"}
          </button>
        ) : null}
        {status !== "rejected" && !isDeleted ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              call(
                `/api/admin/comments/${commentId}/reject`,
                "POST",
                "reject"
              )
            }
            className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
          >
            {busyAction === "reject" ? "拒绝中…" : "拒绝"}
          </button>
        ) : null}
        {!isDeleted ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("确认删除这条评论？此操作不可撤销。")) return;
              call(
                `/api/admin/comments/${commentId}`,
                "DELETE",
                "delete"
              );
            }}
            className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/40"
          >
            {busyAction === "delete" ? "删除中…" : "删除"}
          </button>
        ) : null}
        {isDeleted ? (
          <span className="text-xs text-slate-400">已删除</span>
        ) : null}
      </div>
      {error ? (
        <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
      ) : null}
    </div>
  );
}
