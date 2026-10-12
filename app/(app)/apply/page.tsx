"use client";

import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Mail,
  Sparkles,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import { Stepper } from "@/components/ReviewParts";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "@/components/ui";
import { downloadCvDocx, downloadCvPdf } from "@/lib/download";
import { normalizeEmail } from "@/lib/gmail-mime";
import { contactedEmails, defaultSubject } from "@/lib/send-queue";
import { pdfFileName } from "@/lib/filename";
import type { Cv, OutputLanguage, TailorResponse } from "@/lib/schemas";
import {
  getDraft,
  getQueue,
  getSentLog,
  listApplications,
  setQueue,
  getMasterCv,
  getSettings,
  saveApplication,
  setDraft,
  type Draft,
} from "@/lib/storage";
import { useStoredValue } from "@/lib/use-storage";
import { defaultSettings } from "@/lib/schemas";

interface Result {
  original: Cv;
  current: Cv;
  coverLetter: string;
  reasons: Record<string, string>;
  missingSkills: string[];
  warnings: string[];
  language: "ar" | "en";
  coverLetterFallback: boolean;
  hasJobDescription: boolean;
  applicationId: string;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const OUTPUT_OPTIONS: { value: OutputLanguage; label: string }[] = [
  { value: "auto", label: "تلقائي (حسب لغة الوظيفة)" },
  { value: "ar", label: "العربية" },
  { value: "en", label: "English" },
  { value: "cv", label: "نفس لغة السيرة" },
];

export default function ApplyPage() {
  const toast = useToast();
  const router = useRouter();
  const { value: master, loading } = useStoredValue(getMasterCv, null as Cv | null);
  const { value: settings } = useStoredValue(getSettings, defaultSettings());
  const { value: draft } = useStoredValue(getDraft, null as Draft | null);

  const [step, setStep] = useState(0);
  const [jobDescription, setJobDescription] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage | null>(null);
  const [busy, setBusy] = useState<"tailor" | "asis" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [approved, setApproved] = useState(false);
  const [downloading, setDownloading] = useState<"pdf" | "docx" | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [dismissedDraft, setDismissedDraft] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [emailError, setEmailError] = useState("");

  const language = outputLanguage ?? settings.defaultOutputLanguage;

  // ---- autosave draft while a review is in progress (debounced) ----
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!result || step === 0) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void setDraft({
        savedAt: new Date().toISOString(),
        step: Math.min(step, 1),
        original: result.original,
        current: result.current,
        jobDescription,
        company,
        jobTitle,
        outputLanguage: language,
        coverLetter: result.coverLetter,
        reasons: result.reasons,
        missingSkills: result.missingSkills,
        warnings: result.warnings,
        language: result.language,
        hasJobDescription: result.hasJobDescription,
        applicationId: result.applicationId,
      });
    }, 700);
    return () => clearTimeout(saveTimer.current);
  }, [result, step, jobDescription, company, jobTitle, language]);

  const patchResult = useCallback((patch: Partial<Result>) => {
    setApproved(false); // any edit invalidates a previous approval
    setResult((r) => (r ? { ...r, ...patch } : r));
  }, []);

  async function run(mode: "tailor" | "asis") {
    if (!master) return;
    setBusy(mode);
    setError("");
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cv: master,
          jobDescription: mode === "tailor" ? jobDescription : "",
          company,
          jobTitle,
          outputLanguage: language,
          mode,
        }),
      });
      const data = (await res.json().catch(() => null)) as (TailorResponse & { error?: string }) | null;
      if (!res.ok || !data || data.error) {
        setError(data?.error ?? "حدث خطأ غير متوقع، حاول مرة أخرى.");
        return;
      }
      setResult({
        original: master,
        current: data.cv,
        coverLetter: data.coverLetter,
        reasons: data.reasons,
        missingSkills: data.missingSkills,
        warnings: data.warnings,
        language: data.language,
        coverLetterFallback: data.coverLetterFallback,
        hasJobDescription: mode === "tailor",
        applicationId: newId(),
      });
      setApproved(false);
      setDownloaded(false);
      setStep(1);
      window.scrollTo({ top: 0 });
    } catch {
      setError("تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.");
    } finally {
      setBusy(null);
    }
  }

  function resumeDraft() {
    if (!draft) return;
    setJobDescription(draft.jobDescription);
    setCompany(draft.company);
    setJobTitle(draft.jobTitle);
    setOutputLanguage(draft.outputLanguage);
    setResult({
      original: draft.original,
      current: draft.current,
      coverLetter: draft.coverLetter,
      reasons: draft.reasons,
      missingSkills: draft.missingSkills,
      warnings: draft.warnings,
      language: draft.language,
      coverLetterFallback: false,
      hasJobDescription: draft.hasJobDescription,
      applicationId: draft.applicationId,
    });
    setApproved(false);
    setStep(1);
  }

  /** Only reachable from the review step through the explicit approval checkbox. */
  async function approve() {
    if (!result || !approved) return;
    const now = new Date().toISOString();
    const ok = await saveApplication({
      id: result.applicationId,
      createdAt: now,
      updatedAt: now,
      company: company.trim(),
      jobTitle: jobTitle.trim(),
      hasJobDescription: result.hasJobDescription,
      language: result.language,
      cv: result.current,
      coverLetter: result.coverLetter,
    });
    if (!ok) toast("تعذّر حفظ التقديم في السجل (التخزين ممتلئ أو غير متاح).", "error");
    setStep(2);
    window.scrollTo({ top: 0 });
  }

  async function download(format: "pdf" | "docx") {
    if (!result || !approved || step !== 2) return; // gate: nothing leaves before approval
    setDownloading(format);
    const save = format === "pdf" ? downloadCvPdf : downloadCvDocx;
    const { error: err } = await save(result.current, company);
    setDownloading(null);
    if (err) {
      toast(err, "error");
      return;
    }
    setDownloaded(true);
    toast(format === "pdf" ? "تم تنزيل ملف PDF." : "تم تنزيل ملف Word.");
  }

  /** Adds the approved application to the send queue; the actual sending happens on /send. */
  async function queueForEmail() {
    if (!result || !approved) return;
    const email = normalizeEmail(recipient);
    if (!email) {
      setEmailError("عنوان البريد غير صالح.");
      return;
    }
    const contacted = contactedEmails(await getSentLog(), await listApplications());
    const queue = await getQueue();
    if (contacted.has(email)) return setEmailError("سبق إرسال تقديم لهذا البريد.");
    if (queue.some((i) => i.email === email)) return setEmailError("هذا البريد موجود في طابور الإرسال.");
    const ok = await setQueue([
      ...queue,
      {
        id: result.applicationId,
        email,
        company: company.trim(),
        position: jobTitle.trim(),
        jobDescription: jobDescription.slice(0, 15000),
        prep: "ready",
        approved: true, // already reviewed and approved in this flow
        send: "waiting",
        subject: defaultSubject(result.language, result.current.name, jobTitle.trim()),
        review: {
          original: result.original,
          current: result.current,
          coverLetter: result.coverLetter,
          reasons: result.reasons,
          missingSkills: result.missingSkills,
          warnings: result.warnings,
          language: result.language,
          coverLetterFallback: result.coverLetterFallback,
          hasJobDescription: result.hasJobDescription,
        },
      },
    ]);
    if (!ok) return setEmailError("تعذّر الحفظ: مساحة التخزين ممتلئة.");
    void setDraft(null);
    router.push("/send");
  }

  function startOver() {
    void setDraft(null);
    setResult(null);
    setStep(0);
    setJobDescription("");
    setCompany("");
    setJobTitle("");
    setApproved(false);
    setDownloaded(false);
    setDismissedDraft(true);
    setError("");
  }

  // ---------------------------------------------------------------- render

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!master) {
    return (
      <EmptyState
        icon={<FileText className="size-7" />}
        title="ابدأ برفع سيرتك الذاتية"
        description="نحتاج سيرتك الذاتية (ملف Word) مرة واحدة فقط، ثم نستخدمها لكل وظيفة تقدّم عليها."
        action={
          <Link href="/cv">
            <Button variant="primary" size="lg">
              رفع السيرة الذاتية
            </Button>
          </Link>
        }
      />
    );
  }

  const jdReady = jobDescription.trim().length >= 30;

  return (
    <div>
      <PageHeader title="وظيفة جديدة" subtitle="خصّص سيرتك ورسالتك للوظيفة، راجع كل شيء، ثم نزّل ملف PDF." />
      <Stepper current={step} />

      {/* ---------------- Step 1: job ---------------- */}
      {step === 0 && (
        <div className="space-y-5">
          {draft && !dismissedDraft && (
            <Notice tone="info">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>لديك تقديم غير مكتمل{draft.company ? ` (${draft.company})` : ""}.</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={resumeDraft}>
                    متابعة
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void setDraft(null);
                      setDismissedDraft(true);
                    }}
                  >
                    تجاهل
                  </Button>
                </span>
              </div>
            </Notice>
          )}

          <Card>
            <div className="space-y-5">
              <Field
                label="وصف الوظيفة (اختياري)"
                hint="الصق نص الإعلان بالعربية أو الإنجليزية. بدونه تُستخدم سيرتك كما هي مع رسالة تقديم عامة."
              >
                {(id) => (
                  <Textarea
                    id={id}
                    rows={10}
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="الصق وصف الوظيفة هنا…"
                    maxLength={15000}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="اسم الشركة (اختياري)">
                  {(id) => <Input id={id} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} />}
                </Field>
                <Field label="المسمى الوظيفي (اختياري)">
                  {(id) => <Input id={id} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={200} />}
                </Field>
                <Field label="لغة المخرجات">
                  {(id) => (
                    <Select id={id} value={language} onChange={(e) => setOutputLanguage(e.target.value as OutputLanguage)}>
                      {OUTPUT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>

              {error && <Notice tone="danger">{error}</Notice>}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="secondary" size="lg" onClick={() => run("asis")} loading={busy === "asis"} disabled={busy !== null}>
                  استخدام السيرة كما هي
                </Button>
                <Button variant="primary" size="lg" onClick={() => run("tailor")} loading={busy === "tailor"} disabled={!jdReady || busy !== null}>
                  <Wand2 className="size-4" /> تخصيص السيرة
                </Button>
              </div>
              {busy === "tailor" && (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="size-4 animate-spin" /> جارٍ تخصيص السيرة وكتابة الرسالة… قد يستغرق ذلك حتى نصف دقيقة.
                </p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ---------------- Step 2: review ---------------- */}
      {step === 1 && result && (
        <div>
          <ReviewWorkspace data={result} onChange={patchResult} />

          <div className="sticky bottom-0 -mx-4 mt-8 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-3 text-[15px]">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                  className="size-5 accent-[#3f6b6a]"
                  data-testid="approve-checkbox"
                />
                راجعت السيرة والرسالة
              </label>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  رجوع
                </Button>
                <Button variant="primary" size="lg" disabled={!approved} onClick={approve} data-testid="continue-btn">
                  متابعة <ArrowRight className="size-4 rotate-180" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Step 3: finish ---------------- */}
      {step === 2 && result && approved && (
        <div className="mx-auto max-w-2xl space-y-5">
          <Card className="text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-add text-success">
              <CheckCircle2 className="size-7" />
            </div>
            <h2 className="text-xl font-semibold">جاهز للتنزيل</h2>
            <p className="mx-auto mt-1 max-w-md text-[15px] text-muted">
              اعتمدتَ السيرة ورسالة التقديم، وحُفظ هذا التقديم في السجل.
            </p>
            <div className="mt-6 flex flex-col items-center gap-3">
              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => download("pdf")}
                  loading={downloading === "pdf"}
                  disabled={downloading !== null}
                  data-testid="download-pdf"
                >
                  <Download className="size-4" /> تنزيل PDF
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => download("docx")}
                  loading={downloading === "docx"}
                  disabled={downloading !== null}
                  data-testid="download-docx"
                >
                  <FileText className="size-4" /> تنزيل Word
                </Button>
              </div>
              <p className="text-[13px] text-muted" dir="ltr">
                {pdfFileName(result.current.name, company)}
              </p>
              {downloaded && <p className="text-sm text-success">تم التنزيل ✓</p>}
              <div className="mt-2 w-full border-t border-border pt-4">
                {!emailOpen ? (
                  <Button variant="secondary" onClick={() => setEmailOpen(true)} data-testid="email-open">
                    <Mail className="size-4" /> إرسال بالإيميل
                  </Button>
                ) : (
                  <div className="mx-auto max-w-sm space-y-3 text-start">
                    <Field label="بريد الجهة المستلمة" hint="تُضاف للطابور، وتبدأ بالإرسال من صفحة «الإرسال بالإيميل» بعد ربط Gmail.">
                      {(id) => (
                        <Input
                          id={id}
                          type="email"
                          dir="ltr"
                          value={recipient}
                          placeholder="hr@company.com"
                          data-testid="email-recipient"
                          onChange={(e) => {
                            setRecipient(e.target.value);
                            setEmailError("");
                          }}
                        />
                      )}
                    </Field>
                    {emailError && <Notice tone="danger">{emailError}</Notice>}
                    <div className="flex gap-2">
                      <Button variant="primary" onClick={queueForEmail} disabled={!recipient.trim()} data-testid="email-queue">
                        أضف للطابور
                      </Button>
                      <Button variant="ghost" onClick={() => setEmailOpen(false)}>
                        إلغاء
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">رسالة التقديم</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.coverLetter);
                    toast("تم نسخ الرسالة.");
                  } catch {
                    toast("تعذّر النسخ.", "error");
                  }
                }}
              >
                نسخ
              </Button>
            </div>
            <p dir="auto" className="whitespace-pre-wrap text-[15px] leading-8 text-muted">
              {result.coverLetter}
            </p>
          </Card>

          <div className="flex flex-wrap justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setApproved(false);
                setStep(1);
              }}
            >
              رجوع للمراجعة
            </Button>
            <div className="flex gap-2">
              <Link href="/history">
                <Button variant="secondary">السجل</Button>
              </Link>
              <Button variant="primary" onClick={startOver}>
                <Sparkles className="size-4" /> تقديم جديد
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
