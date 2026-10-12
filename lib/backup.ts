import {
  BACKUP_APP_ID,
  backupSchema,
  SCHEMA_VERSION,
  type Application,
  type Backup,
  type SentLogEntry,
} from "./schemas";
import type { Snapshot } from "./storage";

/**
 * Backup file: contains ONLY app data. No password, session, or Gmail tokens
 * exist in these structures (they live in httpOnly cookies / server env).
 */

export function buildBackup(snapshot: Snapshot, now = new Date()): Backup {
  return {
    app: BACKUP_APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    masterCv: snapshot.masterCv,
    applications: snapshot.applications,
    sentLog: snapshot.sentLog,
    settings: snapshot.settings,
  };
}

export const backupFileName = (now = new Date()) =>
  `muqaddim-backup-${now.toISOString().slice(0, 10)}.json`;

export type ParseBackupResult =
  | { ok: true; backup: Backup }
  | { ok: false; error: string };

const MAX_BACKUP_BYTES = 30 * 1024 * 1024;

export function parseBackup(text: string): ParseBackupResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: "الملف كبير جداً ولا يبدو نسخة احتياطية صالحة." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "الملف ليس بصيغة JSON صالحة." };
  }
  if (!raw || typeof raw !== "object" || (raw as { app?: unknown }).app !== BACKUP_APP_ID) {
    return { ok: false, error: "هذا الملف ليس نسخة احتياطية من «مُقدِّم»." };
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "رقم إصدار النسخة الاحتياطية غير صالح." };
  }
  if (version > SCHEMA_VERSION) {
    return { ok: false, error: "هذه النسخة أحدث من إصدار التطبيق الحالي. حدّث التطبيق ثم أعد المحاولة." };
  }
  // migration hook: upgrade `raw` from `version` to SCHEMA_VERSION here when v2 exists
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "بنية الملف غير صالحة أو أن بعض البيانات تالفة. لم يتم تغيير أي شيء." };
  }
  return { ok: true, backup: parsed.data };
}

export function summarizeBackup(b: Backup) {
  return {
    cvName: b.masterCv?.name || null,
    applications: b.applications.length,
    sentLog: b.sentLog.length,
    exportedAt: b.exportedAt,
  };
}

/** Merge history by id, keeping the newer item; keep the current CV unless there is none. */
export function mergeSnapshots(current: Snapshot, incoming: Backup): Snapshot {
  const byId = new Map<string, Application>();
  for (const a of [...current.applications, ...incoming.applications]) {
    const existing = byId.get(a.id);
    if (!existing || a.updatedAt > existing.updatedAt) byId.set(a.id, a);
  }
  const logById = new Map<string, SentLogEntry>();
  for (const e of [...current.sentLog, ...incoming.sentLog]) logById.set(e.id, e);

  return {
    masterCv: current.masterCv ?? incoming.masterCv,
    applications: [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    sentLog: [...logById.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    settings: current.settings,
  };
}

export const snapshotFromBackup = (b: Backup): Snapshot => ({
  masterCv: b.masterCv,
  applications: b.applications,
  sentLog: b.sentLog,
  settings: b.settings,
});

export function daysSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((now - t) / 86_400_000);
}
