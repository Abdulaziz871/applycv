import Papa from "papaparse";
import { normalizeEmail } from "./gmail-mime";

/**
 * Turning a CSV / XLSX table into queue candidates. Pure functions (no DOM), so they can be
 * unit-tested. Emails are validated, normalised and de-duplicated; addresses that were
 * already contacted are skipped with a reason.
 */

export const MAX_IMPORT_ROWS = 150;

export interface Candidate {
  email: string;
  company: string;
  position: string;
  jobDescription: string;
}

export type SkipReason = "invalid" | "duplicate" | "contacted" | "in_queue" | "limit";

export interface SkippedRow {
  row: number; // 1-based, counting the first data row as 1
  value: string;
  reason: SkipReason;
}

export const SKIP_LABELS_AR: Record<SkipReason, string> = {
  invalid: "بريد غير صالح",
  duplicate: "مكرر في الملف",
  contacted: "سبق التواصل معه",
  in_queue: "موجود في الطابور",
  limit: "تجاوز الحد الأقصى للصفوف",
};

const ALIASES: Record<keyof Candidate, string[]> = {
  email: ["email", "e_mail", "mail", "email_address", "to", "البريد", "الايميل", "الإيميل", "البريد_الالكتروني", "البريد_الإلكتروني"],
  company: ["company", "company_name", "organization", "employer", "الشركة", "اسم_الشركة", "الجهة"],
  position: ["position", "job_title", "title", "role", "job", "الوظيفة", "المسمى", "المسمى_الوظيفي"],
  jobDescription: ["job_description", "jobdescription", "description", "jd", "details", "وصف_الوظيفة", "الوصف"],
};

const headerKey = (h: string) =>
  h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, "_");

/** Maps arbitrary header names to our four fields (first match wins). */
export function mapHeaders(headers: string[]): Partial<Record<keyof Candidate, number>> {
  const out: Partial<Record<keyof Candidate, number>> = {};
  headers.forEach((h, i) => {
    const key = headerKey(h);
    for (const field of Object.keys(ALIASES) as (keyof Candidate)[]) {
      if (out[field] === undefined && ALIASES[field].includes(key)) out[field] = i;
    }
  });
  return out;
}

export type Table = string[][]; // first row = headers

export interface ImportResult {
  candidates: Candidate[];
  skipped: SkippedRow[];
  error?: string;
}

const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

export function tableToCandidates(
  table: Table,
  opts: { contacted?: Set<string>; queued?: Set<string> } = {},
): ImportResult {
  if (table.length < 2) return { candidates: [], skipped: [], error: "الملف فارغ أو لا يحتوي صفوفاً." };
  const map = mapHeaders(table[0].map(cell));
  if (map.email === undefined) {
    return { candidates: [], skipped: [], error: "لم أجد عموداً باسم email. تأكد من صف العناوين." };
  }

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const skipped: SkippedRow[] = [];

  table.slice(1).forEach((r, i) => {
    const row = i + 1;
    const rawEmail = cell(r[map.email!]);
    if (!rawEmail && r.every((c) => !cell(c))) return; // blank line
    const email = normalizeEmail(rawEmail);
    if (!email) return void skipped.push({ row, value: rawEmail, reason: "invalid" });
    if (seen.has(email)) return void skipped.push({ row, value: email, reason: "duplicate" });
    seen.add(email);
    if (opts.contacted?.has(email)) return void skipped.push({ row, value: email, reason: "contacted" });
    if (opts.queued?.has(email)) return void skipped.push({ row, value: email, reason: "in_queue" });
    if (candidates.length >= MAX_IMPORT_ROWS) return void skipped.push({ row, value: email, reason: "limit" });
    candidates.push({
      email,
      company: cell(map.company !== undefined ? r[map.company] : "").slice(0, 200),
      position: cell(map.position !== undefined ? r[map.position] : "").slice(0, 200),
      jobDescription: cell(map.jobDescription !== undefined ? r[map.jobDescription] : "").slice(0, 15000),
    });
  });

  return { candidates, skipped };
}

/** CSV text → table. Delimiter is auto-detected (Excel in Arabic locales uses ";"). */
export function parseCsv(text: string): Table {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  return res.data.map((r) => r.map(cell));
}

/** Decodes CSV bytes: UTF-8 first, then Windows-1256 (Arabic Excel's default "CSV" encoding). */
export function decodeCsvBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1256").decode(bytes);
  }
}

export const rowsToTable = (rows: unknown[][]): Table => rows.map((r) => r.map(cell));
