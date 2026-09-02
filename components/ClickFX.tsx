"use client";

import { useEffect, useRef } from "react";

/**
 * 全局 BA 鼠标特效（ba-click-fx）：
 * - 从 Unity FX_Touch 移植的点击圆环 + 光标拖尾（点击、拖拽、移动鼠标触发）
 * - 纯客户端运行：动态 import 避免 SSR 时访问 window/document/WebGL
 * - 主题色使用库默认 #4ca7ff（BA 风格浅蓝，实测观感更亮）
 * - 全屏覆盖层 pointer-events: none，不影响页面交互
 */
export function ClickFX() {
  const fxRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let fx: { destroy: () => void } | null = null;

    (async () => {
      try {
        const { BAClickFX } = await import("ba-click-fx");
        if (cancelled) return;
        fx = new BAClickFX({
          themeColor: "#4ca7ff",
          clickEnabled: true,
          trailEnabled: true,
          maxDpr: 1,
        });
        fxRef.current = fx;
      } catch {
        // 加载失败静默降级：特效只是增强，不阻断页面
      }
    })();

    return () => {
      cancelled = true;
      fxRef.current?.destroy();
      fxRef.current = null;
    };
  }, []);

  return null;
}
