"use client";

import clsx from "clsx";
import {
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  Loader2,
  Mail,
  Pause,
  Play,
  Plug,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { normalizeEmail } from "@/lib/gmail-mime";
import {
  decodeCsvBytes,
  parseCsv,
  rowsToTable,
  SKIP_LABELS_AR,
  tableToCandidates,
  type Candidate,
  type ImportResult,
} from "@/lib/import-rows";
import type { QueueItem, ReviewData, SentLogEntry } from "@/lib/schemas";
import { formatDate } from "@/lib/download";
import type { RunInfo } from "@/lib/use-send-queue";
import { Button, Card, Field, Input, Notice, Textarea } from "./ui";
import { ReviewWorkspace } from "./ReviewWorkspace";

// ---------------------------------------------------------------- Gmail

export interface GmailStatus {
  connected: boolean;
  configured: boolean;
  mock: boolean;
  delayRangeSec: [number, number];
}

export function GmailCard({
  status,
  loading,
  onDisconnect,
}: {
  status: GmailStatus | null;
  loading: boolean;
  onDisconnect: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Mail className="size-5 text-primary" aria-hidden /> حساب Gmail
          </h2>
          {loading ? (
            <p className="mt-1 text-[15px] text-muted">جارٍ التحقق…</p>
          ) : status?.connected ? (
            <p className="mt-1 flex items-center gap-2 text-[15px] text-success" data-testid="gmail-connected">
              <CheckCircle2 className="size-4" aria-hidden /> Gmail مربوط في هذا المتصفح
              {status.mock && <span className="rounded-full bg-modify px-2 text-xs text-[#6d4f14]">وضع تجريبي: لا يُرسل فعلياً</span>}
            </p>
          ) : (
            <p className="mt-1 text-[15px] text-muted" data-testid="gmail-disconnected">
              غير مربوط. اربط حسابك ليُرسل التطبيق نيابةً عنك (بصلاحية الإرسال فقط).
            </p>
          )}
        </div>
        {status?.connected ? (
          <Button variant="secondary" onClick={onDisconnect}>
            <Unplug className="size-4" /> فصل الحساب
          </Button>
        ) : (
          <a href="/api/gmail/connect" data-testid="gmail-connect">
            <Button variant="primary" disabled={loading || status?.configured === false}>
              <Plug className="size-4" /> ربط Gmail
            </Button>
          </a>
        )}
      </div>
      {status && !status.configured && (
        <Notice tone="warning" className="mt-4">
          لم يُضبط ربط Google على الخادم بعد (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). راجع «README» لخطوات إنشاء بيانات OAuth.
        </Notice>
      )}
      <Notice tone="info" className="mt-4">
        <p className="font-medium">لماذا الحد اليومي والفواصل الزمنية؟</p>
        <p className="mt-1">
          الإرسال الجماعي قد يجعل Gmail يصنّف حسابك «مزعجاً» أو يوقفه مؤقتاً. لذلك نرسل رسالة واحدة كل 20–60 ثانية عشوائياً،
          ولا نتجاوز الحد اليومي الذي تحدده. اترك هذه الصفحة مفتوحة أثناء الإرسال.
        </p>
        <p className="mt-1 text-[13.5px]">ملاحظة: في وضع الاختبار لدى Google ينتهي الربط كل 7 أيام، فأعد الربط عند الطلب.</p>
      </Notice>
    </Card>
  );
}

// ---------------------------------------------------------------- Import

export function ImportCard({
  onAdd,
  contacted,
  queued,
  disabled,
}: {
  onAdd: (c: Candidate[]) => void;
  contacted: Set<string>;
  queued: Set<string>;
  disabled: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<(ImportResult & { fileName: string }) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ email: "", company: "", position: "", jobDescription: "" });
  const [manualError, setManualError] = useState("");

  async function readFile(file: File | undefined) {
    setError("");
    setResult(null);
    if (!file) return;
    const name = file.name.toLowerCase();
    if (file.size > 3 * 1024 * 1024) return setError("حجم الملف أكبر من 3 ميغابايت.");
    setBusy(true);
    try {
      let table;
      if (name.endsWith(".csv") || name.endsWith(".txt")) {
        table = parseCsv(decodeCsvBytes(await file.arrayBuffer()));
      } else if (name.endsWith(".xlsx")) {
        const { readSheet } = await import("read-excel-file/browser");
        table = rowsToTable((await readSheet(file)) as unknown[][]);
      } else {
        return setError("الصيغة غير مدعومة. استخدم CSV أو XLSX.");
      }
      const r = tableToCandidates(table, { contacted, queued });
      if (r.error) return setError(r.error);
      setResult({ ...r, fileName: file.name });
    } catch {
      setError("تعذّرت قراءة الملف. تأكد أنه CSV أو XLSX سليم (وليس XLS قديماً).");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function addManual() {
    const email = normalizeEmail(manual.email);
    if (!email) return setManualError("عنوان البريد غير صالح.");
    if (contacted.has(email)) return setManualError("سبق إرسال تقديم لهذا البريد.");
    if (queued.has(email)) return setManualError("هذا البريد موجود في الطابور.");
    onAdd([{ email, company: manual.company.trim(), position: manual.position.trim(), jobDescription: manual.jobDescription.trim().slice(0, 15000) }]);
    setManual({ email: "", company: "", position: "", jobDescription: "" });
    setManualError("");
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <FileSpreadsheet className="size-5 text-primary" aria-hidden /> إضافة جهات للتقديم
      </h2>
      <p className="mt-1 text-[15px] text-muted">
        ارفع ملف CSV أو XLSX بأعمدة: <span dir="ltr">email</span> (مطلوب)، <span dir="ltr">company</span>،{" "}
        <span dir="ltr">position</span>، <span dir="ltr">job_description</span> (اختيارية). يُقرأ الملف داخل متصفحك فقط.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={disabled || busy}
        data-testid="send-file-input"
        onChange={(e) => void readFile(e.target.files?.[0])}
        className="mt-4 block w-full text-[15px] file:me-3 file:cursor-pointer file:rounded-[12px] file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-[15px] file:font-medium hover:file:bg-surface-muted"
      />
      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}

      {result && (
        <div className="mt-4 space-y-3 rounded-[14px] border border-border bg-background/60 p-4" data-testid="import-preview">
          <p className="text-[15px]">
            <span className="font-semibold">{result.candidates.length}</span> بريد صالح جاهز للإضافة من «{result.fileName}»
            {result.skipped.length > 0 && <span className="text-muted"> — وتم تخطي {result.skipped.length}</span>}
          </p>
          {result.skipped.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-auto text-[13.5px] text-muted" data-testid="skipped-list">
              {result.skipped.map((s, i) => (
                <li key={i}>
                  صف {s.row}: <span dir="ltr">{s.value || "—"}</span> — {SKIP_LABELS_AR[s.reason]}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={result.candidates.length === 0}
              data-testid="import-add"
              onClick={() => {
                onAdd(result.candidates);
                setResult(null);
              }}
            >
              أضف {result.candidates.length} للطابور
            </Button>
            <Button variant="ghost" onClick={() => setResult(null)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      <details className="mt-5 rounded-[14px] border border-border p-4">
        <summary className="cursor-pointer text-[15px] font-medium">أو أضف بريداً واحداً يدوياً</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="البريد الإلكتروني">
            {(id) => (
              <Input id={id} type="email" dir="ltr" value={manual.email} data-testid="manual-email" placeholder="hr@company.com"
                onChange={(e) => { setManual({ ...manual, email: e.target.value }); setManualError(""); }} />
            )}
          </Field>
          <Field label="الشركة (اختياري)">
            {(id) => <Input id={id} value={manual.company} data-testid="manual-company" onChange={(e) => setManual({ ...manual, company: e.target.value })} />}
          </Field>
          <Field label="الوظيفة (اختياري)">
            {(id) => <Input id={id} value={manual.position} data-testid="manual-position" onChange={(e) => setManual({ ...manual, position: e.target.value })} />}
          </Field>
          <Field label="وصف الوظيفة (اختياري)" className="sm:col-span-3">
            {(id) => <Textarea id={id} rows={4} value={manual.jobDescription} data-testid="manual-jd" onChange={(e) => setManual({ ...manual, jobDescription: e.target.value })} />}
          </Field>
        </div>
        {manualError && <Notice tone="danger" className="mt-3">{manualError}</Notice>}
        <Button className="mt-3" onClick={addManual} disabled={disabled || !manual.email.trim()} data-testid="manual-add">
          <Plus className="size-4" /> إضافة
        </Button>
      </details>
    </Card>
  );
}

// ---------------------------------------------------------------- Queue

const PREP_LABEL: Record<QueueItem["prep"], string> = {
  pending: "بانتظار التجهيز",
  tailoring: "جارٍ التجهيز…",
  ready: "جاهز للمراجعة",
  failed: "فشل التجهيز",
};

const SEND_LABEL: Record<QueueItem["send"], string> = {
  waiting: "بانتظار الإرسال",
  sending: "جارٍ الإرسال…",
  sent: "أُرسل ✓",
  failed: "فشل الإرسال",
};

function Badge({ tone, children }: { tone: "muted" | "primary" | "success" | "warning" | "danger"; children: React.ReactNode }) {
  const tones = {
    muted: "bg-surface-muted text-muted",
    primary: "bg-primary-soft text-primary",
    success: "bg-add text-[#2f5d45]",
    warning: "bg-modify text-[#6d4f14]",
    danger: "bg-remove text-danger",
  } as const;
  return <span className={clsx("rounded-full px-2.5 py-0.5 text-[13px] font-medium", tones[tone])}>{children}</span>;
}

export function QueueList({
  queue,
  runningId,
  locked,
  onPrepare,
  onReview,
  onUnapprove,
  onRetry,
  onRemove,
}: {
  queue: QueueItem[];
  runningId: string | null;
  /** true while a send run is active: structure of the queue is frozen except per-item revoke */
  locked: boolean;
  onPrepare: (id: string) => void;
  onReview: (id: string) => void;
  onUnapprove: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ul className="space-y-3" data-testid="queue-list">
      {queue.map((i) => {
        const busy = i.send === "sending" || i.id === runningId;
        return (
          <li key={i.id} data-testid="queue-item" data-email={i.email} data-send={i.send} data-prep={i.prep} data-approved={i.approved}>
            <Card as="article" className="!p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold" dir="ltr">{i.email}</p>
                  <p className="mt-0.5 text-sm text-muted" dir="auto">
                    {[i.company, i.position].filter(Boolean).join(" — ") || "بدون شركة / وظيفة"}
                    {" · "}
                    {i.jobDescription.trim().length >= 30 ? "مع وصف وظيفة" : "بدون وصف (سيرة كما هي)"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone={i.prep === "ready" ? "success" : i.prep === "failed" ? "danger" : i.prep === "tailoring" ? "primary" : "muted"}>{PREP_LABEL[i.prep]}</Badge>
                    {i.prep === "ready" && <Badge tone={i.approved ? "success" : "warning"}>{i.approved ? "معتمد" : "غير معتمد"}</Badge>}
                    {(i.send !== "waiting" || i.approved) && <Badge tone={i.send === "sent" ? "success" : i.send === "failed" ? "danger" : "primary"}>{SEND_LABEL[i.send]}</Badge>}
                  </div>
                  {(i.prepError || i.sendError) && <p className="mt-2 text-[13.5px] text-danger">{i.sendError ?? i.prepError}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(i.prep === "pending" || i.prep === "failed") && !locked && (
                    <Button size="sm" variant="secondary" onClick={() => onPrepare(i.id)} data-testid="prep-one">
                      <Sparkles className="size-4" /> تجهيز
                    </Button>
                  )}
                  {i.prep === "tailoring" && <Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ التجهيز" />}
                  {i.prep === "ready" && i.send !== "sent" && !busy && (
                    <Button size="sm" variant={i.approved ? "secondary" : "primary"} onClick={() => onReview(i.id)} data-testid="review-open">
                      <ClipboardCheck className="size-4" /> {i.approved ? "عرض" : "مراجعة"}
                    </Button>
                  )}
                  {i.approved && i.send === "waiting" && (
                    <Button size="sm" variant="ghost" onClick={() => onUnapprove(i.id)}>
                      إلغاء الاعتماد
                    </Button>
                  )}
                  {i.send === "failed" && !locked && (
                    <Button size="sm" variant="secondary" onClick={() => onRetry(i.id)}>
                      <RotateCcw className="size-4" /> إعادة المحاولة
                    </Button>
                  )}
                  {!busy && !(locked && i.approved && i.send === "waiting") && (
                    <Button size="sm" variant="ghost" aria-label={`حذف ${i.email}`} onClick={() => onRemove(i.id)}>
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- Run bar

export function RunBar({
  run,
  approvedCount,
  sentToday,
  cap,
  gmailConnected,
  prepBusy,
  onStart,
  onPause,
  onResume,
  onCancel,
}: {
  run: RunInfo;
  approvedCount: number;
  sentToday: number;
  cap: number;
  gmailConnected: boolean;
  prepBusy: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const remaining = Math.max(0, cap - sentToday);
  const reason = !gmailConnected
    ? "اربط Gmail أولاً"
    : approvedCount === 0
      ? "لا توجد رسائل معتمدة"
      : remaining === 0
        ? "بلغت الحد اليومي"
        : prepBusy
          ? "انتظر انتهاء التجهيز"
          : "";

  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6" data-testid="run-bar" data-run-state={run.state}>
      <div className="mx-auto max-w-[1100px]">
        {run.notice && <Notice tone="warning" className="mb-3">{run.notice}</Notice>}
        {run.state !== "idle" && (
          <Notice tone="info" className="mb-3">
            <span className="font-medium">لا تغلق هذه الصفحة ولا تُغلق المتصفح</span> حتى ينتهي الإرسال. الإرسال يتم من هذا التبويب.
            {run.countdown !== null && (
              <span className="ms-2" data-testid="countdown">
                الرسالة التالية بعد {run.countdown} ثانية{run.state === "paused" && " (متوقف مؤقتاً)"}
              </span>
            )}
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted">
            أُرسل اليوم <span className="font-semibold text-text" data-testid="sent-today">{sentToday}</span> من {cap} · معتمد للإرسال{" "}
            <span className="font-semibold text-text" data-testid="approved-count">{approvedCount}</span>
          </div>
          <div className="flex items-center gap-2">
            {run.state === "idle" ? (
              <>
                {reason && <span className="text-sm text-muted">{reason}</span>}
                <Button variant="primary" size="lg" disabled={!!reason} onClick={onStart} data-testid="start-send">
                  <Play className="size-4" /> بدء الإرسال ({Math.min(approvedCount, remaining)})
                </Button>
              </>
            ) : (
              <>
                {run.state === "running" ? (
                  <Button variant="secondary" onClick={onPause} data-testid="pause-send">
                    <Pause className="size-4" /> إيقاف مؤقت
                  </Button>
                ) : (
                  <Button variant="primary" onClick={onResume} data-testid="resume-send">
                    <Play className="size-4" /> متابعة
                  </Button>
                )}
                <Button variant="danger" onClick={onCancel} data-testid="cancel-send">
                  <Square className="size-4" /> إلغاء
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Review sheet

export function ReviewSheet({
  item,
  onEdit,
  onSubject,
  onApprove,
  onClose,
}: {
  item: QueueItem;
  onEdit: (patch: Partial<ReviewData>) => void;
  onSubject: (s: string) => void;
  onApprove: () => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(false);
  if (!item.review) return null;
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-background" role="dialog" aria-modal="true" aria-label="مراجعة التقديم" data-testid="review-sheet">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate font-semibold" dir="ltr">{item.email}</h2>
            <p className="truncate text-sm text-muted" dir="auto">{[item.company, item.position].filter(Boolean).join(" — ")}</p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="إغلاق"><X className="size-5" /> إغلاق</Button>
        </div>
      </div>
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <ReviewWorkspace
          data={item.review}
          onChange={(patch) => {
            setChecked(false);
            onEdit(patch);
          }}
          beforeLetter={
            <Card>
              <Field label="عنوان الرسالة (Subject)">
                {(id) => (
                  <Input id={id} value={item.subject} maxLength={300} data-testid="subject-input"
                    onChange={(e) => { setChecked(false); onSubject(e.target.value); }} />
                )}
              </Field>
            </Card>
          }
        />
      </div>
      <div className="sticky bottom-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-3 text-[15px]">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="size-5 accent-[#3f6b6a]" data-testid="sheet-approve-checkbox" />
            راجعت السيرة والرسالة
          </label>
          <Button variant="primary" size="lg" disabled={!checked || !item.subject.trim()} onClick={onApprove} data-testid="sheet-approve">
            اعتماد للإرسال
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Sent log

export function SentLogCard({ log }: { log: SentLogEntry[] }) {
  const recent = [...log].sort((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, 15);
  return (
    <Card>
      <h2 className="text-lg font-semibold">سجل الإرسال</h2>
      {recent.length === 0 ? (
        <p className="mt-1 text-[15px] text-muted">لم يُرسل شيء بعد. السجل محفوظ في هذا المتصفح ويدخل ضمن النسخة الاحتياطية.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border" data-testid="sent-log">
          {recent.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14.5px]">
              <span dir="ltr" className="truncate">{e.email}</span>
              <span className="flex items-center gap-2 text-muted">
                {[e.company, e.position].filter(Boolean).join(" — ")}
                <span>{formatDate(e.sentAt)}</span>
                <Badge tone={e.status === "sent" ? "success" : "danger"}>{e.status === "sent" ? "أُرسل" : "فشل"}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
