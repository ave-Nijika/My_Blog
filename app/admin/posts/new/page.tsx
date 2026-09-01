/**
 * /admin/posts/new
 *
 * 新建文章表单。服务端组件只做 requireAdmin 守卫与生成初始 slug 建议，
 * 实际编辑在 PostEditor 客户端组件里完成。
 */
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { LogoutButton } from "../../LogoutButton";
import { PostEditor, type PostFormValues } from "../PostEditor";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "新建文章",
  robots: { index: false, follow: false },
};

function suggestSlug(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `post-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export default async function NewPostPage() {
  await requireAdmin();

  const initial: PostFormValues = {
    title: "",
    slug: suggestSlug(),
    summary: "",
    status: "draft",
    category: "",
    tagsInput: "",
    pinned: false,
    publishedAt: "",
    body: "",
  };

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Link
              href="/admin"
              className="hover:text-sky-600 dark:hover:text-sky-300"
            >
              ← 后台首页
            </Link>
            <span>/</span>
            <Link
              href="/admin/posts"
              className="hover:text-sky-600 dark:hover:text-sky-300"
            >
              文章管理
            </Link>
            <span>/</span>
            <span>新建</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            新建文章
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            填写后点击「保存草稿」或「发布」。保存即生成 Git 提交，并同步数据库索引。
          </p>
        </div>
        <LogoutButton />
      </header>

      <PostEditor initial={initial} mode="create" />
    </div>
  );
}
