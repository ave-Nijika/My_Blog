"use client";

import { useEffect, useRef } from "react";

/**
 * 官网同款"蓝色三角"自定义光标（桌面指针设备启用）。
 * - 仅在 (pointer: fine) 且未开启 prefers-reduced-motion 时接管；
 * - rAF + lerp 缓动跟随，按下时收缩；
 * - 文本输入框保留原生 I-beam（见 globals.css 的 .ba-cursor-active 规则）。
 */
export function BaCursor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduced) return;

    document.documentElement.classList.add("ba-cursor-active");

    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 2;
    let x = tx;
    let y = ty;
    let raf = 0;
    let shown = false;

    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!shown) {
        shown = true;
        x = tx;
        y = ty;
        el.style.opacity = "1";
      }
    };
    const onDown = () => el.classList.add("is-down");
    const onUp = () => el.classList.remove("is-down");
    const onLeave = () => {
      shown = false;
      el.style.opacity = "0";
    };
    const tick = () => {
      x += (tx - x) * 0.3;
      y += (ty - y) * 0.3;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    document.documentElement.addEventListener("mouseleave", onLeave);
    raf = requestAnimationFrame(tick);

    return () => {
      document.documentElement.classList.remove("ba-cursor-active");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="ba-cursor" aria-hidden style={{ opacity: 0 }}>
      <svg viewBox="0 0 20 20" width="18" height="18" role="presentation">
        <path
          d="M3.5 2.5 L17 10 L3.5 17.5 Z"
          fill="rgb(18 137 249)"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
