/**
 * /admin/audit-logs
 *
 * 后台审计日志列表：时间/操作人/动作/目标类型/目标ID/元数据。
 * 按 createdAt 倒序，简单分页；可按 targetType 筛选。
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { LogoutButton } from "../LogoutButton";
import { listAuditLogs, type AuditLogListItem } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Audit Logs",
  robots: { index: false, follow: false },
};

const TARGET_TYPES = [
  { value: "", key: "all" },
  { value: "auth", key: "auth" },
  { value: "post", key: "post" },
  { value: "comment", key: "comment" },
  { value: "visitor", key: "visitor" },
  { value: "regex_rule", key: "regex_rule" },
  { value: "site_settings", key: "site_settings" },
  { value: "session", key: "session" },
  { value: "llm", key: "llm" },
] as const;

const ACTION_COLORS: Record<string, string> = {
  "auth.login.success": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "auth.login.fail": "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "auth.logout": "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  "post.create": "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  "post.update": "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  "post.delete": "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "post.publish": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "post.private": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "comment.approve": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "comment.reject": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "comment.delete": "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "visitor.warn": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "visitor.ban": "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "visitor.unban": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "regex_rule.create": "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  "regex_rule.update": "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  "regex_rule.delete": "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "site_settings.update": "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  "llm.error": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "llm.disabled": "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function formatMeta(meta: string): string {
  if (!meta || meta === "{}") return "—";
  try {
    const obj = JSON.parse(meta);
    return JSON.stringify(obj);
  } catch {
    return meta;
  }
}

function pageHref(
  targetType: string,
  page: number,
  perPage: number
): string {
  const params = new URLSearchParams();
  if (targetType) params.set("targetType", targetType);
  if (page > 1) params.set("page", String(page));
  if (perPage !== 20) params.set("perPage", String(perPage));
  const q = params.toString();
  return q ? `/admin/audit-logs?${q}` : "/admin/audit-logs";
}

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    targetType?: string;
    page?: string;
    perPage?: string;
  }>;
}) {
  await requireAdmin();
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const a = (locale === "en" ? en : zh).admin;
  const t = a.auditLogsSection;
  const { targetType: rawType, page: rawPage, perPage: rawPerPage } =
    await searchParams;
  const targetType =
    TARGET_TYPES.find((t) => t.value === (rawType ?? ""))?.value ?? "";
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, Number.parseInt(rawPerPage ?? "20", 10) || 20)
  );

  const result = await listAuditLogs({
    page,
    perPage,
    targetType: targetType || undefined,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / perPage));

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Link href="/admin" className="hover:text-sky-600 dark:hover:text-sky-300">
              ← {t.backToDashboard}
            </Link>
            <span>/</span>
            <span>{t.title}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            {t.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t.total.replace("{{total}}", String(result.total))} · {t.filter}:{" "}
            {t.types[TARGET_TYPES.find((x) => x.value === targetType)?.key ?? "all" as keyof typeof t.types]} (
            {result.items.length})
          </p>
        </div>
        <LogoutButton />
      </header>

      <nav className="flex flex-wrap gap-2 text-sm">
        {TARGET_TYPES.map((tt) => {
          const active = tt.value === targetType;
          return (
            <Link
              key={tt.value || "all"}
              href={
                tt.value
                  ? `/admin/audit-logs?targetType=${tt.value}`
                  : "/admin/audit-logs"
              }
              className={
                "rounded-md border px-3 py-1.5 transition-colors " +
                (active
                  ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-200"
                  : "border-slate-200 text-slate-600 hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-sky-700 dark:hover:text-sky-300")
              }
            >
              {t.types[tt.key as keyof typeof t.types]}
            </Link>
          );
        })}
      </nav>

      <section className="overflow-x-auto ba-card">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">{t.table.time}</th>
              <th className="px-4 py-3">{t.table.admin}</th>
              <th className="px-4 py-3">{t.table.action}</th>
              <th className="px-4 py-3">{t.table.targetType}</th>
              <th className="px-4 py-3">{t.table.targetId}</th>
              <th className="px-4 py-3">{t.table.details}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {result.items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                >
                  No audit logs yet.
                </td>
              </tr>
            ) : (
              result.items.map((log: AuditLogListItem) => (
                <tr
                  key={log.id}
                  className="align-top text-slate-700 dark:text-slate-200"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(log.createdAt).toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono">
                    {log.adminId ? (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                        {log.adminId.length > 14
                          ? `${log.adminId.slice(0, 14)}…`
                          : log.adminId}
                      </code>
                    ) : (
                      <span className="text-slate-400">anonymous</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span
                      className={
                        "inline-flex rounded px-2 py-0.5 " +
                        (ACTION_COLORS[log.action] ??
                          "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400")
                      }
                    >
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    {log.targetType || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                    {log.targetId ? (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                        {log.targetId.length > 18
                          ? `${log.targetId.slice(0, 18)}…`
                          : log.targetId}
                      </code>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    <div className="max-w-md whitespace-pre-wrap break-words">
                      {formatMeta(log.metadata)}
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
            Page {page} / {totalPages}
          </div>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={pageHref(targetType, page - 1, perPage)}
                className="rounded-md border border-slate-300 px-3 py-1 transition-colors hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:hover:border-sky-700 dark:hover:text-sky-300"
              >
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={pageHref(targetType, page + 1, perPage)}
                className="rounded-md border border-slate-300 px-3 py-1 transition-colors hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:hover:border-sky-700 dark:hover:text-sky-300"
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