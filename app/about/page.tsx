import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { getSiteProfile } from "@/lib/queries";
import { getAboutPageConfig, type AboutContactCard } from "@/lib/site-settings";
import { AboutContactCards } from "@/components/AboutContactCards";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: "About",
};

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  // 与 layout 同款 SSR 读 cookie（双语一致红线）
  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const t = locale === "en" ? en : zh;

  const profile = await getSiteProfile();
  const bili = "https://space.bilibili.com/502195584";
  const email = "2113397931@qq.com";
  const aboutCfg = await getAboutPageConfig();
  // 联系方式卡：管理员配置优先，空则用内置默认（QQ 为点击复制，不再 mailto 跳转）
  const contactCards: AboutContactCard[] = aboutCfg.contacts ?? [
    { id: "bili", label: "B站", value: "赛博利维坦", href: bili, kind: "link" },
    { id: "qq", label: "QQ 邮箱", value: email, kind: "copy" },
  ];
  const defaultNotes = [t.page.siteNote1, t.page.siteNote2, t.page.siteNote3].join("\n");
  const noteLines = (aboutCfg.notes ?? defaultNotes)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="relative mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <span
        className="ba-outline-text pointer-events-none absolute -top-2 right-0 hidden text-[84px] opacity-[0.14] sm:block"
        aria-hidden
      >
        ABOUT
      </span>

      <Reveal translateY={10} className="relative inline-block">
        <span className="ba-tri absolute -left-5 -top-1 h-3 w-3.5 opacity-90" aria-hidden />
        <h1 className="ba-font-round text-3xl text-[color:rgb(var(--ba-primary))]">
          {t.page.aboutTitle}
        </h1>
      </Reveal>
      <Reveal delay={80} className="mt-3">
        <span className="ba-pill ba-pill--soft">{t.page.aboutBadge}</span>
      </Reveal>

      {/* 个人介绍：官网档案卡（头像 + 昵称 + 简介） */}
      <Reveal translateY={12} delay={120} className="ba-card mt-8 overflow-hidden p-6 text-center">
        {profile.avatarUrl && (
          <div className="relative mx-auto mb-4 h-24 w-24">
            <span className="ba-tri absolute -right-4 -top-2 h-4 w-5" aria-hidden />
            <Image
              src={profile.avatarUrl}
              alt={profile.nickname}
              width={96}
              height={96}
              unoptimized
              className="h-24 w-24 rounded-full border-[3px] border-[rgb(var(--ba-primary))]/60 object-cover shadow-lg"
            />
          </div>
        )}
        <h2 className="ba-font-round mb-2 text-2xl text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
          {profile.nickname}
        </h2>
        <div className="mb-4">
          <span className="ba-pill">{t.page.aboutRole}</span>
        </div>
        {profile.biography && (
          <p className="leading-relaxed text-slate-600 dark:text-slate-300 max-sm:text-sm">
            {profile.biography}
          </p>
        )}
      </Reveal>

      {/* 站点说明 */}
      <Reveal translateY={12} delay={160} className="ba-card mt-6 p-6">
        <h3 className="ba-font-round mb-4 flex items-center gap-2.5 text-lg text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
          <span className="ba-tri h-3 w-3.5" aria-hidden />
          {t.page.siteNotes}
        </h3>
        <div className="space-y-3 leading-relaxed text-slate-600 dark:text-slate-300 max-sm:text-sm">
          {noteLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </Reveal>

      {/* 联系方式 */}
      <Reveal translateY={12} delay={220} className="mt-8">
        <h3 className="ba-font-round mb-4 text-lg text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
          {t.page.contact}
        </h3>
        <AboutContactCards cards={contactCards} />
      </Reveal>

      <Reveal translateY={10} delay={280} className="mt-10 text-center">
        <Link href="/" className="ba-btn ba-btn-primary px-7 py-2 text-sm">
          {t.common.backToHome}
        </Link>
      </Reveal>
    </div>
  );
}
