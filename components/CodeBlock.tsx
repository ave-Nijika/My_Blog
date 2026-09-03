"use client";

/**
 * 文章代码块增强（仅文章详情页启用；编辑页 PostEditor 预览不受影响）。
 *
 * - 桌面（pointer: fine）：悬停代码块右上角浮出「复制 / 展开」两个极简图标
 *   按钮（低灰度、无底色边框，键盘可聚焦，focus-within 同样显示）；
 *   复制取 pre.textContent 纯文本（保留缩进换行，无语言标记/HTML），
 *   成功后复制图标短暂变勾；展开在收起态限高与 80vh 上限间切换。
 * - 触屏（pointer: coarse）：不渲染按钮组；长按约 500ms 直接复制并浮出
 *   轻提示（1.5s 消失），文字选择由 CSS（pointer: coarse 下 user-select:none）
 *   让位于长按复制。
 * - 复制优先 navigator.clipboard，失败降级 textarea + execCommand。
 * - 图标为 inline SVG（Lucide 线性风格），无第三方依赖。
 * 样式见 app/globals.css「代码块增强」区块；不改动 .prose-content pre 既有视觉。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  children?: ReactNode;
  className?: string;
};

const FEEDBACK_MS = 1500;
const LONG_PRESS_MS = 500;

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
  const [finePointer, setFinePointer] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pressTimerRef = useRef<number | null>(null);

  // 设备区分：SSR/首帧不渲染按钮（与服务端一致，避免 hydration 分歧），
  // 挂载后按 matchMedia 结果决定是否启用悬停工具条。
  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    const update = () => setFinePointer(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(
    () => () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
    },
    []
  );

  const copyCode = useCallback(async (): Promise<boolean> => {
    // highlight.js 把代码拆成多个 span，textContent 即纯代码文本
    //（保留换行与缩进，不含语言标记/行号/HTML）
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

  return (
    <div
      className={`code-block${expanded ? " is-expanded" : ""}`}
      onTouchStart={finePointer ? undefined : onTouchStart}
      onTouchMove={finePointer ? undefined : cancelPress}
      onTouchEnd={finePointer ? undefined : cancelPress}
      onTouchCancel={finePointer ? undefined : cancelPress}
    >
      {finePointer ? (
        <div className="code-block-toolbar">
          <button
            type="button"
            className={`code-block-btn${copied ? " is-copied" : ""}`}
            aria-label="复制代码"
            title="复制代码"
            onClick={handleCopyClick}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
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
      ) : null}
      <pre ref={preRef} className={className}>
        {children}
      </pre>
      {toast ? (
        <div className="code-copy-toast" role="status">
          已复制
        </div>
      ) : null}
    </div>
  );
}
