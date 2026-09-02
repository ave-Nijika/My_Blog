/**
 * /admin/site-settings
 *
 * 站点设置页（修复审核报告 P1-5/P3：此前 API 存在但没有页面入口，
 * 且 DB 配置从未被读取；现在配置已接线，此页提供可视化入口）。
 */
import { requireAdmin } from "@/lib/auth";
import { LogoutButton } from "../LogoutButton";
import { SiteSettingsForm } from "./SiteSettingsForm";
import { db } from "@/lib/db";
import { getSiteProfile } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "站点设置",
  robots: { index: false, follow: false },
};

async function ensureSettings() {
  const existing = await db.siteSettings.findFirst();
  if (existing) return existing;
  return db.siteSettings.create({ data: {} });
}

export default async function SiteSettingsPage() {
  await requireAdmin();
  const settings = await ensureSettings();
  const profile = await getSiteProfile();

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <a href="/admin" className="hover:text-sky-600 dark:hover:text-sky-300">
              ← 后台首页
            </a>
            <span>/</span>
            <span>站点设置</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            站点设置
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            保存后立即生效（DB 优先，环境变量兜底）。
          </p>
        </div>
        <LogoutButton />
      </header>

      <SiteSettingsForm
        initial={{
          commentCooldownSeconds: settings.commentCooldownSeconds,
          commentMinLength: settings.commentMinLength,
          commentMaxLength: settings.commentMaxLength,
          commentBodyMaxBytes: settings.commentBodyMaxBytes,
          autoBanWarningThreshold: settings.autoBanWarningThreshold,
          allowRegexOnlyOnLlmFailure: settings.allowRegexOnlyOnLlmFailure,
          commentsVisibleToGuests: settings.commentsVisibleToGuests,
          aboutNotes: settings.aboutNotes,
          aboutContacts: settings.aboutContacts
            ? (JSON.parse(settings.aboutContacts) as never)
            : null,
          nickname: profile?.nickname ?? "",
        }}
      />
    </div>
  );
}
