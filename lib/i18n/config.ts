export const LOCALE_COOKIE = "locale";
export const THEME_STORAGE = "theme";

export type Locale = "zh-CN" | "en";
export type Theme = "light" | "dark" | "system";

export const SUPPORTED_LOCALES: Locale[] = ["zh-CN", "en"] as const;
export const DEFAULT_LOCALE: Locale = "zh-CN" as const;
export const DEFAULT_THEME: Theme = "system" as const;

export { DEFAULT_LOCALE as defaultLocale };

export function getBrowserLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  
  const browserLang = navigator.language || navigator.languages?.[0];
  if (browserLang?.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }
  if (browserLang?.toLowerCase().startsWith("en")) {
    return "en";
  }
  return DEFAULT_LOCALE;
}

export function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}