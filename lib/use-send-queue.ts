"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pdfFileName } from "./filename";
import type { Candidate } from "./import-rows";
import { cvSchema, type Cv, type QueueItem, type ReviewData, type Settings, type TailorResponse } from "./schemas";
import { defaultSubject, nextSendable, randomDelayMs, remainingToday } from "./send-queue";
import { appendSentLog, getQueue, getSentLog, listApplications, saveApplication, setQueue } from "./storage";

export type RunState = "idle" | "running" | "paused";

export interface RunInfo {
  state: RunState;
  /** seconds until the next e-mail (null while sending / idle) */
  countdown: number | null;
  currentId: string | null;
  /** why the run stopped (cap reached, Gmail quota, re-auth needed…) */
  notice: string;
}

const IDLE: RunInfo = { state: "idle", countdown: null, currentId: null, notice: "" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

interface Options {
  master: Cv | null;
  settings: Settings;
  delayRangeSec: [number, number];
  onGmailLost: () => void;
}

/**
 * Owns the queue (persisted in localStorage), the AI preparation loop and the sender.
 * The sender runs in this tab: one e-mail at a time, random delay between e-mails,
 * daily cap re-checked before every send. Only items that are approved AND prepared
 * are ever sent.
 */
export function useSendQueue({ master, settings, delayRangeSec, onGmailLost }: Options) {
  const [queue, setQueueState] = useState<QueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [prepBusy, setPrepBusy] = useState(false);
  const [prepNotice, setPrepNotice] = useState("");
  const [run, setRun] = useState<RunInfo>(IDLE);
  const [saveError, setSaveError] = useState(false);

  const queueRef = useRef<QueueItem[]>([]);
  const ctl = useRef({ pause: false, cancel: false, prepStop: false });
  const runningRef = useRef(false);
  const prepRef = useRef(false);
  const optsRef = useRef({ master, settings, delayRangeSec, onGmailLost });
  useEffect(() => {
    optsRef.current = { master, settings, delayRangeSec, onGmailLost };
  });

  const commit = useCallback((next: QueueItem[]) => {
    queueRef.current = next;
    setQueueState(next);
    void setQueue(next).then((ok) => setSaveError(!ok));
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<QueueItem> | ((i: QueueItem) => Partial<QueueItem>)) => {
      commit(
        queueRef.current.map((i) => (i.id === id ? { ...i, ...(typeof patch === "function" ? patch(i) : patch) } : i)),
      );
    },
    [commit],
  );

  useEffect(() => {
    void getQueue().then((q) => {
      queueRef.current = q;
      setQueueState(q);
      setLoaded(true);
    });
  }, []);

  // never leave the page silently while e-mails are going out
  useEffect(() => {
    if (run.state === "idle") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [run.state]);

  // ---------------------------------------------------------------- queue editing

  const addCandidates = useCallback(
    (candidates: Candidate[]) => {
      const items: QueueItem[] = candidates.map((c) => ({
        id: newId(),
        email: c.email,
        company: c.company,
        position: c.position,
        jobDescription: c.jobDescription,
        prep: "pending",
        approved: false,
        send: "waiting",
        subject: "",
      }));
      commit([...queueRef.current, ...items]);
    },
    [commit],
  );

  const remove = useCallback((id: string) => commit(queueRef.current.filter((i) => i.id !== id)), [commit]);
  const clearSent = useCallback(() => commit(queueRef.current.filter((i) => i.send !== "sent")), [commit]);

  /** Editing anything after approval revokes the approval. */
  const editReview = useCallback(
    (id: string, patch: Partial<ReviewData>) =>
      update(id, (i) => (i.review ? { review: { ...i.review, ...patch }, approved: false } : {})),
    [update],
  );
  const setSubject = useCallback((id: string, subject: string) => update(id, { subject, approved: false }), [update]);
  const approve = useCallback(
    (id: string) => update(id, (i) => (i.prep === "ready" && i.review ? { approved: true } : {})),
    [update],
  );
  const unapprove = useCallback((id: string) => update(id, { approved: false }), [update]);
  const retrySend = useCallback(
    (id: string) => update(id, { send: "waiting", sendError: undefined }),
    [update],
  );

  // ---------------------------------------------------------------- AI preparation

  const prepareOne = useCallback(
    async (id: string): Promise<"ok" | "failed" | "stop"> => {
      const { master: cv, settings: st } = optsRef.current;
      const item = queueRef.current.find((i) => i.id === id);
      if (!cv || !item) return "failed";
      update(id, { prep: "tailoring", prepError: undefined });
      const mode = item.jobDescription.trim().length >= 30 ? "tailor" : "asis";
      try {
        const res = await fetch("/api/tailor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cv,
            jobDescription: mode === "tailor" ? item.jobDescription : "",
            company: item.company,
            jobTitle: item.position,
            outputLanguage: st.defaultOutputLanguage,
            mode,
          }),
        });
        const data = (await res.json().catch(() => null)) as (TailorResponse & { error?: string }) | null;
        if (!res.ok || !data || data.error) {
          const quota = res.status === 429;
          const config = res.status === 503 || res.status === 401;
          update(id, { prep: quota || config ? "pending" : "failed", prepError: data?.error ?? "فشل التجهيز." });
          if (quota || config) setPrepNotice(data?.error ?? "توقف التجهيز.");
          return quota || config ? "stop" : "failed";
        }
        const review: ReviewData = {
          original: cv,
          current: data.cv,
          coverLetter: data.coverLetter,
          reasons: data.reasons,
          missingSkills: data.missingSkills,
          warnings: data.warnings,
          language: data.language,
          coverLetterFallback: data.coverLetterFallback,
          hasJobDescription: mode === "tailor",
        };
        update(id, {
          prep: "ready",
          prepError: undefined,
          approved: false,
          review,
          subject: defaultSubject(data.language, data.cv.name, item.position),
        });
        return "ok";
      } catch {
        update(id, { prep: "failed", prepError: "تعذّر الاتصال بالخادم." });
        return "failed";
      }
    },
    [update],
  );

  const prepareAll = useCallback(async () => {
    if (prepRef.current || !optsRef.current.master) return;
    prepRef.current = true;
    ctl.current.prepStop = false;
    setPrepBusy(true);
    setPrepNotice("");
    try {
      const todo = queueRef.current.filter((i) => i.prep === "pending" || i.prep === "failed");
      for (let n = 0; n < todo.length; n++) {
        if (ctl.current.prepStop) break;
        const r = await prepareOne(todo[n].id);
        if (r === "stop") break;
        if (n < todo.length - 1) await sleep(2500); // stay inside the free-tier requests-per-minute limit
      }
    } finally {
      prepRef.current = false;
      setPrepBusy(false);
    }
  }, [prepareOne]);

  const stopPrepare = useCallback(() => {
    ctl.current.prepStop = true;
  }, []);

  // ---------------------------------------------------------------- sending

  const waitWhilePaused = async () => {
    while (ctl.current.pause && !ctl.current.cancel) await sleep(200);
  };

  /** Interruptible countdown between two e-mails (frozen while paused). */
  const countdownDelay = async (ms: number) => {
    let left = ms;
    while (left > 0 && !ctl.current.cancel) {
      if (!ctl.current.pause) left -= 250;
      setRun((r) => ({ ...r, countdown: Math.max(0, Math.ceil(left / 1000)) }));
      await sleep(250);
    }
    setRun((r) => ({ ...r, countdown: null }));
  };

  type SendOutcome = "sent" | "failed" | "stop";

  const sendOne = useCallback(
    async (item: QueueItem): Promise<SendOutcome> => {
      const review = item.review!;
      update(item.id, { send: "sending", sendError: undefined });
      setRun((r) => ({ ...r, currentId: item.id, countdown: null }));

      type SendReply = { error?: string; code?: string } | null;
      let res: Response;
      let data: SendReply;
      try {
        res = await fetch("/api/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: item.email,
            subject: item.subject,
            body: review.coverLetter,
            cv: cvSchema.parse(review.current),
            fileName: pdfFileName(review.current.name, item.company),
            approved: true,
          }),
        });
        data = (await res.json().catch(() => null)) as SendReply;
      } catch {
        // The request may or may not have reached Gmail: mark failed (never auto-retry).
        update(item.id, { send: "failed", sendError: "انقطع الاتصال أثناء الإرسال. تحقق من «المرسلة» في Gmail قبل إعادة المحاولة." });
        await appendSentLog({ id: newId(), email: item.email, company: item.company, position: item.position, sentAt: new Date().toISOString(), status: "failed", error: "network" });
        return "failed";
      }

      const now = new Date().toISOString();
      if (res.ok) {
        update(item.id, { send: "sent", sendError: undefined });
        await appendSentLog({ id: item.id, email: item.email, company: item.company, position: item.position, sentAt: now, status: "sent" });
        const existing = (await listApplications()).find((a) => a.id === item.id);
        await saveApplication({
          id: item.id,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          company: item.company,
          jobTitle: item.position,
          hasJobDescription: review.hasJobDescription,
          language: review.language,
          cv: review.current,
          coverLetter: review.coverLetter,
          recipientEmail: item.email,
        });
        return "sent";
      }

      const code = data?.code;
      const message = data?.error ?? "تعذّر الإرسال.";
      if (code === "reauth" || code === "not_connected" || res.status === 401) {
        update(item.id, { send: "waiting" }); // nothing was sent
        optsRef.current.onGmailLost();
        setRun((r) => ({ ...r, notice: message }));
        return "stop";
      }
      if (code === "quota") {
        update(item.id, { send: "waiting" });
        setRun((r) => ({ ...r, notice: message }));
        return "stop";
      }
      update(item.id, { send: "failed", sendError: message });
      await appendSentLog({ id: newId(), email: item.email, company: item.company, position: item.position, sentAt: now, status: "failed", error: message.slice(0, 200) });
      return "failed";
    },
    [update],
  );

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    ctl.current.pause = false;
    ctl.current.cancel = false;
    setRun({ ...IDLE, state: "running" });
    let consecutiveFailures = 0;
    try {
      while (!ctl.current.cancel) {
        await waitWhilePaused();
        if (ctl.current.cancel) break;

        const remaining = remainingToday(await getSentLog(), optsRef.current.settings.dailyCap);
        if (remaining <= 0) {
          setRun((r) => ({ ...r, notice: "وصلت الحد اليومي. سيتوقف الإرسال، وتُكمل غداً." }));
          break;
        }
        const item = nextSendable(queueRef.current);
        if (!item) break;

        const outcome = await sendOne(item);
        if (outcome === "stop") break;
        consecutiveFailures = outcome === "failed" ? consecutiveFailures + 1 : 0;
        if (consecutiveFailures >= 3) {
          setRun((r) => ({ ...r, notice: "فشلت ٣ رسائل متتالية، توقّف الإرسال للمراجعة." }));
          break;
        }

        // wait only when there is more to send today
        if (remaining - (outcome === "sent" ? 1 : 0) > 0 && nextSendable(queueRef.current)) {
          await countdownDelay(randomDelayMs(optsRef.current.delayRangeSec));
        }
      }
    } finally {
      runningRef.current = false;
      setRun((r) => ({ ...IDLE, notice: r.notice }));
    }
  }, [sendOne]);

  const pause = useCallback(() => {
    ctl.current.pause = true;
    setRun((r) => (r.state === "running" ? { ...r, state: "paused" } : r));
  }, []);
  const resume = useCallback(() => {
    ctl.current.pause = false;
    setRun((r) => (r.state === "paused" ? { ...r, state: "running" } : r));
  }, []);
  const cancel = useCallback(() => {
    ctl.current.cancel = true;
    ctl.current.pause = false;
  }, []);

  return {
    queue,
    loaded,
    saveError,
    run,
    prepBusy,
    prepNotice,
    addCandidates,
    remove,
    clearSent,
    editReview,
    setSubject,
    approve,
    unapprove,
    retrySend,
    prepareOne,
    prepareAll,
    stopPrepare,
    start,
    pause,
    resume,
    cancel,
  };
}
