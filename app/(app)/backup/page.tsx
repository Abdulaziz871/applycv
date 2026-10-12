"use client";

import { AlertTriangle, DatabaseBackup, Download, FileUp, Info, ShieldCheck } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button, Card, ConfirmDialog, Field, Notice, PageHeader, Select, useToast } from "@/components/ui";
import {
  backupFileName,
  buildBackup,
  mergeSnapshots,
  parseBackup,
  snapshotFromBackup,
  summarizeBackup,
} from "@/lib/backup";
import { formatDate, saveBlob } from "@/lib/download";
import { defaultSettings, type Backup, type OutputLanguage } from "@/lib/schemas";
import {
  getLastBackupAt,
  getSettings,
  readSnapshot,
  setLastBackupAt,
  setSettings,
  writeSnapshot,
} from "@/lib/storage";
import { useStoredValue } from "@/lib/use-storage";

type Mode = "replace" | "merge";

export default function BackupPage() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { value: lastBackupAt } = useStoredValue(getLastBackupAt, null as string | null);
  const { value: settings } = useStoredValue(getSettings, defaultSettings());
  const { value: current } = useStoredValue(
    useCallback(async () => {
      const s = await readSnapshot();
      return { applications: s.applications.length, hasCv: !!s.masterCv };
    }, []),
    { applications: 0, hasCv: false },
  );

  const [pending, setPending] = useState<{ backup: Backup; fileName: string } | null>(null);
  const [importError, setImportError] = useState("");
  const [mode, setMode] = useState<Mode>("merge");
  const [confirmReplace, setConfirmReplace] = useState(false);

  async function exportBackup() {
    const now = new Date();
    const backup = buildBackup(await readSnapshot(), now);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    saveBlob(blob, backupFileName(now));
    await setLastBackupAt(now.toISOString());
    toast("تم تصدير النسخة الاحتياطية. احتفظ بالملف في مكان آمن.");
  }

  async function onFile(file: File | undefined) {
    setImportError("");
    setPending(null);
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      setImportError("الملف كبير جداً ولا يبدو نسخة احتياطية.");
      return;
    }
    const text = await file.text().catch(() => "");
    const result = parseBackup(text);
    if (!result.ok) {
      setImportError(result.error);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setPending({ backup: result.backup, fileName: file.name });
  }

  async function applyImport() {
    if (!pending) return;
    const incoming = pending.backup;
    const snapshot =
      mode === "replace" ? snapshotFromBackup(incoming) : mergeSnapshots(await readSnapshot(), incoming);
    const ok = await writeSnapshot(snapshot);
    if (!ok) {
      toast("تعذّر حفظ البيانات: مساحة تخزين المتصفح غير كافية أو غير متاحة.", "error");
      return;
    }
    setPending(null);
    setConfirmReplace(false);
    if (fileRef.current) fileRef.current.value = "";
    toast(mode === "replace" ? "تم استبدال البيانات بالنسخة الاحتياطية." : "تم دمج النسخة الاحتياطية مع بياناتك.");
  }

  const summary = pending ? summarizeBackup(pending.backup) : null;

  return (
    <div className="space-y-5">
      <PageHeader title="النسخ الاحتياطي" subtitle="بياناتك محفوظة في هذا المتصفح فقط — خذ نسخة احتياطية بانتظام." />

      <Notice tone="info">
        <p className="font-medium">لماذا النسخ الاحتياطي مهم؟</p>
        <p className="mt-1">
          لا توجد قاعدة بيانات: سيرتك وسجل تقديماتك يعيشان داخل هذا المتصفح وعلى هذا الجهاز فقط. إذا مسحت بيانات
          المتصفح أو غيّرت الجهاز أو المتصفح فستختفي. الملف الاحتياطي يعيدها لك، ويمكنك أيضاً نقلها إلى جهاز آخر.
        </p>
      </Notice>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <DatabaseBackup className="size-5 text-primary" aria-hidden /> تصدير نسخة احتياطية
            </h2>
            <p className="mt-1 text-[15px] text-muted">
              آخر نسخة احتياطية:{" "}
              <span className="font-medium text-text" data-testid="last-backup">
                {lastBackupAt ? formatDate(lastBackupAt) : "لم تؤخذ بعد"}
              </span>
            </p>
            <p className="mt-2 flex items-center gap-2 text-[13.5px] text-muted">
              <ShieldCheck className="size-4 text-success" aria-hidden />
              الملف لا يحتوي كلمة السر ولا أي بيانات دخول أو رموز Gmail.
            </p>
          </div>
          <Button variant="primary" size="lg" onClick={exportBackup} data-testid="export-btn">
            <Download className="size-4" /> تصدير نسخة احتياطية
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <FileUp className="size-5 text-primary" aria-hidden /> استيراد نسخة احتياطية
        </h2>
        <p className="mt-1 text-[15px] text-muted">اختر ملف <span dir="ltr">muqaddim-backup-….json</span> الذي صدّرته سابقاً.</p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          data-testid="import-input"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="mt-4 block w-full text-[15px] file:me-3 file:cursor-pointer file:rounded-[12px] file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-[15px] file:font-medium hover:file:bg-surface-muted"
        />

        {importError && (
          <Notice tone="danger" className="mt-4">
            {importError}
          </Notice>
        )}

        {pending && summary && (
          <div className="mt-5 space-y-4 rounded-[14px] border border-border bg-background/60 p-4" data-testid="import-summary">
            <h3 className="font-semibold">محتوى الملف</h3>
            <dl className="grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted">السيرة</dt>
                <dd>{summary.cvName ?? "لا توجد"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">عدد التقديمات</dt>
                <dd>{summary.applications}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">تاريخ النسخة</dt>
                <dd>{formatDate(summary.exportedAt)}</dd>
              </div>
            </dl>

            <Field label="طريقة الاستيراد">
              {(id) => (
                <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                  <option value="merge">دمج مع الحالية (يُبقي الأحدث لكل تقديم)</option>
                  <option value="replace">استبدال البيانات الحالية</option>
                </Select>
              )}
            </Field>

            {mode === "replace" && (current.applications > 0 || current.hasCv) && (
              <Notice tone="warning">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  سيتم حذف بياناتك الحالية ({current.applications} تقديم) واستبدالها بمحتوى الملف.
                </span>
              </Notice>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                data-testid="import-confirm"
                onClick={() => (mode === "replace" && (current.applications > 0 || current.hasCv) ? setConfirmReplace(true) : void applyImport())}
              >
                {mode === "replace" ? "استبدال البيانات" : "دمج البيانات"}
              </Button>
              <Button variant="ghost" onClick={() => setPending(null)}>
                إلغاء
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">الإعدادات</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="لغة المخرجات الافتراضية">
            {(id) => (
              <Select
                id={id}
                value={settings.defaultOutputLanguage}
                onChange={async (e) => {
                  await setSettings({ ...settings, defaultOutputLanguage: e.target.value as OutputLanguage });
                  toast("تم حفظ الإعداد.");
                }}
              >
                <option value="auto">تلقائي (حسب لغة الوظيفة)</option>
                <option value="ar">العربية</option>
                <option value="en">English</option>
                <option value="cv">نفس لغة السيرة</option>
              </Select>
            )}
          </Field>
        </div>
        <p className="mt-3 flex items-center gap-2 text-[13.5px] text-muted">
          <Info className="size-4" aria-hidden /> الحد اليومي للإرسال يُضبط من صفحة «الإرسال بالإيميل».
        </p>
      </Card>

      <ConfirmDialog
        open={confirmReplace}
        title="استبدال كل بياناتك الحالية؟"
        description="سيتم حذف السيرة والسجل الحاليين في هذا المتصفح واستبدالهما بمحتوى الملف. لا يمكن التراجع (إلا بنسخة احتياطية أخرى)."
        confirmLabel="نعم، استبدل"
        danger
        onConfirm={applyImport}
        onCancel={() => setConfirmReplace(false)}
      />
    </div>
  );
}
