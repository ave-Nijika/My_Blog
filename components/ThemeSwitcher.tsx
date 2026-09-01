"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/i18n/theme-context";
import type { Theme } from "@/lib/i18n/config";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const themes: { value: Theme; label: string; icon: string }[] = [
    { value: "light", label: "Light", icon: "\u2600\uFE0F" },
    { value: "dark", label: "Dark", icon: "\u{1F319}" },
    { value: "system", label: "System", icon: "\u{1F4BB}" },
  ];

  const currentTheme = themes.find((t) => t.value === theme) || themes[2];

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

  function choose(t: Theme) {
    setTheme(t);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        aria-label="Switch theme"
        aria-expanded={open}
      >
        <span className="text-sm">{currentTheme.icon}</span>
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
        <div className="ba-dropdown absolute right-0 top-full mt-1 w-32 py-1 z-50 origin-top-right animate-[fadeInDown_180ms_ease-out]">
          {themes.map((t) => (
            <button
              key={t.value}
              onClick={() => choose(t.value)}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-sky-50 dark:hover:bg-sky-950/40 ${
                theme === t.value
                  ? "bg-[color:rgb(var(--ba-primary-soft))] font-semibold text-[color:rgb(var(--ba-primary))] dark:text-[color:rgb(var(--ba-primary-light))]"
                  : "text-[color:rgb(var(--color-text-primary))]"
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
