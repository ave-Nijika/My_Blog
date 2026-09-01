"use client";

import { useEffect, useRef } from "react";

/**
 * 路由切换时的顶部进度条（替代 app/loading.tsx，避免在文章路由触发流式边界
 * 导致 notFound() 触发的 404 页面变成 200 状态码 —— 这是阶段 5 引入的回归）。
 *
 * - 仅监听 Next.js 路由变化（不挂 loading.tsx，SSR 仍是稳定的同步渲染）；
 * - 装饰性动画，不影响语义、不引入新依赖；
 * - 尊重 prefers-reduced-motion。
 */
export function RouteProgress() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let finishedTimer: ReturnType<typeof setTimeout> | null = null;

    const start = () => {
      el.dataset.state = "loading";
      if (finishedTimer) {
        clearTimeout(finishedTimer);
        finishedTimer = null;
      }
    };

    const finish = () => {
      el.dataset.state = "done";
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // 重置：下一次路由切换时重新触发
        if (el) el.dataset.state = "idle";
      }, 480);
      if (finishedTimer) clearTimeout(finishedTimer);
      finishedTimer = setTimeout(() => {
        if (el) el.dataset.state = "idle";
      }, 520);
    };

    // 用 click 触发 + popstate 兜底（覆盖前进/后退）
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const a = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") || "";
      // 只拦截站内同源导航；外链、_blank、新标签不触发
      if (
        a.target === "_blank" ||
        a.hasAttribute("download") ||
        a.dataset.external === "true" ||
        /^https?:\/\//.test(href) ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      ) {
        return;
      }
      start();
    };

    const onPopState = () => start();

    // Next.js App Router 内部完成渲染后清掉进度
    const observer = new MutationObserver(() => {
      if (el.dataset.state === "loading") {
        // 主体内容出现则认为新页已就绪
        finish();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      if (idleTimer) clearTimeout(idleTimer);
      if (finishedTimer) clearTimeout(finishedTimer);
    };
  }, []);

  return <div ref={ref} className="ba-route-progress" data-state="idle" aria-hidden />;
}
