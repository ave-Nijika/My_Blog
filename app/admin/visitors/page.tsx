/**
 * /admin/visitors
 *
 * Visitor risk list + manual warn/ban/unban.
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zh } from "@/lib/i18n/zh";
import { en } from "@/lib/i18n/en";
import { LogoutButton } from "../LogoutButton";
import { listActiveBans, listVisitorRisks } from "@/lib/visitor";
import { VisitorManager } from "./VisitorManager";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Visitors",
  robots: { index: false, follow: false },
};

type BanJson = {
  id: string;
  matchType: "ip" | "visitor";
  expiresAt: string | null;
  permanent: boolean;
  reason: string;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
};

export default async function AdminVisitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; perPage?: string }>;
}) {
  await requireAdmin();
  const { page: rawPage, perPage: rawPerPage } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, Number.parseInt(rawPerPage ?? "20", 10) || 20)
  );

  const [risks, bans] = await Promise.all([
    listVisitorRisks({ page, perPage }),
    listActiveBans(),
  ]);

  const ipBanMap = new Map<string, BanJson>();
  const tokenBanMap = new Map<string, BanJson>();
  for (const b of bans) {
    const json: BanJson = {
      id: b.id,
      matchType: b.matchType,
      expiresAt: b.expiresAt?.toISOString() ?? null,
      permanent: b.permanent,
      reason: b.reason,
      createdAt: b.createdAt.toISOString(),
      createdBy: b.createdBy,
      revokedAt: b.revokedAt?.toISOString() ?? null,
      revokedBy: b.revokedBy,
    };
    if (b.ipHmac) ipBanMap.set(b.ipHmac, json);
    if (b.visitorTokenHash) tokenBanMap.set(b.visitorTokenHash, json);
  }

  const items = risks.items.map((r) => ({
    ...r,
    activeBan: ipBanMap.get(r.ipHmac) ?? tokenBanMap.get(r.visitorTokenHash) ?? null,
  }));

  const locale =
    (await cookies()).get("locale")?.value === "en" ? "en" : DEFAULT_LOCALE;
  const a = (locale === "en" ? en : zh).admin;
  const t = a.visitorsSection;
  const threshold = process.env.COMMENT_AUTO_BAN_THRESHOLD?.trim() || "3";

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Link href="/admin" className="hover:text-sky-600 dark:hover:text-sky-300">
              ← {t.backToDashboard}
            </Link>
            <span>/</span>
            <span>{t.title}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            {t.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t.thresholdHint.replace("{{total}}", String(risks.total)).replace("{{threshold}}", threshold)}
          </p>
        </div>
        <LogoutButton />
      </header>

      <VisitorManager items={items} page={page} perPage={perPage} total={risks.total} />
    </div>
  );
}