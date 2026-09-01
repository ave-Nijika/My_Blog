"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";

import type { AboutContactCard } from "@/lib/site-settings";

interface FooterProps {
  siteConfig: {
    name: string;
    author: string;
  };
  /** 与关于页同源的联系方式（SiteSettings.aboutContacts，layout 传入） */
  contacts: AboutContactCard[];
}

export function Footer({ siteConfig, contacts }: FooterProps) {
  const { locale } = useLocale();
  const zhMode = locale === "zh-CN";

  const navLinks = [
    { href: "/", label: zhMode ? "首页" : "Home" },
    { href: "/posts", label: zhMode ? "文章" : "Posts" },
    { href: "/comfyui", label: "ComfyUI" },
    { href: "/about", label: zhMode ? "关于" : "About" },
  ];

  return (
    <footer className="ba-footer mt-auto">
      <div className="mx-auto max-w-6xl px-4 py-10 text-center">
        {/* 官网式居中链接列（│ 分隔） */}
        <nav
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm"
          aria-label="页脚导航"
        >
          {navLinks.map((link, i) => (
            <span key={link.href} className="flex items-center gap-3">
              {i > 0 && (
                <span aria-hidden className="text-slate-300 dark:text-slate-600 select-none">
                  │
                </span>
              )}
              <Link
                href={link.href}
                className="text-slate-500 transition-colors hover:text-[color:rgb(var(--ba-primary))] dark:text-slate-400 dark:hover:text-[color:rgb(var(--ba-primary-light))]"
              >
                {link.label}
              </Link>
            </span>
          ))}
        </nav>

        {/* 联系方式（官网页脚小字风格）——随关于页可配置的联系方式联动 */}
        <p className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-slate-400 dark:text-slate-500">
          {contacts.map((c, i) => (
            <span key={c.id} className="flex items-center gap-4">
              {i > 0 && (
                <span aria-hidden className="select-none text-slate-300 dark:text-slate-600">
                  │
                </span>
              )}
              {c.kind === "link" && c.href ? (
                <a
                  href={c.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-[color:rgb(var(--ba-primary))]"
                >
                  {c.label}
                </a>
              ) : (
                <span>{c.label}</span>
              )}
            </span>
          ))}
        </p>

        {/* 版权 + 标语 */}
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          © {new Date().getFullYear()} {siteConfig.name} ·{" "}
          {zhMode ? "记录学习过程中的所思所想" : "A personal blog of learning notes"}
        </p>
        <p
          className={`mt-3 text-sm font-medium text-[color:rgb(var(--ba-primary))] ${
            zhMode ? "ba-font-round tracking-widest" : "ba-font-hand text-lg"
          }`}
        >
          {zhMode ? "因为热爱，所以存在" : "Powered by passion, exists for love"}
        </p>
      </div>
    </footer>
  );
}
