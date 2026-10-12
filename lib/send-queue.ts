import { MAX_DAILY_CAP, type Application, type QueueItem, type SentLogEntry } from "./schemas";

/** Pure helpers for the send queue: daily cap, random delay, already-contacted checks. */

export const DELAY_RANGE_SEC: [number, number] = [20, 60];

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Emails successfully sent today (the caller's local calendar day). */
export function sentToday(log: SentLogEntry[], now = new Date()): number {
  const today = localDay(now);
  return log.filter((e) => e.status === "sent" && localDay(new Date(e.sentAt)) === today).length;
}

export const clampCap = (n: number) => Math.min(MAX_DAILY_CAP, Math.max(1, Math.floor(Number.isFinite(n) ? n : 30)));

export function remainingToday(log: SentLogEntry[], cap: number, now = new Date()): number {
  return Math.max(0, clampCap(cap) - sentToday(log, now));
}

/** Random delay in ms, uniform in [min, max] seconds. */
export function randomDelayMs(range: [number, number] = DELAY_RANGE_SEC, rng: () => number = Math.random): number {
  const [min, max] = range;
  return Math.round((min + rng() * (max - min)) * 1000);
}

/** Addresses we must not contact again: successfully sent (log) or e-mailed applications. */
export function contactedEmails(log: SentLogEntry[], applications: Application[]): Set<string> {
  const set = new Set<string>();
  for (const e of log) if (e.status === "sent") set.add(e.email.toLowerCase());
  for (const a of applications) if (a.recipientEmail) set.add(a.recipientEmail.toLowerCase());
  return set;
}

export const queuedEmails = (queue: QueueItem[]) => new Set(queue.map((i) => i.email.toLowerCase()));

/** The next item the runner may send: approved, prepared and still waiting. */
export const nextSendable = (queue: QueueItem[]): QueueItem | undefined =>
  queue.find((i) => i.approved && i.prep === "ready" && i.review && i.send === "waiting");

export function defaultSubject(lang: "ar" | "en", name: string, position: string): string {
  if (lang === "ar") return position ? `طلب توظيف – ${position} – ${name}` : `طلب توظيف – ${name}`;
  return position ? `Application for ${position} – ${name}` : `Job application – ${name}`;
}

export const SEND_FILE_MIME = "application/pdf";
