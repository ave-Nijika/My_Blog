"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

type RevealProps = {
  children: ReactNode;
  /**
   * HTML 标签，默认 `div`
   */
  as?: ElementType;
  /**
   * 进入视口的延迟（ms），可用于 stagger
   */
  delay?: number;
  /**
   * 垂直位移幅度（px），正值 = 元素从下方滑入
   */
  translateY?: number;
  /**
   * 动画时长（ms），默认 450ms
   */
  duration?: number;
  /**
   * 一次性显示后停止监听（默认 true）
   */
  once?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * 服务器端默认状态：没有 window，没有 IntersectionObserver。
 * 服务端渲染时元素直接可见（visible=true），客户端 hydrate 后再交由 IntersectionObserver 决定。
 */
const SSR_DEFAULT_VISIBLE = true;

/**
 * 订阅 prefers-reduced-motion 的当前值（不直接调用 setState，避免
 * react-hooks/set-state-in-effect 报错）。
 */
function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

/**
 * 滚动渐入组件：原生 IntersectionObserver 实现。
 * - 元素进入视口时从 `opacity:0 + translateY` 过渡到正常状态；
 * - 尊重 prefers-reduced-motion：命中时直接静态呈现，不做动画；
 * - 不引入第三方动画库，纯 React + IntersectionObserver；
 * - 用 useSyncExternalStore 订阅媒体查询，避免在 effect 里 setState。
 */
export function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  translateY = 12,
  duration = 450,
  once = true,
  className,
  style,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const [visible, setVisible] = useState(SSR_DEFAULT_VISIBLE);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      return;
    }

    if (reduced) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setVisible(false);
          }
        }
      },
      {
        threshold: 0.12,
        rootMargin: "0px 0px -8% 0px",
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [once, reduced]);

  const Component = Tag as ElementType;

  const mergedStyle: CSSProperties = {
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : `translateY(${translateY}px)`,
    transitionProperty: "opacity, transform",
    transitionDuration: `${reduced ? 0 : duration}ms`,
    transitionDelay: `${reduced ? 0 : delay}ms`,
    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
    willChange: visible ? undefined : "opacity, transform",
    ...style,
  };

  return (
    <Component ref={ref as never} className={className} style={mergedStyle}>
      {children}
    </Component>
  );
}