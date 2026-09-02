"use client";

/**
 * LLM 审核提供商配置面板（/admin/llm-settings）：
 * - 多预设：保存多条 OpenAI 兼容站点，顺序即自动路由顺序
 * - 自动路由：前排失败（超时/网络/HTTP/非法输出）自动尝试下一个
 * - 每条：ID/名称、Base URL、API Key（密码框可显隐）、模型（自动获取+搜索选择）、超时秒、启停
 * - 每条可单独[测试连通]；[保存]全量写回
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithCsrf } from "@/lib/fetchWithCsrf";

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutSec: number;
  enabled: boolean;
}

const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

function newProvider(): Provider {
  return {
    id: `p${Date.now()}${Math.floor(Math.random() * 1000)}`,
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
    timeoutSec: 15,
    enabled: true,
  };
}

export function LlmSettingsForm({ initial }: { initial: Provider[] }) {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>(initial);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [modelFilter, setModelFilter] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef(false);

  // 保存成功后提示随路由刷新保留一次
  useEffect(() => {
    if (savedRef.current) {
      savedRef.current = false;
    }
  }, []);

  function patch(id: string, p: Partial<Provider>) {
    setProviders((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  function move(id: string, dir: -1 | 1) {
    setProviders((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  async function fetchModels(id: string) {
    const p = providers.find((x) => x.id === id);
    if (!p?.baseUrl || !p.apiKey) {
      setError(`「${p?.name || id}」需要先填写 Base URL 与 API Key`);
      return;
    }
    setBusy(`models:${id}`);
    setError(null);
    try {
      const res = await fetchWithCsrf("/api/admin/llm-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "models", baseUrl: p.baseUrl, apiKey: p.apiKey }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        models?: string[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error || `拉取失败（HTTP ${res.status}）`);
        return;
      }
      setModels((prev) => ({ ...prev, [id]: data.models ?? [] }));
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(null);
    }
  }

  async function testProvider(id: string) {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    setBusy(`test:${id}`);
    setError(null);
    try {
      const res = await fetchWithCsrf("/api/admin/llm-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          provider: {
            baseUrl: p.baseUrl,
            apiKey: p.apiKey,
            model: p.model,
            timeoutSec: p.timeoutSec,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
      };
      setProviders((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                ...(data.ok
                  ? { lastTest: undefined as never }
                  : {}),
              }
            : x
        )
      );
      if (data.ok) {
        setMessage(
          `「${p.name || id}」连通正常（${((data.latencyMs ?? 0) / 1000).toFixed(1)}s）`
        );
      } else {
        setError(`「${p.name || id}」测试失败：${data.error ?? "未知错误"}`);
      }
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    setMessage(null);
    for (const p of providers) {
      if (!p.name.trim() || !p.baseUrl.trim() || !p.apiKey.trim() || !p.model.trim()) {
        setError("每个提供商的 名称 / Base URL / API Key / 模型 都不能为空（或先删除该卡片）。");
        return;
      }
    }
    setBusy("save");
    try {
      const res = await fetchWithCsrf("/api/admin/llm-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || "保存失败");
        return;
      }
      setMessage("已保存。评论审核将按此顺序自动路由。");
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--color-surface))] p-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300 max-sm:text-sm">
        <p>
          在此维护<strong> OpenAI 兼容</strong>的审核站点列表（Base URL 填到根路径，例如
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">https://api.example.com/v1</code>
          ）。评论审核按<strong>从上到下</strong>的顺序调用：前面的站点超时或出错，自动路由到下一个；全部失败才按
          「LLM 失败时信任正则结果」的设置回退。未配置任何提供商时沿用环境变量单站点配置。
        </p>
      </div>

      {providers.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          尚未配置任何 LLM 提供商。点击下方「添加提供商」开始。
        </div>
      )}

      <div className="space-y-4">
        {providers.map((p, idx) => {
          const list = (models[p.id] ?? []).filter((m) =>
            m.toLowerCase().includes((modelFilter[p.id] ?? "").toLowerCase())
          );
          return (
            <div
              key={p.id}
              className="rounded-xl border border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--color-surface))] p-5"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="ba-tri h-3.5 w-4" aria-hidden />
                  <span className="ba-font-round text-base text-slate-800 dark:text-slate-100">
                    {idx + 1}. {p.name || "未命名站点"}
                  </span>
                  {p.enabled ? (
                    <span className="ba-pill ba-pill--soft">启用中</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      已停用
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => move(p.id, -1)} disabled={idx === 0}
                    className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800" aria-label="上移">↑</button>
                  <button type="button" onClick={() => move(p.id, 1)} disabled={idx === providers.length - 1}
                    className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800" aria-label="下移">↓</button>
                  <button type="button" onClick={() => testProvider(p.id)} disabled={busy !== null}
                    className="ba-btn px-3 py-1 text-xs disabled:opacity-50">
                    {busy === `test:${p.id}` ? "测试中…" : "测试连通"}
                  </button>
                  <button type="button"
                    onClick={() => setProviders((prev) => prev.filter((x) => x.id !== p.id))}
                    className="rounded-full border border-rose-300 px-3 py-1 text-xs text-rose-500 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/40">
                    删除
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">站点 ID（备用标识）</span>
                  <input type="text" value={p.id} maxLength={50} onChange={(e) => patch(p.id, { id: e.target.value })} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">站点名称</span>
                  <input type="text" value={p.name} maxLength={50} placeholder="如：主站 / 备用站A"
                    onChange={(e) => patch(p.id, { name: e.target.value })} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="font-medium text-slate-700 dark:text-slate-200">Base URL（OpenAI 兼容根路径）</span>
                  <input type="text" value={p.baseUrl} maxLength={300} placeholder="https://api.example.com/v1"
                    onChange={(e) => patch(p.id, { baseUrl: e.target.value })} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">API Key</span>
                  <div className="flex gap-1.5">
                    <input
                      type={showKey[p.id] ? "text" : "password"}
                      value={p.apiKey}
                      maxLength={300}
                      autoComplete="off"
                      onChange={(e) => patch(p.id, { apiKey: e.target.value })}
                      className={inputCls}
                    />
                    <button type="button"
                      onClick={() => setShowKey((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                      className="ba-btn shrink-0 px-3 py-1 text-xs">
                      {showKey[p.id] ? "隐藏" : "显示"}
                    </button>
                  </div>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">超时时间（秒，超过即路由下一家）</span>
                  <input type="number" min={1} value={p.timeoutSec}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      patch(p.id, { timeoutSec: Number.isFinite(n) && n > 0 ? n : 15 });
                    }}
                    className={inputCls} />
                </label>
                <div className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="font-medium text-slate-700 dark:text-slate-200">模型</span>
                  <div className="flex gap-1.5">
                    <input type="text" value={p.model} maxLength={200} placeholder="如 gpt-4o-mini"
                      onChange={(e) => patch(p.id, { model: e.target.value })} className={inputCls} />
                    <button type="button" onClick={() => fetchModels(p.id)} disabled={busy !== null}
                      className="ba-btn shrink-0 px-3 py-1 text-xs disabled:opacity-50">
                      {busy === `models:${p.id}` ? "获取中…" : "获取模型列表"}
                    </button>
                  </div>
                  {models[p.id] && (
                    <div className="mt-1 rounded-lg border border-[color:rgb(var(--ba-line))] p-2">
                      <input
                        type="text"
                        value={modelFilter[p.id] ?? ""}
                        placeholder="搜索模型名…"
                        onChange={(e) => setModelFilter((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className={`${inputCls} mb-2`}
                      />
                      <div className="max-h-40 overflow-y-auto">
                        {list.length === 0 && (
                          <p className="px-1 py-2 text-xs text-slate-400">无匹配模型</p>
                        )}
                        {list.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => patch(p.id, { model: m })}
                            className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                              p.model === m
                                ? "bg-[color:rgb(var(--ba-primary-soft))] font-semibold text-[color:rgb(var(--ba-primary))]"
                                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => patch(p.id, { enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
                />
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  启用该站点（停用则路由时跳过）
                </span>
              </label>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setProviders((prev) => [...prev, newProvider()])}
          disabled={providers.length >= 10}
          className="ba-btn px-4 py-2 text-sm disabled:opacity-50"
        >
          + 添加提供商
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy === "save"}
          className="ba-button-primary px-5 py-2 text-sm disabled:opacity-60"
        >
          {busy === "save" ? "保存中…" : "保存配置"}
        </button>
        {message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{message}</span>}
        {error && <span className="text-sm text-rose-600 dark:text-rose-400">{error}</span>}
      </div>
    </div>
  );
}
