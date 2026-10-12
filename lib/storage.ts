import { z } from "zod";
import { defaultLinkedinSettings, linkedinSettingsSchema, type LinkedinSettings } from "./linkedin-settings";
import {
  applicationSchema,
  cvSchema,
  defaultSettings,
  queueItemSchema,
  SCHEMA_VERSION,
  sentLogEntrySchema,
  settingsSchema,
  type Application,
  type Cv,
  type QueueItem,
  type SentLogEntry,
  type Settings,
} from "./schemas";

/**
 * The ONLY module that touches persistence. Everything is async so a real
 * database (e.g. Neon Postgres) can replace localStorage later without
 * touching the UI: implement the same functions against an API.
 *
 * Each key stores an envelope { schemaVersion, data }. Reads are zod-validated;
 * unreadable / invalid data behaves like "empty" (never throws into the UI).
 */

const PREFIX = "muq:";
export const KEYS = {
  masterCv: `${PREFIX}masterCv`,
  applications: `${PREFIX}applications`,
  sentLog: `${PREFIX}sentLog`,
  settings: `${PREFIX}settings`,
  lastBackupAt: `${PREFIX}lastBackupAt`,
  draft: `${PREFIX}draft`,
  queue: `${PREFIX}queue`,
  linkedin: `${PREFIX}linkedin`,
} as const;

export const STORAGE_EVENT = "muq:storage-changed";

// ---------- low-level (localStorage, try/catch everywhere) ----------

let memoryFallback: Map<string, string> | null = null;

function store() {
  try {
    if (typeof window === "undefined") return null;
    const s = window.localStorage;
    const probe = `${PREFIX}__probe`;
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return store() !== null;
}

function rawGet(key: string): string | null {
  const s = store();
  if (s) {
    try {
      return s.getItem(key);
    } catch {
      return null;
    }
  }
  return memoryFallback?.get(key) ?? null;
}

function rawSet(key: string, value: string): boolean {
  const s = store();
  if (s) {
    try {
      s.setItem(key, value);
      return true;
    } catch {
      return false; // quota exceeded etc.
    }
  }
  // storage unavailable: keep for this tab session so the app still works
  memoryFallback ??= new Map();
  memoryFallback.set(key, value);
  return true;
}

function rawRemove(key: string) {
  try {
    store()?.removeItem(key);
  } catch {
    /* ignore */
  }
  memoryFallback?.delete(key);
}

function notify() {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(STORAGE_EVENT));
  } catch {
    /* ignore */
  }
}

// ---------- envelope + migrations ----------

/** Migration hooks: migrate raw data from `from` to `from + 1`. */
const migrations: Record<string, Record<number, (data: unknown) => unknown>> = {
  // [KEYS.applications]: { 1: (d) => ... }  // add when schemaVersion 2 exists
};

function migrate(key: string, version: number, data: unknown): unknown {
  let v = version;
  let d = data;
  while (v < SCHEMA_VERSION) {
    const step = migrations[key]?.[v];
    if (step) d = step(d);
    v++;
  }
  return d;
}

function readValidated<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  const raw = rawGet(key);
  if (!raw) return fallback;
  try {
    const env = JSON.parse(raw) as { schemaVersion?: number; data?: unknown };
    if (typeof env.schemaVersion !== "number" || env.schemaVersion > SCHEMA_VERSION) return fallback;
    const parsed = schema.safeParse(migrate(key, env.schemaVersion, env.data));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, data: unknown): boolean {
  const ok = rawSet(key, JSON.stringify({ schemaVersion: SCHEMA_VERSION, data }));
  if (ok) notify();
  return ok;
}

// ---------- master CV ----------

export async function getMasterCv(): Promise<Cv | null> {
  return readValidated(KEYS.masterCv, cvSchema.nullable(), null);
}
export async function setMasterCv(cv: Cv | null): Promise<boolean> {
  if (cv === null) {
    rawRemove(KEYS.masterCv);
    notify();
    return true;
  }
  return write(KEYS.masterCv, cvSchema.parse(cv));
}

// ---------- applications history ----------

const applicationsSchema = z.array(applicationSchema);

export async function listApplications(): Promise<Application[]> {
  const list = readValidated(KEYS.applications, applicationsSchema, []);
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function setApplications(list: Application[]): Promise<boolean> {
  return write(KEYS.applications, applicationsSchema.parse(list));
}
/** Insert or replace by id. */
export async function saveApplication(app: Application): Promise<boolean> {
  const list = (await listApplications()).filter((a) => a.id !== app.id);
  return setApplications([app, ...list]);
}
export async function deleteApplication(id: string): Promise<boolean> {
  return setApplications((await listApplications()).filter((a) => a.id !== id));
}

// ---------- sent log (Phase 2 writes to it; it is already part of the backup) ----------

const sentLogSchema = z.array(sentLogEntrySchema);

export async function getSentLog(): Promise<SentLogEntry[]> {
  return readValidated(KEYS.sentLog, sentLogSchema, []);
}
export async function setSentLog(list: SentLogEntry[]): Promise<boolean> {
  return write(KEYS.sentLog, sentLogSchema.parse(list));
}
export async function appendSentLog(entry: SentLogEntry): Promise<boolean> {
  return setSentLog([...(await getSentLog()), entry]);
}

// ---------- settings ----------

export async function getSettings(): Promise<Settings> {
  return readValidated(KEYS.settings, settingsSchema, defaultSettings());
}
export async function setSettings(s: Settings): Promise<boolean> {
  return write(KEYS.settings, settingsSchema.parse(s));
}

// ---------- LinkedIn auto-apply settings (not part of the backup) ----------

export async function getLinkedinSettings(): Promise<LinkedinSettings> {
  return readValidated(KEYS.linkedin, linkedinSettingsSchema, defaultLinkedinSettings());
}
export async function setLinkedinSettings(s: LinkedinSettings): Promise<boolean> {
  return write(KEYS.linkedin, linkedinSettingsSchema.parse(s));
}

// ---------- backup bookkeeping ----------

export async function getLastBackupAt(): Promise<string | null> {
  return readValidated(KEYS.lastBackupAt, z.string().nullable(), null);
}
export async function setLastBackupAt(iso: string): Promise<boolean> {
  return write(KEYS.lastBackupAt, iso);
}

// ---------- in-progress application draft (not part of the backup) ----------

export const draftSchema = z.object({
  savedAt: z.string(),
  step: z.number().int().min(0).max(2),
  original: cvSchema,
  current: cvSchema,
  jobDescription: z.string(),
  company: z.string(),
  jobTitle: z.string(),
  outputLanguage: z.enum(["auto", "ar", "en", "cv"]),
  coverLetter: z.string(),
  reasons: z.record(z.string(), z.string()),
  missingSkills: z.array(z.string()),
  warnings: z.array(z.string()),
  language: z.enum(["ar", "en"]),
  hasJobDescription: z.boolean(),
  applicationId: z.string(),
});
export type Draft = z.infer<typeof draftSchema>;

export async function getDraft(): Promise<Draft | null> {
  return readValidated(KEYS.draft, draftSchema.nullable(), null);
}
export async function setDraft(d: Draft | null): Promise<void> {
  if (d === null) {
    rawRemove(KEYS.draft);
    return;
  }
  write(KEYS.draft, d);
}

// ---------- send queue (transient; not part of the backup file) ----------

const queueSchema = z.array(queueItemSchema);

/**
 * An item found in "sending" state means the tab died mid-send: it may or may not have
 * gone out, so it is marked failed (never silently retried) to avoid double-sending.
 */
export async function getQueue(): Promise<QueueItem[]> {
  return readValidated(KEYS.queue, queueSchema, []).map((i) =>
    i.send === "sending"
      ? { ...i, send: "failed" as const, sendError: "انقطع الإرسال. تحقق من «المرسلة» في Gmail قبل إعادة المحاولة." }
      : i.prep === "tailoring"
        ? { ...i, prep: "pending" as const }
        : i,
  );
}
export async function setQueue(list: QueueItem[]): Promise<boolean> {
  if (list.length === 0) {
    rawRemove(KEYS.queue);
    notify();
    return true;
  }
  return write(KEYS.queue, queueSchema.parse(list));
}

// ---------- whole-dataset helpers (used by backup) ----------

export interface Snapshot {
  masterCv: Cv | null;
  applications: Application[];
  sentLog: SentLogEntry[];
  settings: Settings;
}

export async function readSnapshot(): Promise<Snapshot> {
  return {
    masterCv: await getMasterCv(),
    applications: await listApplications(),
    sentLog: await getSentLog(),
    settings: await getSettings(),
  };
}

export async function writeSnapshot(s: Snapshot): Promise<boolean> {
  const results = [
    await setMasterCv(s.masterCv),
    await setApplications(s.applications),
    await setSentLog(s.sentLog),
    await setSettings(s.settings),
  ];
  return results.every(Boolean);
}

export async function hasAnyData(): Promise<boolean> {
  const s = await readSnapshot();
  return s.masterCv !== null || s.applications.length > 0 || s.sentLog.length > 0;
}

/** Test/maintenance helper: wipes app data (not used by the UI without confirmation). */
export async function clearAll(): Promise<void> {
  for (const k of Object.values(KEYS)) rawRemove(k);
  notify();
}
