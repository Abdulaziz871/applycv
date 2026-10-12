"use client";

import { ExternalLink, Link2, Play, RefreshCw, Save, TestTube2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { formatDate } from "@/lib/download";
import {
  extensionRequest,
  type ExtensionLogEntry,
  type ExtensionStatus,
  type PendingApplication,
} from "@/lib/extension-bridge";
import { linkedinSettingsSchema, type LinkedinSettings } from "@/lib/linkedin-settings";
import { cvSchema, type Cv } from "@/lib/schemas";
import { getLinkedinSettings, getMasterCv, saveApplication, setLinkedinSettings } from "@/lib/storage";

const STATUS_AR: Record<ExtensionLogEntry["status"], string> = {
  submitted: "قُدّم",
  dry: "تجربة",
  skipped: "تُخطّي",
  failed: "فشل",
};

const lines = (s: string) => s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);

export default function LinkedinPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<LinkedinSettings | null>(null);
  const [cv, setCv] = useState<Cv | null>(null);
  const [ext, setExt] = useState<ExtensionStatus | null>(null);
  const [extChecked, setExtChecked] = useState(false);
  const [log, setLog] = useState<ExtensionLogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshExt = useCallback(async () => {
    const status = await extensionRequest<ExtensionStatus>("status");
    setExt(status);
    setExtChecked(true);
    if (!status) return;
    const data = await extensionRequest<{ log: ExtensionLogEntry[]; pending: PendingApplication[] }>("getLog");
    if (!data) return;
    setLog(data.log);
    // move applications submitted by the extension into the site's history
    const synced: string[] = [];
    for (const p of data.pending) {
      const parsed = cvSchema.safeParse(p.cv);
      if (parsed.success) {
        await saveApplication({
          id: p.id,
          createdAt: p.appliedAt,
          updatedAt: p.appliedAt,
          company: p.company.slice(0, 500),
          jobTitle: p.title.slice(0, 500),
          hasJobDescription: p.hasJobDescription,
          language: p.language,
          cv: parsed.data,
          coverLetter: p.coverLetter.slice(0, 20000),
          source: "linkedin",
          jobUrl: p.url.slice(0, 500),
        });
      }
      synced.push(p.id);
    }
    if (synced.length) await extensionRequest("ackSynced", { ids: synced });
  }, []);

  useEffect(() => {
    (async () => {
      setSettings(await getLinkedinSettings());
      setCv(await getMasterCv());
      await refreshExt();
    })();
    // the bridge announces itself; it may load after this page
    const onHello = (e: MessageEvent) => {
      if (e.source === window && (e.data as { muq?: string; type?: string })?.type === "hello") void refreshExt();
    };
    window.addEventListener("message", onHello);
    const t = setInterval(refreshExt, 15000);
    return () => {
      window.removeEventListener("message", onHello);
      clearInterval(t);
    };
  }, [refreshExt]);

  if (!settings) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const a = settings.answers;
  const patch = (p: Partial<LinkedinSettings>) => setSettings({ ...settings, ...p });
  const patchA = (p: Partial<LinkedinSettings["answers"]>) => setSettings({ ...settings, answers: { ...a, ...p } });

  async function pushToExtension(withToken: boolean) {
    if (!cv) {
      toast("ارفع سيرتك أولاً من صفحة «سيرتي».", "error");
      return false;
    }
    let token: { token: string; expiresAt: string } | null = null;
    if (withToken) {
      const res = await fetch("/api/linkedin/token", { method: "POST" });
      if (!res.ok) {
        toast("تعذّر إنشاء رمز الربط.", "error");
        return false;
      }
      token = await res.json();
    }
    const status = await extensionRequest<ExtensionStatus>(
      "configure",
      { settings, cv, token: token?.token, tokenExpiresAt: token?.expiresAt },
      4000,
    );
    if (!status) {
      toast("الإضافة لا تستجيب. تأكد أنها مثبّتة وأن رابط الموقع محفوظ فيها، ثم حدّث الصفحة.", "error");
      return false;
    }
    setExt(status);
    return true;
  }

  async function save() {
    const parsed = linkedinSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      toast(`تحقق من الحقول: ${parsed.error.issues[0]?.path.join(".")}`, "error");
      return;
    }
    setBusy("save");
    await setLinkedinSettings(parsed.data);
    const pushed = ext ? await pushToExtension(!ext.configured) : false;
    setBusy(null);
    toast(pushed ? "تم الحفظ وإرسال الإعدادات للإضافة." : "تم الحفظ.");
  }

  async function connect() {
    setBusy("connect");
    await setLinkedinSettings(linkedinSettingsSchema.parse(settings));
    const ok = await pushToExtension(true);
    setBusy(null);
    if (ok) toast("تم ربط الإضافة.");
  }

  async function runNow(dry: boolean) {
    setBusy(dry ? "dry" : "run");
    const r = await extensionRequest<{ started: boolean; reason?: string }>("runNow", { dry });
    setBusy(null);
    if (r?.started) toast(dry ? "بدأ التشغيل التجريبي في نافذة جانبية." : "بدأ التقديم في نافذة جانبية.");
    else toast(r?.reason ?? "الإضافة لا تستجيب.", "error");
    setTimeout(refreshExt, 1500);
  }

  const nextRun = ext?.nextRuns[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="التقديم التلقائي على LinkedIn"
        subtitle="إضافة Chrome تبحث عن وظائف Easy Apply المنشورة خلال آخر 24 ساعة، وتخصّص سيرتك لكل وظيفة، وتقدّم عنك في المواعيد التي تحددها."
      />

      <Notice tone="warning">
        LinkedIn يمنع أدوات التقديم الآلي في شروط الاستخدام، وقد يقيّد الحساب إذا كثر النشاط. أبقِ الحد اليومي منخفضاً،
        وجرّب أولاً بوضع «تجربة» قبل تفعيل الإرسال.
      </Notice>

      {!cv && (
        <Notice tone="danger">
          لا توجد سيرة محفوظة.{" "}
          <Link href="/cv" className="font-semibold underline underline-offset-4">
            ارفع سيرتك أولاً
          </Link>
          .
        </Notice>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">الإضافة</h2>
            {!extChecked ? (
              <p className="mt-1 text-sm text-muted">جارٍ البحث عن الإضافة…</p>
            ) : !ext ? (
              <p className="mt-1 text-sm text-muted">
                غير مثبّتة أو غير مسموح لها بهذا الموقع. ثبّت مجلد <code dir="ltr">extension</code> من{" "}
                <code dir="ltr">chrome://extensions</code> (وضع المطوّر ← Load unpacked)، ثم احفظ رابط هذا الموقع في نافذة
                الإضافة وحدّث الصفحة.
              </p>
            ) : (
              <div className="mt-1 space-y-0.5 text-sm text-muted">
                <p>
                  {ext.configured ? "مربوطة" : "مثبّتة وغير مربوطة"} · الإصدار {ext.version} ·{" "}
                  {ext.enabled ? (ext.submitMode === "auto" ? "الجدولة مفعّلة (إرسال تلقائي)" : "الجدولة مفعّلة (وضع تجربة)") : "الجدولة متوقفة"}
                </p>
                <p>
                  اليوم: {ext.todayCount} / {ext.maxPerDay}
                  {nextRun && <> · التشغيل القادم: {formatDate(new Date(nextRun).toISOString())}</>}
                  {ext.running && " · يعمل الآن…"}
                </p>
                {ext.lastRun && (
                  <p>
                    آخر تشغيل {formatDate(ext.lastRun.at)}{ext.lastRun.dryRun ? " (تجربة)" : ""}: وُجد {ext.lastRun.found}، قُدّم{" "}
                    {ext.lastRun.submitted}، تُخطّي {ext.lastRun.skipped}، فشل {ext.lastRun.failed}
                    {ext.lastRun.note && ` — ${ext.lastRun.note}`}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={connect} loading={busy === "connect"} disabled={!ext || !cv}>
              <Link2 className="size-4" /> {ext?.configured ? "إعادة الربط" : "ربط الإضافة"}
            </Button>
            <Button onClick={() => runNow(true)} loading={busy === "dry"} disabled={!ext?.configured || ext.running}>
              <TestTube2 className="size-4" /> تشغيل تجريبي
            </Button>
            <Button onClick={() => runNow(false)} loading={busy === "run"} disabled={!ext?.configured || ext.running || settings.submitMode !== "auto"}>
              <Play className="size-4" /> تقديم الآن
            </Button>
            <Button variant="ghost" onClick={refreshExt} aria-label="تحديث">
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">البحث والجدولة</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الحالة">
            {(id) => (
              <Select id={id} value={settings.enabled ? "on" : "off"} onChange={(e) => patch({ enabled: e.target.value === "on" })}>
                <option value="off">متوقفة</option>
                <option value="on">مفعّلة في المواعيد</option>
              </Select>
            )}
          </Field>
          <Field label="وضع التقديم" hint="«تجربة» يعبّئ النموذج كاملاً ثم يلغيه بدون إرسال.">
            {(id) => (
              <Select id={id} value={settings.submitMode} onChange={(e) => patch({ submitMode: e.target.value as "auto" | "dry" })}>
                <option value="dry">تجربة (بدون إرسال)</option>
                <option value="auto">إرسال تلقائي</option>
              </Select>
            )}
          </Field>
          <Field label="المسميات الوظيفية" hint="مسمى في كل سطر.">
            {(id) => <Textarea id={id} dir="ltr" rows={5} value={settings.titles.join("\n")} onChange={(e) => patch({ titles: lines(e.target.value) })} />}
          </Field>
          <div className="space-y-4">
            <Field label="المدينة" hint="يُضاف للبحث: «… jobs in Riyadh». الوظائف من آخر 24 ساعة فقط.">
              {(id) => <Input id={id} dir="ltr" value={settings.location} onChange={(e) => patch({ location: e.target.value })} />}
            </Field>
            <Field label="المواعيد اليومية" hint="بتوقيت جهازك، مفصولة بفواصل. مثال: 10:00, 14:00, 17:00">
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  value={settings.times.join(", ")}
                  onChange={(e) => patch({ times: lines(e.target.value).map((t) => t.padStart(5, "0")) })}
                />
              )}
            </Field>
          </div>
          <Field label="حد كل تشغيل">
            {(id) => <Input id={id} type="number" min={1} max={25} value={settings.maxPerRun} onChange={(e) => patch({ maxPerRun: Number(e.target.value) || 1 })} />}
          </Field>
          <Field label="الحد اليومي" hint="ننصح بـ 15 أو أقل.">
            {(id) => <Input id={id} type="number" min={1} max={50} value={settings.maxPerDay} onChange={(e) => patch({ maxPerDay: Number(e.target.value) || 1 })} />}
          </Field>
          <Field label="المسمى يجب أن يحتوي إحدى الكلمات" hint="مفصولة بفواصل.">
            {(id) => <Textarea id={id} dir="ltr" rows={3} value={settings.titleInclude.join(", ")} onChange={(e) => patch({ titleInclude: lines(e.target.value) })} />}
          </Field>
          <Field label="تخطَّ المسميات التي فيها" hint="مفصولة بفواصل.">
            {(id) => <Textarea id={id} dir="ltr" rows={3} value={settings.titleExclude.join(", ")} onChange={(e) => patch({ titleExclude: lines(e.target.value) })} />}
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">إجابات النماذج</h2>
        <p className="mb-4 text-sm text-muted">
          تُستخدم كما هي في أسئلة Easy Apply. أي سؤال لا تغطيه هذه المعلومات أو سيرتك تُتخطّى وظيفته ولا يُخترع له جواب.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="رمز الدولة للجوال">
            {(id) => <Input id={id} dir="ltr" value={a.phoneCountry} onChange={(e) => patchA({ phoneCountry: e.target.value })} />}
          </Field>
          <Field label="رقم الجوال بدون الصفر" hint="مثال: 5XXXXXXXX">
            {(id) => <Input id={id} dir="ltr" value={a.phoneNational} onChange={(e) => patchA({ phoneNational: e.target.value.replace(/^0+/, "") })} />}
          </Field>
          <Field label="المدينة (للنماذج)">
            {(id) => <Input id={id} dir="ltr" value={a.city} onChange={(e) => patchA({ city: e.target.value })} />}
          </Field>
          <Field label="الجنسية">
            {(id) => <Input id={id} dir="ltr" value={a.nationality} onChange={(e) => patchA({ nationality: e.target.value })} />}
          </Field>
          <Field label="الإقامة / حالة العمل">
            {(id) => <Input id={id} dir="ltr" value={a.residency} onChange={(e) => patchA({ residency: e.target.value })} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الراتب المتوقع (شهري)">
              {(id) => <Input id={id} type="number" min={0} value={a.expectedSalary} onChange={(e) => patchA({ expectedSalary: Number(e.target.value) || 0 })} />}
            </Field>
            <Field label="العملة">
              {(id) => <Input id={id} dir="ltr" value={a.salaryCurrency} onChange={(e) => patchA({ salaryCurrency: e.target.value })} />}
            </Field>
          </div>
          <Field label="فترة الإشعار (أيام)">
            {(id) => <Input id={id} type="number" min={0} value={a.noticeDays} onChange={(e) => patchA({ noticeDays: Number(e.target.value) || 0 })} />}
          </Field>
          <Field label="إجمالي سنوات الخبرة">
            {(id) => <Input id={id} type="number" min={0} step={0.5} value={a.totalYears} onChange={(e) => patchA({ totalYears: Number(e.target.value) || 0 })} />}
          </Field>
          <Field label="سنوات الخبرة لكل مهارة" hint="سطر لكل مهارة: «Python: 2». مهارة غير موجودة في سيرتك = 0.">
            {(id) => <Textarea id={id} dir="ltr" rows={7} value={a.skillYears} onChange={(e) => patchA({ skillYears: e.target.value })} />}
          </Field>
          <Field label="معلومات إضافية" hint="مثل: نقل الكفالة، الاستعداد للانتقال، اللغات. بالإنجليزية أفضل.">
            {(id) => <Textarea id={id} dir="ltr" rows={7} value={a.extraFacts} onChange={(e) => patchA({ extraFacts: e.target.value })} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={save} loading={busy === "save"}>
            <Save className="size-4" /> حفظ الإعدادات
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">سجل الإضافة</h2>
        {log.length === 0 ? (
          <p className="text-sm text-muted">لا توجد أحداث بعد. التقديمات الناجحة تُنقل تلقائياً إلى «السجل».</p>
        ) : (
          <ul className="divide-y divide-border">
            {log.slice(0, 60).map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[14.5px]">
                <div className="min-w-0">
                  <span className="font-semibold">{STATUS_AR[e.status]}</span>{" "}
                  <span dir="auto">{[e.title, e.company].filter(Boolean).join(" — ")}</span>
                  {e.reason && <p className="text-[13px] text-muted">{e.reason}</p>}
                </div>
                <div className="flex items-center gap-2 text-[13px] text-muted">
                  {formatDate(e.at)}
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noreferrer" aria-label="فتح الوظيفة" className="hover:text-primary">
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
