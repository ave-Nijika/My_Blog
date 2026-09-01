/**
 * 后台首页：服务端组件，requireAdmin 守卫。
 * M2b 起提供真实导航：文章管理、评论审核、站点设置（占位）。
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { LogoutButton } from "./LogoutButton";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin Dashboard",
  robots: { index: false, follow: false },
};

const NAV_ITEMS = [
  { href: "/admin/posts", key: "posts" },
  { href: "/admin/comments", key: "comments" },
  { href: "/admin/regex-rules", key: "regexRules" },
  { href: "/admin/visitors", key: "visitors" },
  { href: "/admin/audit-logs", key: "auditLogs" },
  { href: "/admin/llm-settings", key: "llmSettings" },
  { href: "/admin/site-settings", key: "siteSettings" },
  { href: "/admin/account", key: "account" },
] as const;

export default async function AdminHome() {
  await requireAdmin();
  // 后台同样按 locale cookie 双语（此前硬编码英文，主人反馈"切中文也显示英文"）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const t = (locale === "en" ? en : zh).admin;

  const [postCount, draftCount, publicCount, privateCount] = await Promise.all([
    db.article.count(),
    db.article.count({ where: { status: "draft" } }),
    db.article.count({ where: { status: "public" } }),
    db.article.count({ where: { status: "private" } }),
  ]);

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-[color:rgb(var(--ba-line))] pb-5 sm:flex-row sm:items-center">
        <div className="relative">
          <span className="ba-tri absolute -left-5 top-2 h-3 w-3.5 opacity-90" aria-hidden />
          <h1 className="ba-font-round text-2xl text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
            {t.title}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            {t.subtitle}
          </p>
        </div>
        <LogoutButton />
      </header>

      <nav className="flex flex-wrap gap-2 text-sm">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="ba-btn px-4 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {t[item.key]}
          </Link>
        ))}
      </nav>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t.stats.totalPosts} value={postCount} href="/admin/posts" />
        <StatCard label={t.stats.published} value={publicCount} href="/admin/posts?status=public" />
        <StatCard label={t.stats.draft} value={draftCount} href="/admin/posts?status=draft" />
        <StatCard label={t.stats.private} value={privateCount} href="/admin/posts?status=private" />
      </section>

      <section className="rounded-lg border border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--color-surface))] p-4 text-sm text-slate-600 dark:text-slate-300 max-sm:text-sm">
        {t.sessionEstablished}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--color-surface))] p-4 transition-all duration-200 hover:-translate-y-1 hover:border-[rgb(var(--ba-primary))]/60 hover:shadow-[0_10px_24px_rgba(18,137,249,0.14)] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <div className="text-xs text-slate-500 dark:text-slate-400 max-sm:text-sm">{label}</div>
      <div className="ba-font-display mt-1.5 text-3xl text-[color:rgb(var(--ba-primary))]">
        {value}
      </div>
      <span
        className="mt-2 block h-2 w-3 bg-[rgb(var(--ba-yellow))] opacity-60 [clip-path:polygon(0_0,100%_50%,0_100%)] transition-transform duration-300 group-hover:translate-x-1"
        aria-hidden
      />
    </Link>
  );
}
