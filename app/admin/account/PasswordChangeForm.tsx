"use client";

/**
 * /admin/account — 管理员自助账号设置：修改密码 + 修改登录用户名。
 * 两个表单都以「当前密码」自证身份（/api/admin/password 与 /api/admin/username）。
 * 成功后当前会话保持（会话与用户列解耦）。
 */
import { useState, useTransition } from "react";
import { fetchWithCsrf } from "@/lib/fetchWithCsrf";

const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (newPassword.length < 8) {
      setError("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetchWithCsrf("/api/admin/password", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error || "修改失败");
          return;
        }
        setMessage("密码已修改，立即生效（当前登录保持）。");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } catch {
        setError("网络异常，请重试");
      }
    });
  }

  const type = show ? "text" : "password";

  return (
    <form onSubmit={submit} className="ba-card space-y-5 p-6">
      <div className="flex items-center gap-2.5">
        <span className="ba-tri h-4 w-5" aria-hidden />
        <h2 className="ba-font-round text-lg text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
          修改管理员密码
        </h2>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">当前密码</span>
        <input
          type={type}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">新密码（至少 8 位）</span>
        <input
          type={type}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={100}
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">确认新密码</span>
        <input
          type={type}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={100}
          className={inputCls}
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
        />
        显示密码明文
      </label>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="ba-button-primary px-5 py-2 text-sm disabled:opacity-60"
        >
          {pending ? "提交中…" : "确认修改"}
        </button>
        {message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{message}</span>}
        {error && <span className="text-sm text-rose-600 dark:text-rose-400">{error}</span>}
      </div>
    </form>
  );
}

export function UsernameChangeForm({ currentUsername }: { currentUsername: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await fetchWithCsrf("/api/admin/username", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, newUsername }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          username?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error || "修改失败");
          return;
        }
        setMessage(`用户名已改为 ${data.username}，下次登录请使用新用户名（当前登录保持）。`);
        setCurrentPassword("");
        setNewUsername("");
      } catch {
        setError("网络异常，请重试");
      }
    });
  }

  return (
    <form onSubmit={submit} className="ba-card space-y-5 p-6">
      <div className="flex items-center gap-2.5">
        <span className="ba-tri h-4 w-5 rotate-180" aria-hidden />
        <h2 className="ba-font-round text-lg text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
          修改登录用户名
        </h2>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-sm:text-sm">
        当前用户名：<code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{currentUsername}</code>
        。修改后下次登录使用新用户名，当前会话不受影响。
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">新用户名（3-30 位，小写字母/数字/中划线）</span>
        <input
          type="text"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          autoComplete="username"
          required
          minLength={3}
          maxLength={30}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="如 shuizhu-binggao"
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">当前密码（验证身份）</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
          className={inputCls}
        />
      </label>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="ba-button-primary px-5 py-2 text-sm disabled:opacity-60"
        >
          {pending ? "提交中…" : "确认修改"}
        </button>
        {message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{message}</span>}
        {error && <span className="text-sm text-rose-600 dark:text-rose-400">{error}</span>}
      </div>
    </form>
  );
}
