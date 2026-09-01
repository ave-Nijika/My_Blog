import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";
import { siteConfig } from "@/lib/site";
import { getSession } from "@/lib/auth";
import { getAboutPageConfig, type AboutContactCard } from "@/lib/site-settings";
import { LocaleProvider } from "@/lib/i18n/context";
import { ThemeProvider } from "@/lib/i18n/theme-context";
import { ThemeInitScript } from "@/components/ThemeInitScript";
import { BaLoader } from "@/components/BaLoader";
import { RippleProvider } from "@/components/RippleProvider";
import { RouteProgress } from "@/components/RouteProgress";
import { BaCursor } from "@/components/BaCursor";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";

// BA 官网字体气质的合法替代，自托管 woff2（app/fonts/，均为 SIL OFL 1.1 可再分发）：
// Baloo 2（可变字重）→ 官网圆体拉丁（FZ兰亭圆的拉丁位）；Bungee → 官网展示英文 BUNGEE；
// Caveat（可变字重）→ 官网英文手写点缀。中文正文/标题走系统字体栈（globals.css）。
// 用 next/font/local 而非 google：构建与 dev 均无外网依赖，可复现且首屏零字体请求延迟。
const baloo = localFont({
  variable: "--font-baloo",
  src: "./fonts/baloo2-var-latin.woff2",
  weight: "400 800",
  display: "swap",
});

const bungee = localFont({
  variable: "--font-bungee",
  src: "./fonts/bungee-400-latin.woff2",
  weight: "400",
  display: "swap",
});

const caveat = localFont({
  variable: "--font-caveat",
  src: "./fonts/caveat-var-latin.woff2",
  weight: "400 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1289f9" },
    { media: "(prefers-color-scheme: dark)", color: "#091222" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 导航标签走 i18n：server component 直接读 locale cookie，
  // SSR 输出即为最终语言（集成测试 P2-5 回归依赖此行为，不可改懒加载）。
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const t = locale === "en" ? en : zh;
  // 仅管理员会话可见的后台入口（主人要求免输隐藏网址）
  const adminSession = await getSession();
  // 页脚中段联系方式与关于页同源（SiteSettings.aboutContacts），未配置用内置默认
  const aboutCfg = await getAboutPageConfig();
  const footerContacts: AboutContactCard[] = aboutCfg.contacts ?? [
    { id: "bili", label: "B站「赛博利维坦」", value: "赛博利维坦", href: "https://space.bilibili.com/502195584", kind: "link" },
    { id: "qq", label: "2113397931@qq.com", value: "2113397931@qq.com", kind: "copy" },
  ];
  const links = [
    { href: "/", label: t.common.home },
    { href: "/posts", label: t.common.posts },
    { href: "/comfyui", label: "ComfyUI" },
    { href: "/about", label: t.common.about },
    ...(adminSession
      ? [{ href: "/admin", label: locale === "en" ? "Admin" : "管理员界面" }]
      : []),
  ];

  return (
    <html
      lang={DEFAULT_LOCALE}
      className={`${baloo.variable} ${bungee.variable} ${caveat.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* 防闪烁脚本必须位于 body 内（<script> 不能是 <html> 的直接子元素） */}
        <ThemeInitScript />
        {/* 进站加载页：每会话一次 ≤1.2s，reduced-motion/无 JS 自动跳过 */}
        <BaLoader />
        <RouteProgress />
        <BaCursor />
        <ThemeProvider>
          <LocaleProvider initialLocale={DEFAULT_LOCALE}>
            <Header links={links} locale={locale} />
            <main className="flex-1 w-full relative z-10">
              {/* 官网三角网格纹理由 body::before 全局铺设，页面内容在其上 */}
              <RippleProvider>{children}</RippleProvider>
            </main>
            <Footer siteConfig={siteConfig} contacts={footerContacts} />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
