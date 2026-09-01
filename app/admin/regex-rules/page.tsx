/**
 * /admin/regex-rules
 *
 * 后台正则规则管理：列表 + 新建/编辑/删除 + 测试。
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { LogoutButton } from "../LogoutButton";
import { db } from "@/lib/db";
import { RegexRuleManager } from "./RegexRuleManager";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Regex Rules",
  robots: { index: false, follow: false },
};



const ACTION_BADGE: Record<string, string> = {
  reject: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  replace: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  review: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

export default async function AdminRegexRulesPage() {
  await requireAdmin();
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const a = (locale === "en" ? en : zh).admin;
  const t = a.regexRulesSection;
  const ACTION_LABEL: Record<string, string> = {
    reject: t.action.reject,
    replace: t.action.replace,
    review: t.action.review,
  };
  const rows = await db.regexRule.findMany({
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    pattern: r.pattern,
    enabled: r.enabled,
    priority: r.priority,
    action: r.action as "reject" | "replace" | "review",
    replacementText: r.replacementText,
    warningIncrement: r.warningIncrement,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

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
            {t.hint.replace("{{count}}", String(items.length))}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section className="overflow-x-auto ba-card">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">{t.table.name}</th>
              <th className="px-4 py-3">{t.table.pattern}</th>
              <th className="px-4 py-3">{t.table.action}</th>
              <th className="px-4 py-3">{t.table.replaceWith}</th>
              <th className="px-4 py-3">{t.table.warn}</th>
              <th className="px-4 py-3">{t.table.priority}</th>
              <th className="px-4 py-3">{t.table.enabled}</th>
              <th className="px-4 py-3 text-right">{t.table.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                >
                  {t.noRules}
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="align-top text-slate-700 dark:text-slate-200">
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                      {r.pattern}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex rounded px-2 py-0.5 text-xs " +
                        (ACTION_BADGE[r.action] ?? "bg-slate-200 text-slate-500")
                      }
                    >
                      {ACTION_LABEL[r.action] ?? r.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    {r.replacementText ? (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                        {r.replacementText}
                      </code>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{r.warningIncrement}</td>
                  <td className="px-4 py-3 text-xs">{r.priority}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.enabled ? (
                      <span className="text-emerald-600 dark:text-emerald-300">{t.enabledOn}</span>
                    ) : (
                      <span className="text-slate-400">{t.enabledOff}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-slate-400" data-rule-id={r.id}>
                      {/* Edit button injected by client component */}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <RegexRuleManager items={items} />
    </div>
  );
}