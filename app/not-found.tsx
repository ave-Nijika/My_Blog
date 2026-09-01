"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { Reveal } from "@/components/Reveal";

export default function NotFound() {
  const { t } = useLocale();

  return (
    <div className="relative mx-auto flex max-w-3xl flex-col items-center justify-center px-4 py-24 text-center">
      {/* 官网式描边大字 404 */}
      <span className="ba-outline-text select-none text-[110px] opacity-40 sm:text-[150px]" aria-hidden>
        404
      </span>
      <Reveal translateY={10} className="-mt-8 flex flex-col items-center sm:-mt-12">
        <span className="ba-tri mb-5 h-4 w-5" aria-hidden />
        <h1 className="ba-font-round mb-3 text-2xl text-[color:rgb(var(--color-text-primary))] dark:text-slate-100">
          {t("page").notFoundTitle}
        </h1>
        <p className="mb-7 text-sm text-slate-600 dark:text-slate-300 max-sm:text-sm">
          {t("page").notFoundHint}
        </p>
        <Link href="/" className="ba-btn ba-btn-primary px-6 py-2 text-sm">
          {t("common").backToHome}
        </Link>
      </Reveal>
    </div>
  );
}
