"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";

type Props = {
  loginPath: string;
};

export function LoginForm({ loginPath }: Props) {
  const router = useRouter();
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [csrfToken, setCsrfToken] = useState<string>("");

  // Visit /api/csrf once on mount to plant CSRF cookie + cache the token
  useEffect(() => {
    let cancelled = false;
    fetch("/api/csrf")
      .then((r) => r.json())
      .then((data: { csrfToken?: string }) => {
        if (!cancelled && data.csrfToken) setCsrfToken(data.csrfToken);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "");
    const password = String(form.get("password") ?? "");

    if (!csrfToken) {
      setError(t("login").loginFailed);
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({ username, password }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          redirect?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error || t("login").loginFailed);
          return;
        }
        router.replace(data.redirect || "/admin");
        router.refresh();
      } catch {
        setError(t("common").networkError);
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      data-login-path={loginPath}
    >
      <div>
        <label
          htmlFor="username"
          className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          {t("login").username}
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          disabled={pending}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          {t("login").password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-700 disabled:opacity-60"
      >
        {pending ? t("login").loggingIn : t("login").loginButton}
      </button>
    </form>
  );
}
