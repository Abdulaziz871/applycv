"use client";

import { ChevronDown, ChevronUp, Copy, Download, History, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CvPreview } from "@/components/CvPreview";
import { Button, Card, ConfirmDialog, EmptyState, PageHeader, Skeleton, useToast } from "@/components/ui";
import { downloadCvDocx, downloadCvPdf, formatDate } from "@/lib/download";
import type { Application } from "@/lib/schemas";
import { deleteApplication, listApplications } from "@/lib/storage";
import { useStoredValue } from "@/lib/use-storage";

export default function HistoryPage() {
  const toast = useToast();
  const { value: apps, loading } = useStoredValue(listApplications, [] as Application[]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Application | null>(null);

  async function download(app: Application, format: "pdf" | "docx") {
    setBusyId(`${app.id}:${format}`);
    const { error } = await (format === "pdf" ? downloadCvPdf : downloadCvDocx)(app.cv, app.company);
    setBusyId(null);
    if (error) toast(error, "error");
    else toast(format === "pdf" ? "تم تنزيل ملف PDF." : "تم تنزيل ملف Word.");
  }

  async function copyLetter(app: Application) {
    try {
      await navigator.clipboard.writeText(app.coverLetter);
      toast("تم نسخ الرسالة.");
    } catch {
      toast("تعذّر النسخ.", "error");
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="السجل" subtitle="كل التقديمات التي اعتمدتها، ويمكنك تنزيلها مجدداً بصيغة PDF أو Word." />

      {apps.length === 0 ? (
        <EmptyState
          icon={<History className="size-7" />}
          title="لا توجد تقديمات بعد"
          description="عندما تعتمد أول تقديم سيظهر هنا مع السيرة ورسالة التقديم."
          action={
            <Link href="/apply">
              <Button variant="primary">وظيفة جديدة</Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {apps.map((app) => {
            const open = openId === app.id;
            return (
              <li key={app.id}>
                <Card as="article" className="!p-4 sm:!p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-[17px] font-semibold" dir="auto">
                        {app.company || "بدون اسم شركة"}
                        {app.jobTitle && <span className="font-normal text-muted"> — {app.jobTitle}</span>}
                      </h2>
                      <p className="mt-0.5 text-sm text-muted">
                        {formatDate(app.createdAt)} · {app.hasJobDescription ? "سيرة مخصّصة" : "سيرة كما هي"}
                        {app.source === "linkedin" && (
                          <>
                            {" · "}
                            {app.jobUrl ? (
                              <a href={app.jobUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                                LinkedIn تلقائي
                              </a>
                            ) : (
                              "LinkedIn تلقائي"
                            )}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => download(app, "pdf")} loading={busyId === `${app.id}:pdf`}>
                        <Download className="size-4" /> PDF
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => download(app, "docx")} loading={busyId === `${app.id}:docx`}>
                        <Download className="size-4" /> Word
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setOpenId(open ? null : app.id)} aria-expanded={open}>
                        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />} عرض
                      </Button>
                      <Button size="sm" variant="ghost" aria-label="حذف التقديم" onClick={() => setToDelete(app)}>
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </div>
                  </div>
                  {open && (
                    <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-2">
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <h3 className="font-semibold">رسالة التقديم</h3>
                          <Button size="sm" variant="ghost" onClick={() => copyLetter(app)}>
                            <Copy className="size-4" /> نسخ
                          </Button>
                        </div>
                        <p dir="auto" className="whitespace-pre-wrap text-[15px] leading-8 text-muted">
                          {app.coverLetter}
                        </p>
                      </div>
                      <CvPreview cv={app.cv} />
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="حذف هذا التقديم؟"
        description="سيُحذف من السجل في هذا المتصفح. (النسخ الاحتياطية السابقة لن تتأثر.)"
        confirmLabel="حذف"
        danger
        onConfirm={async () => {
          if (toDelete) await deleteApplication(toDelete.id);
          setToDelete(null);
          toast("تم الحذف.");
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
