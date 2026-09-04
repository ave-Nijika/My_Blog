"use client";

/**
 * 设备模式覆盖 hook。
 *
 * - `localStorage.ba_device_override` 存 "desktop"（默认）/ "mobile"，跨页面、
 *   跨刷新、跨专区（首页/文章页/ComfyUI 等）持久保留。
 *   历史遗留的 "auto" / null / 非法值经 normalizeStoredOverride 归一化为
 *   "desktop"（默认桌面），并在读取时回写存储完成迁移。
 * - 实现用 `useSyncExternalStore`：水合渲染走 getServerSnapshot（恒 desktop），
 *   挂载后才读 localStorage 真实值并自动再渲染——SSR/首帧一致，
 *   无 hydration 不一致、无卸载/挂载闪烁。
 * - 同步通道：本组件 setOverride 后派发自定义事件（站内所有 hook 实例
 *   立即同步）；storage 事件覆盖跨标签页场景。
 */
import { useCallback, useSyncExternalStore } from "react";

export type DeviceOverride = "desktop" | "mobile";
export type ResolvedDevice = "desktop" | "mobile";

export const DEVICE_OVERRIDE_STORAGE_KEY = "ba_device_override";
const OVERRIDE_EVENT = "ba-device-override-change";

/** 把 localStorage 里的原始值归一化为合法 override；"auto"/null/非法值 → "desktop" */
export function normalizeStoredOverride(v: string | null): DeviceOverride {
  return v === "mobile" || v === "desktop" ? v : "desktop";
}

function readOverride(): DeviceOverride {
  try {
    const raw = localStorage.getItem(DEVICE_OVERRIDE_STORAGE_KEY);
    const normalized = normalizeStoredOverride(raw);
    if (normalized !== raw) {
      // 归一化发生了迁移（如历史 "auto" → "desktop"）：回写存储不再残留旧值
      localStorage.setItem(DEVICE_OVERRIDE_STORAGE_KEY, normalized);
    }
    return normalized;
  } catch {
    // 隐私模式等 localStorage 不可用场景：按桌面
    return "desktop";
  }
}

function subscribeOverride(callback: () => void): () => void {
  window.addEventListener(OVERRIDE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(OVERRIDE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

// 最近一次"切换到 mobile"的时刻（0 = 本次会话从未切换）。
// 供 CodeBlock 区分"用户刚切换"与"页面加载时本就是 mobile"——后者不弹说明栏。
let lastSwitchedToMobileAt = 0;

export function getLastSwitchedToMobileAt(): number {
  return lastSwitchedToMobileAt;
}

export function useDeviceOverride(): {
  override: DeviceOverride;
  setOverride: (next: DeviceOverride) => void;
  resolved: ResolvedDevice;
} {
  const override = useSyncExternalStore(
    subscribeOverride,
    readOverride,
    () => "desktop" as DeviceOverride
  );

  const setOverride = useCallback((next: DeviceOverride) => {
    const prev = readOverride();
    try {
      localStorage.setItem(DEVICE_OVERRIDE_STORAGE_KEY, next);
    } catch {
      // 写入失败（隐私模式等）：仅尽力派发，快照仍读旧值
    }
    if (next === "mobile" && prev !== "mobile") {
      lastSwitchedToMobileAt = Date.now();
    }
    // 通知站内所有 useDeviceOverride 实例（含 CodeBlock / 切换按钮）
    window.dispatchEvent(new Event(OVERRIDE_EVENT));
  }, []);

  const resolved: ResolvedDevice = override;

  return { override, setOverride, resolved };
}
