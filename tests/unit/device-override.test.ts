/**
 * 设备模式归一化纯函数单测（lib/useDeviceOverride.ts，node 环境无 localStorage）。
 * 历史 "auto" / null / 非法值统一归一化为默认桌面端。
 */
import { describe, it, expect } from "vitest";
import { normalizeStoredOverride } from "@/lib/useDeviceOverride";

describe("normalizeStoredOverride", () => {
  it("null / 'auto' / 非法值 → 'desktop'（默认桌面）", () => {
    expect(normalizeStoredOverride(null)).toBe("desktop");
    expect(normalizeStoredOverride("auto")).toBe("desktop");
    expect(normalizeStoredOverride("xxx")).toBe("desktop");
    expect(normalizeStoredOverride("")).toBe("desktop");
  });

  it("合法值原样保留", () => {
    expect(normalizeStoredOverride("mobile")).toBe("mobile");
    expect(normalizeStoredOverride("desktop")).toBe("desktop");
  });
});
