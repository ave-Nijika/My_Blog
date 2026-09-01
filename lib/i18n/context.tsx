"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { zh } from "./zh";
import { en } from "./en";
import {
  type Locale,
  DEFAULT_LOCALE,
  getBrowserLocale,
  LOCALE_COOKIE,
} from "./config";

type LocaleContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: <K extends keyof typeof zh>(key: K) => typeof zh[K];
};

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

const dictionaries = {
  "zh-CN": zh,
  en,
};

export function LocaleProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    const saved = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${LOCALE_COOKIE}=`))
      ?.split("=")[1];
    
    if (saved && (saved === "zh-CN" || saved === "en")) {
      setLocaleState(saved as Locale);
    } else {
      const browserLocale = getBrowserLocale();
      setLocaleState(browserLocale);
    }
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    document.cookie = `${LOCALE_COOKIE}=${newLocale}; path=/; max-age=31536000`;
  };

  const t = <K extends keyof typeof zh>(key: K): typeof zh[K] => {
    const dict = dictionaries[locale];
    return dict[key] as typeof zh[K];
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (context === undefined) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}