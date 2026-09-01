"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeSwitcher } from "./ThemeSwitcher";

interface MobileNavProps {
  links: Array<{ href: string; label: string }>;
  pathname: string;
  locale: string;
}

export function MobileNav({ links, pathname, locale }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  // .ba-header 的 backdrop-filter 会把内部 fixed 元素的包含块变成 header 自身
  // （64px 高），菜单因此被压进顶栏。overlay 必须 portal 到 body 才能真正全屏。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const panel = mounted ? createPortal(
    <>
      <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm" onClick={() => setIsOpen(false)} aria-hidden />
      <div className="fixed inset-x-4 top-20 z-[100] mx-auto max-w-sm rounded-3xl ba-glass border border-sky-200/30 dark:border-sky-800/30 p-6 shadow-2xl">
        {/* BA风格装饰 */}
        <div className="absolute -top-4 -right-4 w-20 h-20 bg-gradient-to-br from-sky-400/20 to-transparent rounded-full blur-2xl" aria-hidden />
        <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-gradient-to-tr from-cyan-300/15 to-transparent rounded-full blur-2xl" aria-hidden />

        <nav className="flex flex-col gap-2 relative z-10">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setIsOpen(false)}
              className={`
                rounded-2xl px-4 py-3 text-base font-medium transition-all duration-300 max-sm:text-base
                ${pathname === link.href
                  ? "bg-gradient-to-r from-sky-500/20 to-cyan-500/20 text-sky-700 dark:text-sky-300 shadow-md border border-sky-200/50 dark:border-sky-800/50"
                  : "text-slate-700 hover:bg-sky-50/80 dark:text-slate-200 dark:hover:bg-sky-900/30 hover:shadow-md"
                }
                hover:scale-105
              `}
            >
              {link.label}
              {pathname === link.href && (
                <div className="mt-2 w-6 h-1 bg-gradient-to-r from-sky-400 to-cyan-300 rounded-full mx-auto" aria-hidden />
              )}
            </Link>
          ))}
        </nav>
        <div className="mt-6 flex items-center justify-center gap-4 relative z-10">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </div>
    </>,
    document.body
  ) : null;

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="inline-flex items-center justify-center rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus:ring-sky-600"
        aria-label="Toggle menu"
      >
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          {isOpen ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          )}
        </svg>
      </button>
      {isOpen ? panel : null}
    </>
  );
}