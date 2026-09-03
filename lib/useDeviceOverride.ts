"use client";

/**
 * 设备模式覆盖 hook（需求 A）。
 *
 * - `localStorage.ba_device_override` 存 "auto"（默认）/ "desktop" / "mobile"，
 *   跨页面、跨刷新、跨专区（首页/文章页/ComfyUI 等）持久保留。
 * - `resolved`：override 直接映射；auto 时按系统指针能力判定
 *   （matchMedia("(pointer: fine)") 真 → desktop，假 → mobile）。
 * - 水合安全：useSyncExternalStore 的水合渲染使用 getServerSnapshot
 *   （恒 auto / 桌面），挂载后才读 localStorage 与 matchMedia 真实值并自动
 *   再渲染——SSR/首帧一致，无 hydration 不一致，无卸载/挂载闪烁。
 * - 同步通道：本组件 setOverride 后派发自定义事件（站内所有 hook 实例
 *   立即同步）；storage 事件覆盖跨标签页场景。
 */
import { useCallback, useSyncExternalStore } from "react";

export type DeviceOverride = "auto" | "desktop" | "mobile";
export type ResolvedDevice = "desktop" | "mobile";

export const DEVICE_OVERRIDE_STORAGE_KEY = "ba_device_override";
const OVERRIDE_EVENT = "ba-device-override-change";

function isDeviceOverride(v: unknown): v is DeviceOverride {
  return v === "auto" || v === "desktop" || v === "mobile";
}

function readOverride(): DeviceOverride {
  try {
    const v = localStorage.getItem(DEVICE_OVERRIDE_STORAGE_KEY);
    return isDeviceOverride(v) ? v : "auto";
  } catch {
    // 隐私模式等 localStorage 不可用场景：按 auto
    return "auto";
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

function subscribePointerFine(callback: () => void): () => void {
  const mq = window.matchMedia("(pointer: fine)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
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
    () => "auto" as DeviceOverride
  );
  const pointerFine = useSyncExternalStore(
    subscribePointerFine,
    () => window.matchMedia("(pointer: fine)").matches,
    () => true
  );

  const setOverride = useCallback((next: DeviceOverride) => {
    const prev = readOverride();
    try {
      if (next === "auto") localStorage.removeItem(DEVICE_OVERRIDE_STORAGE_KEY);
      else localStorage.setItem(DEVICE_OVERRIDE_STORAGE_KEY, next);
    } catch {
      // 写入失败（隐私模式等）：仅尽力派发，快照仍读旧值
    }
    if (next === "mobile" && prev !== "mobile") {
      lastSwitchedToMobileAt = Date.now();
    }
    // 通知站内所有 useDeviceOverride 实例（含 CodeBlock / 切换按钮）
    window.dispatchEvent(new Event(OVERRIDE_EVENT));
  }, []);

  const resolved: ResolvedDevice =
    override === "auto" ? (pointerFine ? "desktop" : "mobile") : override;

  return { override, setOverride, resolved };
}
