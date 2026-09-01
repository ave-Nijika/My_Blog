"use client";

import { useEffect } from "react";

/**
 * 全局点击涟漪特效（替换浏览器默认的 focus/active 圆角框视觉）。
 *
 * - 只对 a / button / [role='button'] / .ripple-target 触发；
 * - 涟漪从点击坐标扩散，动画通过 CSS keyframes 一次性跑完；
 * - 同时把"按下"时浏览器默认的 focus 圆环压住，仅保留 :focus-visible
 *   时的键盘焦点环（详见 globals.css 中的 ba-focus-ring）。
 */
export function RippleProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!document.getElementById("ripple-anim-style")) {
      const style = document.createElement("style");
      style.id = "ripple-anim-style";
      style.textContent = `
        @keyframes lin-ripple-spread {
          from { transform: scale(0); opacity: 0.55; }
          to { transform: scale(1); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest(
        "a, button, [role='button'], .ripple-target",
      ) as HTMLElement | null;
      if (!el) return;

const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.1;
      const ripple = document.createElement("span");
      ripple.className = "pointer-events-none absolute rounded-full";
      ripple.style.cssText = [
        `width:${size.toFixed(0)}px`,
        `height:${size.toFixed(0)}px`,
        `left:${(e.clientX - rect.left - size / 2).toFixed(0)}px`,
        `top:${(e.clientY - rect.top - size / 2).toFixed(0)}px`,
        "background:radial-gradient(circle, rgba(56,189,248,0.45) 0%, rgba(56,189,248,0) 70%)",
        "transform:scale(0)",
        "animation:lin-ripple-spread 0.5s ease-out forwards",
        "z-index:20",
        "mix-blend-mode:multiply",
      ].join(";");
      const style = getComputedStyle(el);
      if (style.position === "static") el.style.position = "relative";
      if (style.overflow === "visible") el.style.overflow = "hidden";
      el.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return <>{children}</>;
}