"use client";

import { useEffect, useState } from "react";

/**
 * 进站加载页（官网 CONNECTING 同款气质）：深 navy + 三角纹理 + 品牌字标 + 进度条。
 * - 每个浏览器会话只播一次（sessionStorage），点击任意处可跳过，总时长 ≤1.2s；
 * - prefers-reduced-motion 用户直接不播；
 * - 防闪烁：组件内联脚本在首帧前检查 sessionStorage 给 <html> 加 ba-loader-off；
 * - 无 JS 环境（爬虫/禁 JS）经 <noscript> 隐藏，不阻塞内容。
 */
export function BaLoader() {
  // SSR 恒渲染 overlay（HTML 里存在），首帧前由内联脚本/effect 决定去留
  const [phase, setPhase] = useState<"active" | "done" | "hidden">("active");

  useEffect(() => {
    const seen = (() => {
      try {
        return sessionStorage.getItem("ba-loader-seen") === "1";
      } catch {
        return false;
      }
    })();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (seen || reduce || document.documentElement.classList.contains("ba-loader-off")) {
      setPhase("hidden");
      return;
    }
    const timer = window.setTimeout(() => setPhase("done"), 1050);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase !== "done") return;
    try {
      sessionStorage.setItem("ba-loader-seen", "1");
    } catch {
      // 隐私模式等场景静默失败：仅退化为每次进站都播
    }
    const timer = window.setTimeout(() => setPhase("hidden"), 450);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "hidden") return null;

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `try{if(sessionStorage.getItem('ba-loader-seen')==='1'||matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.classList.add('ba-loader-off')}}catch(e){}`,
        }}
      />
      <noscript>
        <style>{`.ba-loader{display:none!important}`}</style>
      </noscript>
      <div
        className={`ba-loader ${phase === "done" ? "ba-loader--done" : ""}`}
        onClick={() => setPhase("done")}
        role="presentation"
        aria-hidden="true"
      >
        <div className="ba-loader__inner">
          <span className="ba-tri ba-loader__tri" />
          <span className="ba-font-round ba-loader__title">普拉纳的手账</span>
          <span className="ba-font-display ba-loader__sub">PLANA'S NOTEBOOK</span>
          <div className="ba-loader__bar">
            <span />
          </div>
          <span className="ba-font-display ba-loader__label">CONNECTING</span>
        </div>
      </div>
    </>
  );
}
