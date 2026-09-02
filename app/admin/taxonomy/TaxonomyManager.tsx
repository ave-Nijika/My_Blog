"use client";

/**
 * 分类/标签管理交互：新增（POST）、重命名（PUT，行内编辑）、删除（DELETE）。
 * 数据操作后 router.refresh() 让服务端组件重取；后端 409（重名/被引用）
 * 的错误信息原样展示在对应栏位。
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fetchWithCsrf } from "@/lib/fetchWithCsrf";

type Item = { id: string; name: string; slug: string };

type Props = {
  initialCategories: Item[];
  initialTags: Item[];
  /** 文章字符串引用但未入库的分类（无 id，仅展示，不可管理） */
  aggregatedCategories: Item[];
};

const inputCls =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

export function TaxonomyManager({
  initialCategories,
  initialTags,
  aggregatedCategories,
}: Props) {
  const router = useRouter();
  const [categories, setCategories] = useState<Item[]>(initialCategories);
  const [tags, setTags] = useState<Item[]>(initialTags);
  useEffect(() => setCategories(initialCategories), [initialCategories]);
  useEffect(() => setTags(initialTags), [initialTags]);

  const [pending, startTransition] = useTransition();

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <TaxonomyColumn
        title="分类"
        emptyHint="暂无分类"
        kind="category"
        items={categories}
        aggregated={aggregatedCategories}
        pending={pending}
        onChanged={startTransition}
        onListUpdate={(items) => setCategories(items)}
        onDone={() => router.refresh()}
      />
      <TaxonomyColumn
        title="标签"
        emptyHint="暂无标签"
        kind="tag"
        items={tags}
        aggregated={[]}
        pending={pending}
        onChanged={startTransition}
        onListUpdate={(items) => setTags(items)}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

type ColumnProps = {
  title: string;
  emptyHint: string;
  kind: "category" | "tag";
  items: Item[];
  aggregated: Item[];
  pending: boolean;
  onChanged: (fn: () => Promise<void>) => void;
  onListUpdate: (items: Item[]) => void;
  onDone: () => void;
};

function TaxonomyColumn({
  title,
  emptyHint,
  kind,
  items,
  aggregated,
  pending,
  onChanged,
  onListUpdate,
  onDone,
}: ColumnProps) {
  const label = kind === "category" ? "分类" : "标签";
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function run(fn: () => Promise<void>) {
    onChanged(async () => {
      try {
        await fn();
      } catch {
        setError("网络异常，请重试");
      }
    });
  }

  function add() {
    const name = newName.trim();
    setError(null);
    if (!name) {
      setError(`${label}名不能为空`);
      return;
    }
    run(async () => {
      const res = await fetchWithCsrf(`/api/admin/taxonomy/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error || "新增失败");
        return;
      }
      setNewName("");
      onDone();
    });
  }

  function startRename(item: Item) {
    setError(null);
    setRenamingId(item.id);
    setRenameValue(item.name);
  }

  function saveRename() {
    if (!renamingId) return;
    const name = renameValue.trim();
    setError(null);
    if (!name) {
      setError(`${label}名不能为空`);
      return;
    }
    run(async () => {
      const res = await fetchWithCsrf(`/api/admin/taxonomy/${kind}/${renamingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error || "重命名失败");
        return;
      }
      setRenamingId(null);
      onDone();
    });
  }

  function remove(item: Item) {
    setError(null);
    run(async () => {
      const res = await fetchWithCsrf(`/api/admin/taxonomy/${kind}/${item.id}`, {
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
      onListUpdate(items.filter((row) => row.id !== item.id));
      onDone();
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white/70 p-6 dark:border-slate-800 dark:bg-slate-900/40">
      <h2 className="ba-font-round mb-4 text-lg text-slate-800 dark:text-slate-100">
        {title}管理
      </h2>

      {/* 新增 */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newName}
          maxLength={64}
          placeholder={`输入新${label}名（最长 64 字符）`}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!pending) add();
            }
          }}
          className={inputCls + " w-full"}
        />
        <button
          type="button"
          onClick={add}
          disabled={pending}
          className="ba-button-primary shrink-0 px-4 py-2 text-sm disabled:opacity-60"
        >
          新增
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
        >
          {error}
        </p>
      ) : null}

      {/* 列表 */}
      <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
        {items.length === 0 && aggregated.length === 0 ? (
          <li className="py-3 text-sm text-slate-400">{emptyHint}</li>
        ) : null}
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 py-2">
            {renamingId === item.id ? (
              <>
                <input
                  type="text"
                  value={renameValue}
                  maxLength={64}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!pending) saveRename();
                    }
                  }}
                  className={inputCls + " w-full"}
                />
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={saveRename}
                    disabled={pending}
                    className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenamingId(null)}
                    disabled={pending}
                    className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {item.name}
                  </span>
                  {item.slug ? (
                    <span className="ml-2 text-xs text-slate-400">{item.slug}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startRename(item)}
                    disabled={pending}
                    className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    disabled={pending}
                    className="rounded border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/40"
                  >
                    删除
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
        {aggregated.map((item) => (
          <li
            key={`agg-${item.name}`}
            className="flex items-center justify-between gap-2 py-2"
          >
            <div className="min-w-0">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {item.name}
              </span>
              <span className="ml-2 text-xs text-slate-400">（文章引用但未入库，保存文章同步后自动建项）</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
