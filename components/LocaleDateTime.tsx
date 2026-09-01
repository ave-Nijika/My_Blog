"use client";

import { useLocale } from "@/lib/i18n/context";

export function LocaleDateTime({ date }: { date: Date | string }) {
  const { locale } = useLocale();
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return (
    <time dateTime={dateObj.toISOString()}>
      {dateObj.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US")}
    </time>
  );
}