"use client";

/**
 * 站点设置表单：PUT /api/admin/site-settings（fetchWithCsrf 自动带 CSRF 头）。
 * 含两个分区：评论审核参数 + 关于页配置（站点说明 / 联系方式卡片 / 站长昵称）。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fetchWithCsrf } from "@/lib/fetchWithCsrf";

export type AboutContactCardInput = {
  id: string;
  label: string;
  value: string;
  href?: string;
  kind: "copy" | "link";
};

type Settings = {
  commentCooldownSeconds: number;
  commentMinLength: number;
  commentMaxLength: number;
  commentBodyMaxBytes: number;
  autoBanWarningThreshold: number;
  allowRegexOnlyOnLlmFailure: boolean;
  aboutNotes: string | null;
  aboutContacts: AboutContactCardInput[] | null;
  nickname: string;
};

const NUM_FIELDS: { key: keyof Pick<Settings, "commentCooldownSeconds" | "commentMinLength" | "commentMaxLength" | "commentBodyMaxBytes" | "autoBanWarningThreshold">; label: string; hint?: string }[] = [
  { key: "commentCooldownSeconds", label: "评论冷却（秒）", hint: "同一访客两次评论的最小间隔；0 = 关闭冷却" },
  { key: "commentMinLength", label: "评论最小长度（字符）" },
  { key: "commentMaxLength", label: "评论最大长度（字符）" },
  { key: "commentBodyMaxBytes", label: "评论最大字节数" },
  { key: "autoBanWarningThreshold", label: "自动封禁警告阈值", hint: "累计警告达到该值自动封禁" },
];

const inputCls =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

export function SiteSettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [values, setValues] = useState<Settings>(initial);
  const [contacts, setContacts] = useState<AboutContactCardInput[]>(
    initial.aboutContacts ?? []
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setNum(key: keyof Settings, raw: string) {
    const n = Number.parseInt(raw, 10);
    setValues((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : 0 }));
  }

  function updateContact(id: string, patch: Partial<AboutContactCardInput>) {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }

  function addContact() {
    setContacts((prev) => [
      ...prev,
      {
        id: `c${Date.now()}${Math.floor(Math.random() * 1000)}`,
        label: "",
        value: "",
        kind: "copy",
      },
    ]);
  }

  function moveContact(id: string, dir: -1 | 1) {
    setContacts((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  function save() {
    setError(null);
    setMessage(null);
    // 联系方式卡片基础校验（与 API zod 对应）
    for (const c of contacts) {
      if (!c.label.trim() || !c.value.trim()) {
        setError("联系方式卡片：名称与内容不能为空。");
        return;
      }
    }
    startTransition(async () => {
      try {
        const res = await fetchWithCsrf("/api/admin/site-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...values,
            aboutNotes: values.aboutNotes?.trim() ? values.aboutNotes : null,
            aboutContacts: contacts.map((c) => ({
              id: c.id,
              label: c.label.trim(),
              value: c.value.trim(),
              ...(c.kind === "link" && c.href?.trim()
                ? { href: c.href.trim() }
                : {}),
              kind: c.kind,
            })),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setError(data.error || "保存失败");
          return;
        }
        setMessage("已保存，立即生效。");
        router.refresh();
      } catch {
        setError("网络异常，请重试");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ====== 评论审核参数 ====== */}
      <section className="rounded-xl border border-slate-200 bg-white/70 p-6 dark:border-slate-800 dark:bg-slate-900/40">
        <h2 className="ba-font-round mb-4 text-lg text-slate-800 dark:text-slate-100">
          评论审核参数
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          {NUM_FIELDS.map(({ key, label, hint }) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
              <input
                type="number"
                min={0}
                value={String(values[key])}
                onChange={(e) => setNum(key, e.target.value)}
                className={inputCls}
              />
              {hint && <span className="text-xs text-slate-400">{hint}</span>}
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={values.allowRegexOnlyOnLlmFailure}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  allowRegexOnlyOnLlmFailure: e.target.checked,
                }))
              }
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
            />
            <span className="font-medium text-slate-700 dark:text-slate-200">
              LLM 审核失败时信任正则结果自动放行
            </span>
            <span className="text-xs text-slate-400">
              （默认关闭：LLM 失败一律转人工 pending；开启后仅当正则未标记可疑才放行）
            </span>
          </label>
        </div>
      </section>

      {/* ====== 关于页配置 ====== */}
      <section className="rounded-xl border border-slate-200 bg-white/70 p-6 dark:border-slate-800 dark:bg-slate-900/40">
        <h2 className="ba-font-round mb-4 text-lg text-slate-800 dark:text-slate-100">
          关于页配置
        </h2>

        <div className="space-y-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              站长昵称（关于页档案卡展示）
            </span>
            <input
              type="text"
              value={values.nickname}
              maxLength={30}
              onChange={(e) => setValues((prev) => ({ ...prev, nickname: e.target.value }))}
              className={inputCls}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              站点说明
            </span>
            <textarea
              value={values.aboutNotes ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, aboutNotes: e.target.value }))}
              rows={4}
              maxLength={5000}
              placeholder="留空则使用默认文案（每行一段，关于页按行分段展示）"
              className={inputCls}
            />
            <span className="text-xs text-slate-400">
              按空行/换行分段；留空使用默认三段文案。
            </span>
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                联系方式卡片
              </span>
              <button
                type="button"
                onClick={addContact}
                disabled={contacts.length >= 8}
                className="ba-btn px-3 py-1 text-xs disabled:opacity-50"
              >
                + 添加卡片
              </button>
            </div>
            <span className="text-xs text-slate-400">
              交互类型「点击复制」适合 QQ 邮箱等；「跳转链接」适合 B
              站等外部主页。留空则使用默认两张卡（B站 + QQ 邮箱）。
            </span>
            <div className="mt-2 space-y-3">
              {contacts.map((c, idx) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-400">
                      卡片 {idx + 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveContact(c.id, -1)}
                        disabled={idx === 0}
                        className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                        aria-label="上移"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveContact(c.id, 1)}
                        disabled={idx === contacts.length - 1}
                        className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                        aria-label="下移"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setContacts((prev) => prev.filter((x) => x.id !== c.id))
                        }
                        className="rounded px-2 py-0.5 text-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      value={c.label}
                      maxLength={30}
                      placeholder="名称（如：B站 / QQ 邮箱）"
                      onChange={(e) => updateContact(c.id, { label: e.target.value })}
                      className={inputCls}
                    />
                    <input
                      type="text"
                      value={c.value}
                      maxLength={200}
                      placeholder="内容（如：水煮冰糕 / 12345@qq.com）"
                      onChange={(e) => updateContact(c.id, { value: e.target.value })}
                      className={inputCls}
                    />
                    <select
                      value={c.kind}
                      onChange={(e) =>
                        updateContact(c.id, {
                          kind: e.target.value === "link" ? "link" : "copy",
                        })
                      }
                      className={inputCls}
                    >
                      <option value="copy">点击复制</option>
                      <option value="link">跳转链接</option>
                    </select>
                    <input
                      type="text"
                      value={c.href ?? ""}
                      maxLength={300}
                      placeholder="链接地址（仅跳转类型需要，如 https://space.bilibili.com/…）"
                      onChange={(e) => updateContact(c.id, { href: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="ba-button-primary px-4 py-2 text-sm disabled:opacity-60"
        >
          {pending ? "保存中…" : "保存设置"}
        </button>
        {message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{message}</span>}
        {error && <span className="text-sm text-rose-600 dark:text-rose-400">{error}</span>}
      </div>
    </div>
  );
}
