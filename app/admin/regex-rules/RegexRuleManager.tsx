"use client";

/**
 * /admin/regex-rules 客户端组件：
 *   - 新建规则表单
 *   - 编辑/删除按钮（行内）
 *   - 规则测试面板
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Item = {
  id: string;
  name: string;
  pattern: string;
  enabled: boolean;
  priority: number;
  action: "reject" | "replace" | "review";
  replacementText: string;
  warningIncrement: number;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  items: Item[];
};

type ApiError = { error?: string } | undefined;

type TestResult = {
  ok: boolean;
  action: "reject" | "replace" | "review" | "none";
  finalText: string;
  hits: Array<{
    ruleId: string;
    ruleName: string;
    action: "reject" | "replace" | "review";
    pattern: string;
    matches: string[];
  }>;
};

export function RegexRuleManager({ items }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 新建表单
  const [newName, setNewName] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newAction, setNewAction] = useState<"reject" | "replace" | "review">(
    "reject"
  );
  const [newReplacement, setNewReplacement] = useState("");
  const [newPriority, setNewPriority] = useState(0);
  const [newWarning, setNewWarning] = useState(1);
  const [newEnabled, setNewEnabled] = useState(true);

  // 编辑表单
  const [editName, setEditName] = useState("");
  const [editPattern, setEditPattern] = useState("");
  const [editAction, setEditAction] = useState<"reject" | "replace" | "review">(
    "reject"
  );
  const [editReplacement, setEditReplacement] = useState("");
  const [editPriority, setEditPriority] = useState(0);
  const [editWarning, setEditWarning] = useState(1);
  const [editEnabled, setEditEnabled] = useState(true);

  // 测试
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testPending, setTestPending] = useState(false);

  // CSRF token
  const [csrf, setCsrf] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/csrf", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          csrfToken?: string;
        };
        if (!cancelled && data.csrfToken) setCsrf(data.csrfToken);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function startEdit(r: Item) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditPattern(r.pattern);
    setEditAction(r.action);
    setEditReplacement(r.replacementText);
    setEditPriority(r.priority);
    setEditWarning(r.warningIncrement);
    setEditEnabled(r.enabled);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function callApi<T = unknown>(
    url: string,
    method: "POST" | "PUT" | "DELETE",
    body?: unknown
  ): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as
      | (T & { error?: string })
      | ApiError;
    if (!res.ok) {
      const msg =
        (data as { error?: string })?.error || `请求失败 (${res.status})`;
      throw new Error(msg);
    }
    return data as T;
  }

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!csrf) {
      setError("CSRF 尚未就绪，请稍候");
      return;
    }
    startTransition(async () => {
      try {
        await callApi("/api/admin/regex-rules", "POST", {
          name: newName,
          pattern: newPattern,
          action: newAction,
          replacementText: newReplacement,
          priority: Number(newPriority),
          warningIncrement: Number(newWarning),
          enabled: newEnabled,
        });
        setNewName("");
        setNewPattern("");
        setNewReplacement("");
        setNewAction("reject");
        setNewPriority(0);
        setNewWarning(1);
        setNewEnabled(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
      }
    });
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setError(null);
    if (!csrf) {
      setError("CSRF 尚未就绪，请稍候");
      return;
    }
    startTransition(async () => {
      try {
        await callApi(`/api/admin/regex-rules/${editingId}`, "PUT", {
          name: editName,
          pattern: editPattern,
          action: editAction,
          replacementText: editReplacement,
          priority: Number(editPriority),
          warningIncrement: Number(editWarning),
          enabled: editEnabled,
        });
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
      }
    });
  }

  function deleteRule(id: string) {
    if (!csrf) {
      setError("CSRF 尚未就绪，请稍候");
      return;
    }
    if (!window.confirm("确认删除这条规则？此操作不可撤销。")) return;
    setError(null);
    startTransition(async () => {
      try {
        await callApi(`/api/admin/regex-rules/${id}`, "DELETE");
        if (editingId === id) setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "删除失败");
      }
    });
  }

  function runTest(e: React.FormEvent) {
    e.preventDefault();
    if (!csrf) {
      setError("CSRF 尚未就绪，请稍候");
      return;
    }
    setError(null);
    setTestPending(true);
    setTestResult(null);
    (async () => {
      try {
        const data = await callApi<TestResult>(
          "/api/admin/regex-rules/test",
          "POST",
          { text: testText }
        );
        setTestResult(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "测试失败");
      } finally {
        setTestPending(false);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <section className="ba-card p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
          新建规则
        </h2>
        <form
          onSubmit={submitNew}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Field label="名称">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              className="input"
            />
          </Field>
          <Field label="正则">
            <input
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              required
              className="input font-mono"
              placeholder="例：(?i)badword"
            />
          </Field>
          <Field label="动作">
            <select
              value={newAction}
              onChange={(e) =>
                setNewAction(e.target.value as typeof newAction)
              }
              className="input"
            >
              <option value="reject">reject（拒绝）</option>
              <option value="replace">replace（替换）</option>
              <option value="review">review（人工审核）</option>
            </select>
          </Field>
          <Field label="替换为（仅 replace）">
            <input
              value={newReplacement}
              onChange={(e) => setNewReplacement(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="优先级（数字大优先）">
            <input
              type="number"
              value={newPriority}
              onChange={(e) => setNewPriority(Number(e.target.value))}
              className="input"
            />
          </Field>
          <Field label="警告增量（reject 时累加）">
            <input
              type="number"
              min={0}
              max={10}
              value={newWarning}
              onChange={(e) => setNewWarning(Number(e.target.value))}
              className="input"
            />
          </Field>
          <Field label="启用">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newEnabled}
                onChange={(e) => setNewEnabled(e.target.checked)}
              />
              启用
            </label>
          </Field>
          <div className="flex items-end justify-end sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="ba-button-primary px-4 py-2 text-sm disabled:opacity-60"
            >
              {pending ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </section>

      {editingId ? (
        <section className="ba-card p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
            编辑规则 #{editingId.slice(0, 8)}
          </h2>
          <form
            onSubmit={submitEdit}
            className="grid gap-3 sm:grid-cols-2"
          >
            <Field label="名称">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                className="input"
              />
            </Field>
            <Field label="正则">
              <input
                value={editPattern}
                onChange={(e) => setEditPattern(e.target.value)}
                required
                className="input font-mono"
              />
            </Field>
            <Field label="动作">
              <select
                value={editAction}
                onChange={(e) =>
                  setEditAction(e.target.value as typeof editAction)
                }
                className="input"
              >
                <option value="reject">reject</option>
                <option value="replace">replace</option>
                <option value="review">review</option>
              </select>
            </Field>
            <Field label="替换为">
              <input
                value={editReplacement}
                onChange={(e) => setEditReplacement(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="优先级">
              <input
                type="number"
                value={editPriority}
                onChange={(e) => setEditPriority(Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="警告增量">
              <input
                type="number"
                min={0}
                max={10}
                value={editWarning}
                onChange={(e) => setEditWarning(Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="启用">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editEnabled}
                  onChange={(e) => setEditEnabled(e.target.checked)}
                />
                启用
              </label>
            </Field>
            <div className="flex items-end justify-end gap-2 sm:col-span-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={pending}
                className="ba-button-primary px-4 py-2 text-sm disabled:opacity-60"
              >
                {pending ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="ba-card p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
          现有规则（行内操作）
        </h2>
        <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {r.name}
                </span>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                  {r.pattern}
                </code>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {r.action} · 优先级 {r.priority} · 警告 +{r.warningIncrement} ·{" "}
                  {r.enabled ? "开启" : "关闭"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startEdit(r)}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700"
                >
                  编辑
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => deleteRule(r.id)}
                  className="rounded-md border border-rose-300 px-2.5 py-1 text-xs text-rose-700 dark:border-rose-800 dark:text-rose-300"
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="ba-card p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
          规则测试
        </h2>
        <form onSubmit={runTest} className="flex flex-col gap-3">
          <textarea
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            rows={4}
            className="input font-mono"
            placeholder="输入要测试的评论文本…"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={testPending}
              className="ba-button-primary px-4 py-2 text-sm disabled:opacity-60"
            >
              {testPending ? "测试中…" : "运行测试"}
            </button>
          </div>
        </form>
        {testResult ? (
          <div className="mt-3 flex flex-col gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-900/60">
            <div>
              <span className="text-slate-500 dark:text-slate-400">动作：</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">{testResult.action}</span>
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400">处理后文本：</div>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {testResult.finalText}
              </pre>
            </div>
            {testResult.hits.length > 0 ? (
              <div>
                <div className="text-slate-500 dark:text-slate-400">命中：</div>
                <ul className="mt-1 flex flex-col gap-1 text-xs">
                  {testResult.hits.map((h, i) => (
                    <li
                      key={i}
                      className="rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="text-slate-700 dark:text-slate-200">
                        <strong className="text-slate-800 dark:text-slate-100">{h.ruleName}</strong> · {h.action} ·{" "}
                        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
                          {h.pattern}
                        </code>
                      </div>
                      {h.matches.length > 0 ? (
                        <div className="mt-1 text-slate-500 dark:text-slate-400">
                          匹配：{h.matches.slice(0, 5).map((m) => `"${m}"`).join("、")}
                          {h.matches.length > 5 ? " …" : ""}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400">无规则命中。</div>
            )}
          </div>
        ) : null}
      </section>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid rgb(203 213 225);
          background: white;
          padding: 0.4rem 0.6rem;
          font-size: 0.875rem;
          color: rgb(15 23 42);
        }
        :global(.input:focus) {
          outline: 2px solid rgb(56 189 248);
          outline-offset: 0;
        }
        :global(.dark .input) {
          background: rgb(15 23 42);
          border-color: rgb(51 65 85);
          color: rgb(226 232 240);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
      <span>{label}</span>
      {children}
    </label>
  );
}
