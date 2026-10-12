"use client";

import { Save, Undo2, Upload } from "lucide-react";
import { useState } from "react";
import { CvDropzone } from "@/components/CvDropzone";
import { CvEditor } from "@/components/CvEditor";
import { Button, ConfirmDialog, Notice, PageHeader, Skeleton, useToast } from "@/components/ui";
import type { Cv } from "@/lib/schemas";
import { getMasterCv, setMasterCv } from "@/lib/storage";
import { useStoredValue } from "@/lib/use-storage";

export default function CvPage() {
  const toast = useToast();
  const { value: master, loading } = useStoredValue(getMasterCv, null as Cv | null);
  const [working, setWorking] = useState<Cv | null>(null); // unsaved edits or freshly parsed CV
  const [fresh, setFresh] = useState(false); // working came from a new upload
  const [replacing, setReplacing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const cv = working ?? master;
  const dirty = working !== null;

  async function save() {
    if (!working) return;
    if (!working.name.trim()) {
      toast("اكتب الاسم أولاً.", "error");
      return;
    }
    const ok = await setMasterCv(working);
    if (!ok) {
      toast("تعذّر الحفظ: مساحة تخزين المتصفح ممتلئة أو غير متاحة.", "error");
      return;
    }
    setWorking(null);
    setFresh(false);
    setReplacing(false);
    toast("تم حفظ سيرتك الذاتية.");
  }

  function discard() {
    setWorking(null);
    setFresh(false);
    setReplacing(false);
    setConfirmDiscard(false);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // No CV yet (or user is replacing it): upload screen
  if (!cv || replacing) {
    return (
      <div>
        <PageHeader
          title={cv ? "استبدال السيرة الذاتية" : "سيرتي الذاتية"}
          subtitle="ارفع سيرتك بصيغة Word مرة واحدة، وسنحوّلها إلى بيانات قابلة للتعديل."
          action={
            replacing && (
              <Button variant="ghost" onClick={() => setReplacing(false)}>
                رجوع
              </Button>
            )
          }
        />
        <CvDropzone
          onParsed={(parsed) => {
            setWorking(parsed);
            setFresh(true);
            setReplacing(false);
            toast("تمت قراءة السيرة. راجعها وصحّح أي خطأ ثم احفظ.", "info");
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="سيرتي الذاتية"
        subtitle="هذه نسختك الأساسية. يمكنك تعديلها في أي وقت، وستُستخدم كأصل لكل تقديم جديد."
        action={
          <Button variant="secondary" onClick={() => setReplacing(true)}>
            <Upload className="size-4" /> استبدال بملف جديد
          </Button>
        }
      />

      {fresh && (
        <Notice tone="warning" className="mb-5">
          قد يخطئ القارئ الآلي في بعض التفاصيل. راجع كل قسم بعناية وصحّحه قبل الحفظ.
        </Notice>
      )}

      <CvEditor value={cv} onChange={(next) => setWorking(next)} />

      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted">{dirty ? "لديك تعديلات غير محفوظة." : "كل التعديلات محفوظة."}</span>
          <div className="flex gap-2">
            {dirty && (
              <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>
                <Undo2 className="size-4" /> تجاهل التعديلات
              </Button>
            )}
            <Button variant="primary" onClick={save} disabled={!dirty}>
              <Save className="size-4" /> حفظ السيرة
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="تجاهل التعديلات؟"
        description="ستُفقد التعديلات غير المحفوظة."
        confirmLabel="تجاهل"
        danger
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}

