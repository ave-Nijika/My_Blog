"use client";

import Link from "next/link";
import Image from "next/image";
import { useLocale } from "@/lib/i18n/context";
import type { CSSProperties } from "react";

const SLOGANS = {
  "zh-CN": "记录成长的每一刻，拾取知识的每一缕光",
  en: "Capture every moment of growth, gather every ray of knowledge",
} as const;

/**
 * 首页主视觉（官网首页同款结构）：
 * 满幅场景图（砂尾町五人天空区留白给标题）+ 左置标题组 + 底部 SCROLL 提示 + 黄蓝色带收边。
 * 入场动画走 .ba-hero-in（--d 阶梯延迟），reduced-motion 下由全局规则直接关闭。
 */
export function Hero() {
  const { locale } = useLocale();
  const zh = locale === "zh-CN";

  return (
    <section className="relative flex min-h-[calc(100svh-4rem)] items-center overflow-hidden">
      {/* 主视觉背景：Ken Burns 缓推（reduced-motion 自动关闭） */}
      <div className="absolute inset-0" aria-hidden>
        <Image
          src="/ba/dTTcmJH0.jpeg"
          alt=""
          fill
          preload
          sizes="100vw"
          className="ba-hero__bg object-cover object-[68%_center]"
        />
        {/* 左侧深 navy 渐变保证标题可读（WCAG），右侧让角色立绘透出 */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#091222]/78 via-[#0a1a36]/34 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#091222]/42 to-transparent" />
      </div>

      {/* 标题组：置于画面左上天空区 */}
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pt-10 sm:px-6">
        <div className="max-w-xl py-[8vh]">
          <span
            className="ba-hero-in ba-pill mb-6"
            style={{ "--d": "0.05s" } as CSSProperties}
          >
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-white/90" aria-hidden />
            {zh ? "学院档案" : "ACADEMY ARCHIVE"}
          </span>

          <h1 className="ba-hero-in mb-2" style={{ "--d": "0.15s" } as CSSProperties}>
            <span className="ba-font-round block text-5xl leading-tight text-white drop-shadow-[0_4px_18px_rgba(9,18,34,0.55)] sm:text-6xl lg:text-7xl">
              拾光笔记
            </span>
            <span className="ba-font-display mt-3 block text-[11px] tracking-[0.5em] text-[rgb(var(--ba-yellow))] sm:text-sm">
              LIGHT NOTES
            </span>
          </h1>

          <p
            className="ba-hero-in mt-5 max-w-md text-base leading-relaxed text-sky-50/92 sm:text-lg"
            style={{ "--d": "0.3s" } as CSSProperties}
          >
            {SLOGANS[locale as keyof typeof SLOGANS]}
          </p>

          <div
            className="ba-hero-in mt-9 flex flex-wrap items-center gap-3"
            style={{ "--d": "0.45s" } as CSSProperties}
          >
            <Link href="/posts" className="ba-btn ba-btn--lg ba-btn-primary ripple-target">
              {zh ? "开始探索" : "Start Exploring"}
            </Link>
            <Link href="/about" className="ba-btn ba-btn--lg ripple-target">
              {zh ? "了解更多" : "Learn More"}
            </Link>
          </div>
        </div>
      </div>

      {/* 底部滚动提示（官网 SCROLL 同款） */}
      <div className="ba-hero__scroll" aria-hidden>
        <span className="ba-font-display ba-hero-in" style={{ "--d": "0.8s" } as CSSProperties}>
          SCROLL
        </span>
        <span className="ba-hero__scroll-line" />
        <span className="ba-tri ba-hero__scroll-tri" />
      </div>

      {/* 官网签名黄蓝条带收边（黄 18% 硬切蓝，非主题灰带） */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 h-1.5 bg-[linear-gradient(90deg,rgb(var(--ba-yellow))_0_18%,rgb(var(--ba-primary))_18%_100%)]"
        aria-hidden
      />
    </section>
  );
}
