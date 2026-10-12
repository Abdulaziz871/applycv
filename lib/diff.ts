import type { Cv } from "./schemas";

/**
 * Change tracking between the original CV and the (possibly edited) tailored CV.
 * Changes are always recomputed from the two documents, so they stay accurate
 * after manual edits and "revert" is just restoring the original value at a path.
 */

export type ChangeValue = string | string[];

export interface Change {
  path: string;
  label: string;
  before: ChangeValue;
  after: ChangeValue;
}

type Loose = Record<string, unknown> | unknown[];

export function getAtPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Loose as Record<string, unknown>)[key];
  }
  return cur;
}

export function setAtPath<T>(root: T, path: string, value: unknown): T {
  const clone = structuredClone(root);
  const keys = path.split(".");
  let cur = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] as Record<string, unknown>;
  cur[keys[keys.length - 1]] = structuredClone(value);
  return clone;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const FIELD_LABELS: Record<string, string> = {
  name: "الاسم",
  headline: "المسمى",
  summary: "الملخص",
  skills: "المهارات",
  languages: "اللغات",
  certifications: "الشهادات",
  title: "المسمى الوظيفي",
  company: "الشركة",
  location: "المكان",
  start: "البداية",
  end: "النهاية",
  degree: "الدرجة",
  institution: "الجهة",
  details: "التفاصيل",
  description: "الوصف",
  bullets: "النقاط",
};

export function pathLabel(path: string): string {
  const p = path.split(".");
  const idx = (n: number) => (Number(p[n]) + 1).toString();
  switch (p[0]) {
    case "experience": {
      const base = `الخبرة ${idx(1)}`;
      if (p[2] === "bullets" && p[3] !== undefined) return `${base} — نقطة ${idx(3)}`;
      return `${base} — ${FIELD_LABELS[p[2]] ?? p[2]}`;
    }
    case "education":
      return `التعليم ${idx(1)} — ${FIELD_LABELS[p[2]] ?? p[2]}`;
    case "projects":
      return `المشروع ${idx(1)} — ${FIELD_LABELS[p[2]] ?? p[2]}`;
    default:
      return FIELD_LABELS[p[0]] ?? p[0];
  }
}

function pushIfDiff(out: Change[], path: string, before: ChangeValue, after: ChangeValue) {
  if (!same(before, after)) out.push({ path, label: pathLabel(path), before, after });
}

/** Ordered list of differences between the original and the current CV. */
export function computeChanges(original: Cv, current: Cv): Change[] {
  const out: Change[] = [];
  pushIfDiff(out, "headline", original.headline, current.headline);
  pushIfDiff(out, "summary", original.summary, current.summary);

  const expCount = Math.max(original.experience.length, current.experience.length);
  for (let i = 0; i < expCount; i++) {
    const o = original.experience[i];
    const c = current.experience[i];
    if (!o || !c) continue; // structural edits are not per-field changes
    for (const f of ["title", "company", "location", "start", "end"] as const) {
      pushIfDiff(out, `experience.${i}.${f}`, o[f], c[f]);
    }
    if (o.bullets.length === c.bullets.length) {
      o.bullets.forEach((b, j) =>
        pushIfDiff(out, `experience.${i}.bullets.${j}`, b, c.bullets[j]),
      );
    } else {
      pushIfDiff(out, `experience.${i}.bullets`, o.bullets, c.bullets);
    }
  }

  const eduCount = Math.min(original.education.length, current.education.length);
  for (let i = 0; i < eduCount; i++) {
    for (const f of ["degree", "institution", "location", "start", "end", "details"] as const) {
      pushIfDiff(out, `education.${i}.${f}`, original.education[i][f], current.education[i][f]);
    }
  }
  const projCount = Math.min(original.projects.length, current.projects.length);
  for (let i = 0; i < projCount; i++) {
    for (const f of ["name", "description"] as const) {
      pushIfDiff(out, `projects.${i}.${f}`, original.projects[i][f], current.projects[i][f]);
    }
  }

  pushIfDiff(out, "skills", original.skills, current.skills);
  pushIfDiff(out, "languages", original.languages, current.languages);
  pushIfDiff(out, "certifications", original.certifications, current.certifications);
  return out;
}

/** Restores the original value at the change's path. */
export function revertChange(original: Cv, current: Cv, path: string): Cv {
  const value = getAtPath(original, path);
  if (value === undefined) return current;
  return setAtPath(current, path, value);
}

export const displayValue = (v: ChangeValue): string =>
  Array.isArray(v) ? v.join(" • ") : v;

// ---------- word-level diff for highlighting ----------

export interface Segment {
  text: string;
  kind: "same" | "added" | "removed";
}

export function wordDiff(before: string, after: string): { before: Segment[]; after: Segment[] } {
  const a = before.split(/(\s+)/).filter((t) => t.length);
  const b = after.split(/(\s+)/).filter((t) => t.length);
  const n = a.length;
  const m = b.length;
  // LCS table (inputs are short: single bullets/summaries)
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const left: Segment[] = [];
  const right: Segment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      left.push({ text: a[i], kind: "same" });
      right.push({ text: b[j], kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ text: a[i++], kind: "removed" });
    } else {
      right.push({ text: b[j++], kind: "added" });
    }
  }
  while (i < n) left.push({ text: a[i++], kind: "removed" });
  while (j < m) right.push({ text: b[j++], kind: "added" });
  return { before: left, after: right };
}
