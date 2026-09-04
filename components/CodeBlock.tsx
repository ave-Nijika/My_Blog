"use client";

/**
 * 文章代码块增强（仅文章详情页启用；编辑页 PostEditor 预览不受影响）。
 *
 * 两档行为（经 lib/useDeviceOverride 的 override 决定；历史 "auto" 已在
 * hook 内归一化为 desktop）：
 * - override = desktop（默认）：工具条 hover/focus-within 浮出，渲染
 *   「复制 + 展开」两按钮；无 hover 能力的设备（触屏）上按钮常驻可见。
 * - override = mobile：工具条**常驻**且只渲染「展开」按钮
 *   （复制按钮隐藏，避免与长按重复）；长按代码块 500ms 复制 + toast 沿用。
 * - 切到 mobile 的瞬间：屏幕中下浮出 3 秒说明栏（复用 .code-copy-toast，
 *   点击可立即关闭；模块级标记保证一个 mobile 周期只弹一次，仅在文章详情页
 *   存在本组件，天然不波及其他页面）。
 *
 * 复制取 pre.textContent 纯文本（保留缩进换行，无语言标记/HTML）；
 * clipboard API 失败降级 textarea + execCommand；尊重 prefers-reduced-motion。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  useDeviceOverride,
  getLastSwitchedToMobileAt,
} from "@/lib/useDeviceOverride";

type Props = {
  children?: ReactNode;
  className?: string;
};

const FEEDBACK_MS = 1500;
const HINT_MS = 3000;
// 切换到 mobile 后的多久内进入文章页仍算"刚切换"（SPA 内切页很快，放宽一点）
const HINT_SWITCH_WINDOW_MS = 1500;
const LONG_PRESS_MS = 500;

const MOBILE_HINT_TEXT = "已切换到手机模式：长按代码块复制、右上角按钮展开";

// 模块级：当前 mobile 周期是否已弹过说明栏（多代码块共存时只弹一个；
// override 离开 mobile 时重置，允许下一个周期再次提示）
let mobileHintShownThisCycle = false;

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

export function CodeBlock({ children, className }: Props) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const { override, resolved } = useDeviceOverride();
  // hover 能力：手动桌面端在无 hover 设备（触屏）上按钮需常驻可见（验收 2）
  const [canHover, setCanHover] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState(false);
  const [mobileHint, setMobileHint] = useState(false);
  // Portal 挂载标记：toast 用 createPortal 渲染到 body，脱离被 Reveal 的
  // transform 劫持的祖先链（否则 position:fixed 相对文章容器而非视口）
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const copyTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const hintTimerRef = useRef<number | null>(null);

  // hover 能力（水合后同步；SSR/首帧默认 true 与服务端一致）
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover)");
    const update = () => setCanHover(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 切到 manual mobile 的瞬间弹一次性说明栏（3s，可点击关闭）。
  // 用 hook 记录的"切换时刻"判断：页面加载时本就是 mobile 的不算切换，不弹。
  useEffect(() => {
    if (override !== "mobile") {
      // 离开 mobile：重置周期标记，允许下一次切换再提示
      mobileHintShownThisCycle = false;
      return;
    }
    if (mobileHintShownThisCycle) return;
    if (Date.now() - getLastSwitchedToMobileAt() > HINT_SWITCH_WINDOW_MS) return;
    mobileHintShownThisCycle = true;
    setMobileHint(true);
    if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setMobileHint(false), HINT_MS);
  }, [override]);

  useEffect(
    () => () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    },
    []
  );

  const copyCode = useCallback(async (): Promise<boolean> => {
    // highlight.js 把代码拆成多个 span，textContent 即纯代码文本
    const text = preRef.current?.textContent ?? "";
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* 不可用时降级 */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const handleCopyClick = useCallback(async () => {
    if (!(await copyCode())) return;
    setCopied(true);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), FEEDBACK_MS);
  }, [copyCode]);

  const showCopiedToast = useCallback(() => {
    setToast(true);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(false), FEEDBACK_MS);
  }, []);

  // 触屏长按复制：按下起计时，移动/抬起即取消（滚动不误触）
  const onTouchStart = useCallback(() => {
    if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
    pressTimerRef.current = window.setTimeout(async () => {
      pressTimerRef.current = null;
      if (!(await copyCode())) return;
      showCopiedToast();
    }, LONG_PRESS_MS);
  }, [copyCode, showCopiedToast]);

  const cancelPress = useCallback(() => {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  // ===== 两档行为派生 =====
  // mobile：工具条常驻、仅展开按钮；desktop：有 hover 时悬停浮出，
  // 无 hover 设备（触屏）常驻可见（否则按钮永远无法触达）。
  // 两档均渲染工具条，差异仅在常驻显示或悬停显示。
  const toolbarMode = override === "mobile" ? "persistent" : canHover ? "hover" : "persistent";
  // 复制按钮只在桌面档渲染（手机端隐藏，避免与长按重复）
  const showCopyButton = resolved === "desktop";
  // 长按复制在"复制按钮不可见"的档位启用（mobile）
  const longPressEnabled = resolved !== "desktop";
  // 常驻样式以内联覆盖既有 CSS（默认 opacity:0/pointer-events:none，
  // 以及 pointer:coarse 下的 display:none），不改动 .prose-content pre 既有视觉
  const persistentStyle =
    toolbarMode === "persistent"
      ? { display: "flex", opacity: 1, pointerEvents: "auto" as const }
      : undefined;

  return (
    <div
      className={`code-block${expanded ? " is-expanded" : ""}`}
      onTouchStart={longPressEnabled ? onTouchStart : undefined}
      onTouchMove={longPressEnabled ? cancelPress : undefined}
      onTouchEnd={longPressEnabled ? cancelPress : undefined}
      onTouchCancel={longPressEnabled ? cancelPress : undefined}
    >
      <div className="code-block-toolbar" style={persistentStyle}>
        {showCopyButton ? (
          <button
            type="button"
            className={`code-block-btn${copied ? " is-copied" : ""}`}
            aria-label="复制代码"
            title="复制代码"
            onClick={handleCopyClick}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        ) : null}
        <button
          type="button"
          className="code-block-btn"
          aria-label={expanded ? "收起代码" : "展开代码"}
          title={expanded ? "收起代码" : "展开代码"}
          aria-pressed={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>
      <pre ref={preRef} className={className}>
        {children}
      </pre>
      {mounted
        ? createPortal(
            <>
              {toast ? (
                <div className="code-copy-toast" role="status">
                  已复制
                </div>
              ) : null}
              {mobileHint ? (
                <div
                  className="code-copy-toast"
                  role="status"
                  title="点击关闭"
                  onClick={() => {
                    setMobileHint(false);
                    if (hintTimerRef.current)
                      window.clearTimeout(hintTimerRef.current);
                  }}
                >
                  {MOBILE_HINT_TEXT}
                </div>
              ) : null}
            </>,
            document.body
          )
        : null}
    </div>
  );
}
