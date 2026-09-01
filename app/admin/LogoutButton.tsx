"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { fetchWithCsrf } from "@/lib/fetchWithCsrf";

export function LogoutButton() {
  const router = useRouter();
  const { t } = useLocale();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetchWithCsrf("/api/admin/logout", { method: "POST" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(data.error || "Logout failed");
          return;
        }
        router.replace("/");
        router.refresh();
      } catch {
        setError(t("common").networkError);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>}
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
      >
        {pending ? t("admin").loggingOut : t("admin").logout}
      </button>
    </div>
  );
}
