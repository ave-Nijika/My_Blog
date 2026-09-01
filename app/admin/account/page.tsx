/**
 * /admin/account — 管理员自助账号设置（仅管理员）。
 * 修改密码 + 修改登录用户名；表单卡片在页面内水平居中（主人反馈左对齐不适）。
 */
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { LogoutButton } from "../LogoutButton";
import {
  PasswordChangeForm,
  UsernameChangeForm,
} from "./PasswordChangeForm";
import { db } from "@/lib/db";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "账号设置",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  await requireAdmin();
  // 后台双语（locale cookie SSR）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const a = (locale === "en" ? en : zh).admin;
  // 单管理员站点：取唯一 active 账号展示当前用户名
  const admin = await db.adminUser.findFirst({ where: { active: true } });

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:rgb(var(--ba-line))] pb-4">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <a href="/admin" className="hover:text-sky-600 dark:hover:text-sky-300">
              ← {a.siteSettings ? "后台首页" : "Dashboard"}
            </a>
            <span>/</span>
            <span>账号设置</span>
          </div>
          <h1 className="ba-font-round text-2xl text-slate-800 dark:text-slate-100">
            账号设置
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            修改后立即生效，当前登录保持；请牢记新的用户名与密码。
          </p>
        </div>
        <LogoutButton />
      </header>

      <div className="mx-auto w-full max-w-xl space-y-6">
        <UsernameChangeForm currentUsername={admin?.username ?? "admin"} />
        <PasswordChangeForm />
      </div>
    </div>
  );
}
