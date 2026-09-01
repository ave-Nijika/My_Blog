"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/config";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function choose(l: Locale) {
    setLocale(l);
    // 让服务端渲染的区块（导航/页脚等）立即按新 cookie 重渲染，
    // 而不是等到下一次导航（整改详报"疑惑 3"，v2 任务书 1.2）
    router.refresh();
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        aria-label="Switch language"
        aria-expanded={open}
      >
        <span>{locale === "zh-CN" ? "中" : "EN"}</span>
        <svg
          className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          className="ba-dropdown absolute right-0 top-full mt-1 w-24 py-1 z-50 origin-top-right animate-[fadeInDown_180ms_ease-out]"
        >
          <button
            onClick={() => choose("zh-CN")}
            className={`block w-full px-4 py-2 text-left text-sm transition-colors hover:bg-sky-50 dark:hover:bg-sky-950/40 ${
              locale === "zh-CN"
                ? "bg-[color:rgb(var(--ba-primary-soft))] font-semibold text-[color:rgb(var(--ba-primary))] dark:text-[color:rgb(var(--ba-primary-light))]"
                : "text-[color:rgb(var(--color-text-primary))]"
            }`}
          >
            中
          </button>
          <button
            onClick={() => choose("en")}
            className={`block w-full px-4 py-2 text-left text-sm transition-colors hover:bg-sky-50 dark:hover:bg-sky-950/40 ${
              locale === "en"
                ? "bg-[color:rgb(var(--ba-primary-soft))] font-semibold text-[color:rgb(var(--ba-primary))] dark:text-[color:rgb(var(--ba-primary-light))]"
                : "text-[color:rgb(var(--color-text-primary))]"
            }`}
          >
            EN
          </button>
        </div>
      )}
    </div>
  );
}
