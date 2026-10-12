import { toLatinDigits } from "./lang";
import type { Cv, CvNoContact } from "./schemas";

/**
 * Server-side guardrails applied to every AI tailoring result. The prompt asks
 * the model not to fabricate, but we never rely on that alone: facts are
 * restored from the original CV and unknown numbers are rejected.
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function numbersIn(s: string): string[] {
  return (toLatinDigits(s).match(/\d[\d.,]*/g) ?? [])
    .map((n) => n.replace(/[.,]+$/, "").replace(/,/g, ""))
    .filter(Boolean);
}

function cvNumbers(cv: Cv | CvNoContact): Set<string> {
  const all: string[] = [
    cv.name,
    cv.headline,
    cv.summary,
    ...cv.skills,
    ...cv.languages,
    ...cv.certifications,
    ...cv.experience.flatMap((e) => [e.title, e.company, e.start, e.end, ...e.bullets]),
    ...cv.education.flatMap((e) => [e.degree, e.institution, e.start, e.end, e.details]),
    ...cv.projects.flatMap((p) => [p.name, p.description]),
  ];
  return new Set(all.flatMap(numbersIn));
}

const hasUnknownNumber = (s: string, known: Set<string>) =>
  numbersIn(s).some((n) => !known.has(n));

export interface SanitizeResult {
  cv: Cv;
  warnings: string[];
}

export function sanitizeTailored(
  original: Cv,
  tailored: CvNoContact,
  opts: { translating: boolean },
): SanitizeResult {
  const warnings: string[] = [];
  const known = cvNumbers(original);
  const out: Cv = structuredClone({ ...tailored, contact: original.contact });

  // Identity is never rewritten.
  out.name = original.name;
  out.headline = opts.translating ? tailored.headline : original.headline;

  // Experience: same entries, same facts.
  if (out.experience.length !== original.experience.length) {
    warnings.push("عدد الخبرات في النتيجة لا يطابق الأصل.");
    if (!opts.translating) out.experience = structuredClone(original.experience);
  } else {
    out.experience = out.experience.map((e, i) => {
      const o = original.experience[i];
      const facts = opts.translating
        ? { title: e.title, company: o.company, location: e.location, start: o.start, end: o.end }
        : { title: o.title, company: o.company, location: o.location, start: o.start, end: o.end };
      let bullets = e.bullets.map((b) => b.trim()).filter(Boolean);
      if (bullets.length === 0 && o.bullets.length > 0) bullets = [...o.bullets];
      if (bullets.some((b) => hasUnknownNumber(b, known))) {
        warnings.push(
          `تم إرجاع نقاط الخبرة «${o.title || o.company}» إلى الأصل لأن النتيجة تحتوي رقماً غير موجود في سيرتك.`,
        );
        bullets = [...o.bullets];
      }
      return { ...e, ...facts, bullets };
    });
  }

  if (hasUnknownNumber(out.summary, known)) {
    warnings.push("تم إرجاع الملخص إلى الأصل لأنه يحتوي رقماً غير موجود في سيرتك.");
    out.summary = original.summary;
  }

  // Education, languages, certifications: facts only, never added/removed.
  if (!opts.translating) {
    out.education = structuredClone(original.education);
    const sameSet = (a: string[], b: string[]) => {
      const keys = new Set(b.map(norm));
      return a.length === b.length && a.every((x) => keys.has(norm(x)));
    };
    if (!sameSet(out.languages, original.languages)) out.languages = [...original.languages];
    if (!sameSet(out.certifications, original.certifications)) {
      out.certifications = [...original.certifications];
    }
    // Skills: reorder only.
    const originalByKey = new Map(original.skills.map((s) => [norm(s), s]));
    const kept: string[] = [];
    const seen = new Set<string>();
    for (const s of out.skills) {
      const key = norm(s);
      const orig = originalByKey.get(key);
      if (orig && !seen.has(key)) {
        kept.push(orig);
        seen.add(key);
      } else if (!orig) {
        warnings.push(`تم حذف المهارة «${s}» لأنها غير موجودة في سيرتك الأصلية.`);
      }
    }
    for (const s of original.skills) if (!seen.has(norm(s))) kept.push(s);
    out.skills = kept;

    // Projects: names are facts, descriptions may be rephrased.
    if (out.projects.length !== original.projects.length) {
      out.projects = structuredClone(original.projects);
    } else {
      out.projects = out.projects.map((p, i) => ({
        name: original.projects[i].name,
        description: hasUnknownNumber(p.description, known)
          ? original.projects[i].description
          : p.description,
      }));
    }
  }

  return { cv: out, warnings };
}
