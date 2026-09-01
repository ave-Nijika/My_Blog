import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";

type Props = {
  href: string;
  label: string;
  disabled?: boolean;
};

export function AdminNavLink({ href, label, disabled = false }: Props) {
  const { t } = useLocale();
  
  if (disabled) {
    return (
      <span
        className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-slate-400 dark:border-slate-700 dark:text-slate-500"
        aria-disabled="true"
        title={t("admin").comingSoon}
      >
        {label}
      </span>
    );
  }
  
  return (
    <Link
      href={href}
      className="ba-btn px-3 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      {label}
    </Link>
  );
}