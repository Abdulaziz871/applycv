"use client";

import clsx from "clsx";
import { Briefcase, DatabaseBackup, FileText, History, LogOut, Mail, Send, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { daysSince } from "@/lib/backup";
import { getLastBackupAt, hasAnyData, isStorageAvailable } from "@/lib/storage";
import { useStoredValue } from "@/lib/use-storage";
import { Button, Notice } from "./ui";

const NAV = [
  { href: "/cv", label: "سيرتي", icon: FileText },
  { href: "/apply", label: "وظيفة جديدة", icon: Send },
  { href: "/send", label: "الإرسال بالإيميل", icon: Mail },
  { href: "/linkedin", label: "LinkedIn", icon: Briefcase },
  { href: "/history", label: "السجل", icon: History },
  { href: "/backup", label: "النسخ الاحتياطي", icon: DatabaseBackup },
];

const BACKUP_REMINDER_DAYS = 14;

const loadShellState = async () => ({
  hasData: await hasAnyData(),
  lastBackupAt: await getLastBackupAt(),
  storageOk: isStorageAvailable(),
});

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { value: state, loading } = useStoredValue(loadShellState, {
    hasData: false,
    lastBackupAt: null as string | null,
    storageOk: true,
  });

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  const onBackupPage = pathname.startsWith("/backup");
  const age = daysSince(state.lastBackupAt);
  const needsBackup = state.hasData && (age === null || age >= BACKUP_REMINDER_DAYS);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link href="/apply" className="flex items-center gap-2.5 text-lg font-bold text-primary">
            <span className="grid size-8 place-items-center rounded-[10px] bg-primary text-sm text-white" aria-hidden>
              م
            </span>
            مُقدِّم
          </Link>
          <nav className="mx-2 hidden flex-1 items-center gap-1 md:flex" aria-label="التنقل الرئيسي">
            {NAV.map((n) => (
              <NavLink key={n.href} {...n} active={pathname.startsWith(n.href)} />
            ))}
          </nav>
          <div className="flex-1 md:hidden" />
          <button
            onClick={logout}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface-muted hover:text-text"
          >
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">تسجيل الخروج</span>
            <span className="sm:hidden">خروج</span>
          </button>
        </div>
        <nav
          className="flex gap-1 overflow-x-auto border-t border-border/60 px-3 py-1.5 md:hidden"
          aria-label="التنقل الرئيسي"
        >
          {NAV.map((n) => (
            <NavLink key={n.href} {...n} active={pathname.startsWith(n.href)} />
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8">
        {!loading && !onBackupPage && (
          <div className="mb-5 space-y-3">
            {!state.storageOk && (
              <Notice tone="warning">
                المتصفح يمنع حفظ البيانات (ربما وضع التصفح الخاص). ستعمل الصفحة، لكن لن تُحفظ بياناتك بعد إغلاقها.
              </Notice>
            )}
            {state.storageOk && !state.hasData && (
              <Notice tone="info">
                لا توجد بيانات محفوظة في هذا المتصفح. إن كانت لديك نسخة احتياطية سابقة يمكنك{" "}
                <Link href="/backup" className="font-semibold underline underline-offset-4">
                  استعادتها من صفحة النسخ الاحتياطي
                </Link>
                .
              </Notice>
            )}
            {needsBackup && (
              <Notice tone="warning">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <ShieldAlert className="size-4 shrink-0" aria-hidden />
                    خذ نسخة احتياطية حتى ما تضيع بياناتك.
                  </span>
                  <Link href="/backup">
                    <Button size="sm" variant="secondary">
                      خذ نسخة الآن
                    </Button>
                  </Link>
                </div>
              </Notice>
            )}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof FileText;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex shrink-0 items-center gap-2 rounded-[10px] px-3 py-1.5 text-[15px] transition-colors",
        active ? "bg-primary-soft font-semibold text-primary" : "text-muted hover:bg-surface-muted hover:text-text",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
