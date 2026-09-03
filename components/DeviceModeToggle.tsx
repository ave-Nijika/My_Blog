"use client";

/**
 * 设备模式切换（需求 A）：右下角悬浮小圆点（CSDN"回顶部"式存在感）+
 * 向上展开的三档 popover（自动 / 桌面端 / 手机端）。
 *
 * - 持久化经 lib/useDeviceOverride（localStorage.ba_device_override）
 * - 点击选项即切换并收起；点击页面其他区域 / Esc 关闭
 * - a11y：按钮 aria-label="切换设备模式" + aria-expanded；
 *   popover role="menu"，选项 role="menuitemradio" + aria-checked
 * - 样式走 Tailwind 内联（不动 globals.css）；BA 主题色融合；
 *   尊重 prefers-reduced-motion（motion-reduce: 变换/过渡全关）
 */
import { useEffect, useRef, useState } from "react";
import {
  useDeviceOverride,
  type DeviceOverride,
} from "@/lib/useDeviceOverride";

const OPTIONS: Array<{ value: DeviceOverride; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "desktop", label: "桌面端" },
  { value: "mobile", label: "手机端" },
];

function DeviceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="13" height="10" rx="2" />
      <path d="M6 19h5" />
      <rect x="14" y="10" width="8" height="12" rx="2" />
    </svg>
  );
}

export function DeviceModeToggle() {
  const { override, setOverride } = useDeviceOverride();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(next: DeviceOverride) {
    setOverride(next);
    setOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2"
    >
      {open ? (
        <div
          role="menu"
          aria-label="设备模式"
          className="min-w-[8.5rem] rounded-xl border border-[color:rgb(var(--ba-line))] bg-[color:rgb(var(--color-surface))] p-1.5 shadow-[var(--shadow-md)]"
        >
          {OPTIONS.map(({ value, label }) => {
            const active = override === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => choose(value)}
                className={
                  "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-sm transition-colors motion-reduce:transition-none " +
                  (active
                    ? "border border-[rgb(var(--ba-primary))]/45 bg-[color:rgb(var(--ba-primary-soft))] text-[color:rgb(var(--ba-primary))]"
                    : "border border-transparent text-[color:rgb(var(--color-text-primary))] hover:bg-[color:rgb(var(--color-surface-hover))]")
                }
              >
                {label}
                <span
                  className="text-xs opacity-80"
                  aria-hidden={active ? undefined : "true"}
                >
                  {active ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <button
        type="button"
        aria-label="切换设备模式"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[rgb(var(--ba-primary))]/85 text-white shadow-[var(--shadow-md)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[rgb(var(--ba-primary))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--ba-primary))] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <DeviceIcon />
      </button>
    </div>
  );
}
