"use client";

/**
 * /admin/visitors 客户端组件：
 *   - 行内警告按钮
 *   - 行内封禁按钮
 *   - 解封按钮（仅当前有 activeBan 时显示）
 */
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";

type BanJson = {
  id: string;
  matchType: "ip" | "visitor";
  expiresAt: string | null;
  permanent: boolean;
  reason: string;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
};

type Item = {
  id: string;
  ipHmac: string;
  visitorTokenHash: string;
  warningCount: number;
  cooldownUntil: string | null;
  lastAttemptAt: string | null;
  lastSeenAt: string | null;
  updatedAt: string;
  activeBan: BanJson | null;
};

type Props = {
  items: Item[];
  page: number;
  perPage: number;
  total: number;
};

function pageHref(page: number, perPage: number) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (perPage !== 20) params.set("perPage", String(perPage));
  const q = params.toString();
  return q ? `/admin/visitors?${q}` : "/admin/visitors";
}

export function VisitorManager({ items, page, perPage, total }: Props) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const v = t("admin").visitorsSection;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [csrf, setCsrf] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

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

  async function callApi<T>(
    url: string,
    method: "POST",
    body: unknown
  ): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as
      | (T & { error?: string });
    if (!res.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }
    return data as T;
  }

  function warn(item: Item) {
    if (!csrf) {
      setError("CSRF not ready");
      return;
    }
    const deltaStr = window.prompt(
      `Add how many warnings? (1-10, current ${item.warningCount})`,
      "1"
    );
    if (!deltaStr) return;
    const delta = Math.max(1, Math.min(10, Number.parseInt(deltaStr, 10) || 1));
    const reason = window.prompt("Reason (optional)", "Admin manual warning") || "";
    setError(null);
    setBusy(`warn-${item.id}`);
    startTransition(async () => {
      try {
        await callApi("/api/admin/visitors/warn", "POST", {
          ipHmac: item.ipHmac,
          visitorTokenHash: item.visitorTokenHash,
          delta,
          reason,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Operation failed");
      } finally {
        setBusy(null);
      }
    });
  }

  function ban(item: Item) {
    if (!csrf) {
      setError("CSRF not ready");
      return;
    }
    const reason = window.prompt("Ban reason", "Admin manual ban");
    if (!reason) return;
    const matchType = window.confirm(
      "Match IP (OK); match visitorToken (Cancel)"
    )
      ? "ip"
      : "visitor";
    const permanent = window.confirm(
      "Permanent ban (OK); time-limited ban (Cancel)"
    );
    setError(null);
    setBusy(`ban-${item.id}`);
    startTransition(async () => {
      try {
        await callApi("/api/admin/visitors/ban", "POST", {
          ipHmac: item.ipHmac,
          visitorTokenHash: item.visitorTokenHash,
          matchType,
          reason,
          permanent,
          durationSeconds: 24 * 60 * 60,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Operation failed");
      } finally {
        setBusy(null);
      }
    });
  }

  function unban(banId: string) {
    if (!csrf) {
      setError("CSRF not ready");
      return;
    }
    if (!window.confirm("Confirm to unban?")) return;
    setError(null);
    setBusy(`unban-${banId}`);
    startTransition(async () => {
      try {
        await callApi("/api/admin/visitors/unban", "POST", { banId });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Operation failed");
      } finally {
        setBusy(null);
      }
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <section className="overflow-x-auto ba-card">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">{v.tableIpHmac}</th>
              <th className="px-4 py-3">{v.tableToken}</th>
              <th className="px-4 py-3">{v.tableWarnings}</th>
              <th className="px-4 py-3">{v.tableRecent}</th>
              <th className="px-4 py-3">{v.tableCurrentBan}</th>
              <th className="px-4 py-3 text-right">{v.table.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                >
                  No visitor risk records yet.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.id}
                  className="align-top text-slate-700 dark:text-slate-200"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                      {item.ipHmac.slice(0, 12)}…
                    </code>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {item.visitorTokenHash ? (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                        {item.visitorTokenHash.slice(0, 12)}…
                      </code>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{item.warningCount}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    {item.lastAttemptAt
                      ? new Date(item.lastAttemptAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {item.activeBan ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="rounded bg-rose-100 px-2 py-0.5 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                          {item.activeBan.permanent
                            ? "Permanent"
                            : item.activeBan.expiresAt
                              ? `Until ${new Date(item.activeBan.expiresAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US")}`
                              : "No expiry"}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {item.activeBan.matchType} · {item.activeBan.reason}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">{v.notBanned}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => warn(item)}
                        className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-700 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        {busy === `warn-${item.id}` ? v.warnSuccess + "…" : v.warn}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => ban(item)}
                        className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs text-rose-700 disabled:opacity-60 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                      >
                        {busy === `ban-${item.id}` ? v.banSuccess + "…" : v.ban}
                      </button>
                      {item.activeBan ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => unban(item.activeBan!.id)}
                          className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        >
                          {busy === `unban-${item.activeBan.id}`
                            ? v.unbanSuccess + "…"
                            : v.unban}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <div>
            Page {page} / {totalPages} ({total} items)
          </div>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={pageHref(page - 1, perPage)}
                className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:text-slate-300"
              >
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={pageHref(page + 1, perPage)}
                className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:text-slate-300"
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}