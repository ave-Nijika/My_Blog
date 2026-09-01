"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { MobileNav } from "@/components/MobileNav";

interface HeaderProps {
  links: Array<{ href: string; label: string }>;
  locale: string;
}

export function Header({ links, locale }: HeaderProps) {
  const pathname = usePathname();

  return (
    <header className="ba-header sticky top-0 z-50">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Logo：黄三角 + 圆体站名 + Bungee 小字（官网 logo 双语结构） */}
        <Link
          href="/"
          className="ripple-target group flex items-center gap-2.5 rounded-lg px-2 py-1.5"
          aria-label="拾光笔记"
        >
          <span className="ba-tri transition-transform duration-300 group-hover:scale-125" aria-hidden />
          <span className="flex flex-col leading-none">
            <span className="ba-font-round text-lg text-[color:rgb(var(--ba-primary))]">
              拾光笔记
            </span>
            <span className="ba-font-display mt-1 text-[9px] tracking-[0.18em] text-slate-400 dark:text-slate-500">
              LIGHT NOTES
            </span>
          </span>
        </Link>

        {/* 桌面端导航：官网式大字距，active 变蓝 + 底部小蓝三角 */}
        <nav className="hidden lg:flex items-center gap-7" aria-label="主导航">
          {links.map((link) => {
            const active = pathname === link.href;
            const isLatin = !/[\u4e00-\u9fa5]/.test(link.label);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`ba-nav-link group relative py-2 text-sm font-medium transition-colors duration-200 ${
                  isLatin ? "" : "tracking-[0.3em]"
                } ${
                  active
                    ? "text-[color:rgb(var(--ba-primary))]"
                    : "text-slate-500 hover:text-[color:rgb(var(--ba-primary))] dark:text-slate-300 dark:hover:text-[color:rgb(var(--ba-primary-light))]"
                }`}
              >
                {link.label}
                {/* active 底部小蓝三角（官网 active 标记的呼应） */}
                <span
                  aria-hidden
                  className={`absolute -bottom-0.5 left-1/2 h-2 w-2 -translate-x-1/2 bg-[rgb(var(--ba-primary))] [clip-path:polygon(0_0,100%_50%,0_100%)] transition-all duration-300 ${
                    active ? "opacity-100 scale-100" : "opacity-0 scale-50"
                  }`}
                />
              </Link>
            );
          })}
        </nav>

        {/* 右侧：语言/主题切换（桌面）或移动端菜单 */}
        <div className="flex items-center gap-1">
          <div className="hidden lg:flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
          <div className="flex items-center lg:hidden">
            <MobileNav links={links} pathname={pathname} locale={locale} />
          </div>
        </div>
      </div>
    </header>
  );
}
