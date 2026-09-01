/**
 * 隐藏的内部登录页：被 next.config.ts 中的 rewrite 映射到 ADMIN_LOGIN_PATH。
 * 真实 URL 是 /login，不应被任何导航、首页、sitemap 或 robots 引用。
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LoginForm } from "./LoginForm";
import { getAdminLoginPath, getSession } from "@/lib/auth";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin Login",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/admin");
  }
  // 标题区 i18n（修复审核报告 P2-7 中英混排）：SSR 读 locale cookie
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const t = locale === "en" ? en : zh;
  return (
    <div className="mx-auto flex min-h-[80vh] max-w-sm flex-col justify-center px-4 py-12">
      <div className="ba-card relative overflow-hidden p-7">
        {/* 官网档案卡角标 */}
        <span className="ba-tri absolute right-4 top-4 h-3.5 w-4 opacity-80" aria-hidden />
        <div className="mb-5 flex items-center gap-2.5">
          <span className="ba-tri h-4 w-5" aria-hidden />
          <h1 className="ba-font-round text-xl text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
            {t.login.title}
          </h1>
        </div>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400 max-sm:text-sm">
          {t.login.description}
        </p>
        <LoginForm loginPath={getAdminLoginPath()} />
      </div>
    </div>
  );
}
