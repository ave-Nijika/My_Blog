"use client";

import { useState } from "react";
import type { AboutContactCard } from "@/lib/site-settings";

/**
 * 关于页联系方式卡片（支持管理员配置）：
 * - kind=copy：点击复制内容到剪贴板（国内环境 mailto 体验差，主人要求 QQ 邮箱改为复制）
 * - kind=link：新标签页跳转外部主页
 */
export function AboutContactCards({ cards }: { cards: AboutContactCard[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copy(value: string, id: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // 非安全上下文等场景的兜底：选中文本交给用户手动 Ctrl+C
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map((card) => {
        const inner = (
          <>
            <span
              className={`ba-tri h-6 w-7 shrink-0 ${card.kind === "copy" ? "rotate-180" : ""}`}
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-left">
              <span className="ba-font-round block text-base text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
                {card.label}
              </span>
              <span className="block truncate text-sm text-slate-500 dark:text-slate-400 max-sm:text-sm">
                {card.value}
              </span>
            </span>
            <span
              className={`shrink-0 text-xs font-medium transition-opacity duration-200 ${
                card.kind === "copy"
                  ? copiedId === card.id
                    ? "text-emerald-600 opacity-100 dark:text-emerald-400"
                    : "text-[color:rgb(var(--ba-primary))] opacity-80"
                  : "text-slate-400 opacity-0 group-hover:opacity-100"
              }`}
            >
              {card.kind === "copy" ? (copiedId === card.id ? "已复制 ✓" : "点击复制") : "→"}
            </span>
          </>
        );

        const cls =
          "group flex w-full items-center gap-3.5 rounded-lg border border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--color-surface))] p-4 text-sm transition-all duration-200 hover:-translate-y-1 hover:border-[rgb(var(--ba-primary))]/60 hover:shadow-[0_10px_24px_rgba(18,137,249,0.14)] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

        return card.kind === "link" && card.href ? (
          <a
            key={card.id}
            href={card.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cls}
          >
            {inner}
          </a>
        ) : (
          <button
            key={card.id}
            type="button"
            onClick={() => copy(card.value, card.id)}
            className={cls}
            aria-label={`复制 ${card.label}`}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
