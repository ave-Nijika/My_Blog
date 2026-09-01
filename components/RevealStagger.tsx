"use client";

import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

type RevealStaggerProps = {
  children: ReactNode[];
  /**
   * 起始延迟（ms），用于串行触发动画
   */
  initialDelay?: number;
  /**
   * 每个子项之间的间隔（ms），默认 60ms
   */
  step?: number;
  translateY?: number;
  duration?: number;
  className?: string;
  itemClassName?: string;
  /**
   * 每个子项外层元素的 HTML 标签（默认 div）
   */
  as?: "div" | "li" | "article";
};

/**
 * Reveal 的串行包装：把每个子节点都用 Reveal 包裹，依次延迟触发，
 * 适用于文章卡片 / ComfyUI 卡片网格的渐入效果。
 */
export function RevealStagger({
  children,
  initialDelay = 0,
  step = 60,
  translateY = 12,
  duration = 450,
  className,
  itemClassName,
  as = "div",
}: RevealStaggerProps) {
  return (
    <div className={className}>
      {children.map((child, idx) => (
        <Reveal
          key={idx}
          as={as}
          delay={initialDelay + idx * step}
          translateY={translateY}
          duration={duration}
          className={itemClassName}
        >
          {child}
        </Reveal>
      ))}
    </div>
  );
}