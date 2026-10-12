import { z } from "zod";

/**
 * LinkedIn auto-apply settings, shared by the /linkedin page and the Chrome
 * extension (in /extension). Client-safe: no server imports here.
 */

const short = z.string().max(500);

export const linkedinSettingsSchema = z.object({
  enabled: z.boolean(),
  /** "auto" submits; "dry" fills everything then discards (for testing). */
  submitMode: z.enum(["auto", "dry"]),
  titles: z.array(short).min(1).max(15),
  location: short,
  /** A job title must contain at least one of these (case-insensitive). */
  titleInclude: z.array(short).max(60),
  /** A job title containing any of these is skipped. */
  titleExclude: z.array(short).max(60),
  /** Local times "HH:MM". */
  times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(6),
  maxPerRun: z.number().int().min(1).max(25),
  maxPerDay: z.number().int().min(1).max(50),
  answers: z.object({
    phoneCountry: short,
    /** National number without the leading 0, as LinkedIn expects with a country code. */
    phoneNational: short,
    city: short,
    nationality: short,
    residency: short,
    expectedSalary: z.number().int().min(0).max(1_000_000),
    salaryCurrency: short,
    noticeDays: z.number().int().min(0).max(365),
    totalYears: z.number().min(0).max(50),
    /** "skill: years" per line, e.g. "Python: 2". */
    skillYears: z.string().max(3000),
    /** Free-text facts for anything else (sponsorship, relocation, languages…). */
    extraFacts: z.string().max(3000),
  }),
});
export type LinkedinSettings = z.infer<typeof linkedinSettingsSchema>;

export const defaultLinkedinSettings = (): LinkedinSettings => ({
  enabled: false,
  submitMode: "dry",
  titles: ["Full Stack Developer", "Software Engineer", "AI Engineer", "Data Scientist", "Data Analyst"],
  location: "Riyadh",
  titleInclude: [
    "developer", "engineer", "software", "full stack", "full-stack", "fullstack", "frontend", "front-end",
    "backend", "back-end", "web", "data", "ai", "artificial intelligence", "machine learning", "ml",
    "analyst", "analytics", "scientist", "bi", "business intelligence", "python", "llm", "مطور", "مهندس", "بيانات",
  ],
  titleExclude: [
    "civil", "mechanical", "electrical", "chemical", "sales", "marketing", "hse", "safety", "nurse",
    "accountant", "architect", "director", "head of", "vp", "chief",
  ],
  times: ["10:00", "14:00", "17:00"],
  maxPerRun: 5,
  maxPerDay: 12,
  answers: {
    phoneCountry: "Saudi Arabia (+966)",
    phoneNational: "",
    city: "Riyadh, Saudi Arabia",
    nationality: "",
    residency: "",
    expectedSalary: 0,
    salaryCurrency: "SAR",
    noticeDays: 0,
    totalYears: 0,
    skillYears: "",
    extraFacts: "",
  },
});
