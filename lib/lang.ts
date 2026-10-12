import type { Cv } from "./schemas";

export type Lang = "ar" | "en";

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;

/** Detects the dominant script of a text. Empty/neutral text → fallback. */
export function detectLang(text: string, fallback: Lang = "en"): Lang {
  const ar = text.match(ARABIC)?.length ?? 0;
  const en = text.match(LATIN)?.length ?? 0;
  if (ar === 0 && en === 0) return fallback;
  return ar >= en ? "ar" : "en";
}

/** Direction of a single block: decided by its first strong character. */
export function dirOf(text: string, fallback: "rtl" | "ltr" = "rtl"): "rtl" | "ltr" {
  for (const ch of text) {
    if (/[֐-ࣿיִ-﷿ﹰ-﻿]/.test(ch)) return "rtl";
    if (/[A-Za-z]/.test(ch)) return "ltr";
  }
  return fallback;
}

/**
 * Direction of a text block by its DOMINANT script (not its first character), so an
 * Arabic list that happens to start with "Excel" stays RTL. Ties/neutral → fallback.
 */
export function blockDir(text: string, fallback: "rtl" | "ltr"): "rtl" | "ltr" {
  const ar = text.match(ARABIC)?.length ?? 0;
  const en = text.match(LATIN)?.length ?? 0;
  if (ar === 0 && en === 0) return fallback;
  return ar >= en ? "rtl" : "ltr";
}

export const langDir = (l: Lang): "rtl" | "ltr" => (l === "ar" ? "rtl" : "ltr");

/** Converts Arabic-Indic / Persian digits to Latin digits. */
export function toLatinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export const wordCount = (s: string): number =>
  s.trim() ? s.trim().split(/\s+/).length : 0;

/** Language of the CV document itself (drives template direction and labels). */
export function cvLanguage(cv: Cv): Lang {
  const sample = [cv.summary, cv.headline, ...cv.experience.flatMap((e) => e.bullets)].join(" ");
  return detectLang(sample || cv.name, "en");
}
