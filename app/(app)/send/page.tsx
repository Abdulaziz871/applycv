"use client";

import { FileText, Sparkles, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GmailCard,
  ImportCard,
  QueueList,
  ReviewSheet,
  RunBar,
  SentLogCard,
  type GmailStatus,
} from "@/components/SendParts";
import { Button, Card, EmptyState, Field, Input, Notice, PageHeader, Skeleton, useToast } from "@/components/ui";
import { DELAY_RANGE_SEC, clampCap, contactedEmails, queuedEmails, sentToday } from "@/lib/send-queue";
import { defaultSettings, type Application, type Cv, type SentLogEntry } from "@/lib/schemas";
import { getMasterCv, getSentLog, getSettings, listApplications, setSettings } from "@/lib/storage";
import { useStoredValue } from "@/lib/use-storage";
import { useSendQueue } from "@/lib/use-send-queue";

const GMAIL_MESSAGES: Record<string, [string, "success" | "error" | "info"]> = {
  connected: ["تم ربط Gmail بنجاح.", "success"],
  denied: ["تم إلغاء الربط من Google.", "info"],
  error: ["تعذّر ربط Gmail. حاول مرة أخرى.", "error"],
  misconfigured: ["ربط Google غير مضبوط على الخادم (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).", "error"],
};

export default function SendPage() {
  const toast = useToast();
  const { value: master, loading: masterLoading } = useStoredValue(getMasterCv, null as Cv | null);
  const { value: settings } = useStoredValue(getSettings, defaultSettings());
  const { value: sentLog } = useStoredValue(getSentLog, [] as SentLogEntry[]);
  const { value: applications } = useStoredValue(listApplications, [] as Application[]);

  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [gmailLoading, setGmailLoading] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<string | null>(null); // lets the field be emptied while typing

  const refreshGmail = useCallback(
    () =>
      fetch("/api/gmail/status", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<GmailStatus>) : null))
        .catch(() => null)
        .then((status) => {
          setGmail(status);
          setGmailLoading(false);
        }),
    [],
  );

  useEffect(() => {
    refreshGmail();
    // result of the OAuth round trip: ?gmail=connected|denied|error|misconfigured
    const flag = new URLSearchParams(window.location.search).get("gmail");
    if (flag) {
      const [msg, tone] = GMAIL_MESSAGES[flag] ?? GMAIL_MESSAGES.error;
      toast(msg, tone);
      window.history.replaceState(null, "", "/send");
    }
  }, [refreshGmail, toast]);

  const delayRange = (gmail?.delayRangeSec ?? DELAY_RANGE_SEC) as [number, number];
  const q = useSendQueue({ master, settings, delayRangeSec: delayRange, onGmailLost: () => void refreshGmail() });

  const cap = clampCap(settings.dailyCap);
  const today = sentToday(sentLog);
  const contacted = useMemo(() => contactedEmails(sentLog, applications), [sentLog, applications]);
  const queued = useMemo(() => queuedEmails(q.queue), [q.queue]);

  const approvedCount = q.queue.filter((i) => i.approved && i.prep === "ready" && i.send === "waiting").length;
  const pendingPrep = q.queue.filter((i) => i.prep === "pending" || i.prep === "failed").length;
  const readyToReview = q.queue.filter((i) => i.prep === "ready" && !i.approved && i.send === "waiting").length;
  const sentInQueue = q.queue.filter((i) => i.send === "sent").length;
  const locked = q.run.state !== "idle";
  const reviewItem = q.queue.find((i) => i.id === reviewId) ?? null;

  async function disconnect() {
    await fetch("/api/gmail/disconnect", { method: "POST" }).catch(() => {});
    await refreshGmail();
    toast("تم فصل Gmail.", "info");
  }

  if (masterLoading || !q.loaded) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!master) {
    return (
      <EmptyState
        icon={<FileText className="size-7" />}
        title="ارفع سيرتك الذاتية أولاً"
        description="نحتاج سيرتك الأساسية لتجهيز كل تقديم."
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="الإرسال بالإيميل"
        subtitle="جهّز التقديمات، راجع كل واحد واعتمده، ثم أرسلها من حسابك في Gmail بفواصل آمنة."
      />

      <GmailCard status={gmail} loading={gmailLoading} onDisconnect={disconnect} />

      <ImportCard onAdd={q.addCandidates} contacted={contacted} queued={queued} disabled={locked} />

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">الحد اليومي للإرسال</h2>
            <p className="mt-1 text-[14.5px] text-muted">الافتراضي 30، والحد الأقصى المسموح 100. يُحتسب لكل يوم بتوقيت جهازك.</p>
          </div>
          <div className="w-32">
            <Field label="الحد اليومي">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  dir="ltr"
                  min={1}
                  max={100}
                  value={capDraft ?? String(settings.dailyCap)}
                  data-testid="daily-cap"
                  disabled={locked}
                  onChange={(e) => {
                    setCapDraft(e.target.value);
                    if (e.target.value !== "") void setSettings({ ...settings, dailyCap: clampCap(Number(e.target.value)) });
                  }}
                  onBlur={() => setCapDraft(null)}
                />
              )}
            </Field>
          </div>
        </div>
      </Card>

      {q.saveError && (
        <Notice tone="danger">تعذّر حفظ الطابور في المتصفح (المساحة ممتلئة). أرسل ما لديك أو احذف بعض العناصر، وإلا قد يضيع عند إغلاق الصفحة.</Notice>
      )}

      <section aria-label="الطابور">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            الطابور <span className="text-muted">({q.queue.length})</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {sentInQueue > 0 && !locked && (
              <Button size="sm" variant="ghost" onClick={q.clearSent}>
                إخفاء المُرسَل ({sentInQueue})
              </Button>
            )}
            {q.prepBusy ? (
              <Button size="sm" variant="secondary" onClick={q.stopPrepare}>
                <Square className="size-4" /> إيقاف التجهيز
              </Button>
            ) : (
              <Button size="sm" variant="secondary" disabled={pendingPrep === 0 || locked} onClick={() => void q.prepareAll()} data-testid="prep-all">
                <Sparkles className="size-4" /> تجهيز الكل ({pendingPrep})
              </Button>
            )}
          </div>
        </div>

        {q.prepNotice && <Notice tone="warning" className="mb-3">{q.prepNotice}</Notice>}
        {readyToReview > 0 && (
          <Notice tone="info" className="mb-3">
            {readyToReview} جاهز للمراجعة. لا يُرسل شيء قبل أن تفتح كل تقديم وتعتمده بنفسك.
          </Notice>
        )}

        {q.queue.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-7" />}
            title="الطابور فارغ"
            description="ارفع ملف CSV/XLSX أو أضف بريداً يدوياً لتبدأ. يتم تخطي المكرر وما سبق التواصل معه تلقائياً."
          />
        ) : (
          <QueueList
            queue={q.queue}
            runningId={q.run.currentId}
            locked={locked}
            onPrepare={(id) => void q.prepareOne(id)}
            onReview={setReviewId}
            onUnapprove={q.unapprove}
            onRetry={q.retrySend}
            onRemove={q.remove}
          />
        )}
      </section>

      <SentLogCard log={sentLog} />

      <RunBar
        run={q.run}
        approvedCount={approvedCount}
        sentToday={today}
        cap={cap}
        gmailConnected={!!gmail?.connected}
        prepBusy={q.prepBusy}
        onStart={() => void q.start()}
        onPause={q.pause}
        onResume={q.resume}
        onCancel={q.cancel}
      />

      {reviewItem && (
        <ReviewSheet
          item={reviewItem}
          onEdit={(patch) => q.editReview(reviewItem.id, patch)}
          onSubject={(s) => q.setSubject(reviewItem.id, s)}
          onApprove={() => {
            q.approve(reviewItem.id);
            setReviewId(null);
            toast("تم اعتماد التقديم. سيُرسل عند بدء الإرسال.");
          }}
          onClose={() => setReviewId(null)}
        />
      )}
    </div>
  );
}
