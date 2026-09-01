/**
 * /admin/posts/[id]/edit
 *
 * 编辑现有文章：服务端先从 DB + 磁盘读出当前状态，交给 PostEditor 渲染。
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { LogoutButton } from "../../../LogoutButton";
import { getPost, readPostBody } from "@/lib/admin-posts";
import { PostEditor, type PostFormValues } from "../../PostEditor";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "编辑文章",
  robots: { index: false, follow: false },
};

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const post = await getPost(id);
  if (!post) {
    notFound();
  }
  const body = await readPostBody(post.slug);

  const initial: PostFormValues = {
    id: post.id,
    title: post.title,
    slug: post.slug,
    summary: post.summary,
    status: post.status,
    category: post.category,
    tagsInput: post.tags.join(", "),
    pinned: post.pinned,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : "",
    body,
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
            <span>编辑</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            编辑：{post.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
              {post.slug}
            </code>
            <span className="ml-2">id: {post.id}</span>
          </p>
        </div>
        <LogoutButton />
      </header>

      <PostEditor initial={initial} mode="edit" />
    </div>
  );
}
