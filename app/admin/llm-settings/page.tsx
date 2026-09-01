/**
 * /admin/llm-settings — 评论审核 LLM 提供商配置页（仅管理员）。
 * 多预设 + 顺序自动路由 + 模型自动获取/搜索 + 单站连通测试。
 */
import { requireAdmin } from "@/lib/auth";
import { LogoutButton } from "../LogoutButton";
import { getLlmProviders } from "@/lib/llm-moderation";
import { LlmSettingsForm } from "./LlmSettingsForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "LLM 审核",
  robots: { index: false, follow: false },
};

export default async function LlmSettingsPage() {
  await requireAdmin();
  const providers = await getLlmProviders();

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:rgb(var(--ba-line))] pb-4">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <a href="/admin" className="hover:text-sky-600 dark:hover:text-sky-300">
              ← 后台首页
            </a>
            <span>/</span>
            <span>LLM 审核</span>
          </div>
          <h1 className="ba-font-round text-2xl text-slate-800 dark:text-slate-100">
            LLM 审核配置
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            多站点预设、顺序自动路由、模型自动获取与搜索、单站连通测试。
          </p>
        </div>
        <LogoutButton />
      </header>

      <LlmSettingsForm initial={providers} />
    </div>
  );
}
