import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRateLimitForTests,
  createSessionToken,
  loginBlockedFor,
  passwordMatches,
  recordLoginFailure,
  verifySessionToken,
} from "@/lib/auth";
import { computeChanges, revertChange, wordDiff } from "@/lib/diff";
import { pdfFileName } from "@/lib/filename";
import { cvLanguage, detectLang, dirOf, toLatinDigits } from "@/lib/lang";
import { maskContactDetails, restoreTokens, stripContact } from "@/lib/privacy";
import { sanitizeTailored } from "@/lib/sanitize";
import { sampleCvAr, sampleCvEn } from "./helpers";

describe("language detection", () => {
  it("detects Arabic and English", () => {
    expect(detectLang("محاسبة أولى بخبرة طويلة")).toBe("ar");
    expect(detectLang("Senior engineer with React")).toBe("en");
    expect(detectLang("12345", "ar")).toBe("ar");
    expect(dirOf("سلام hello")).toBe("rtl");
    expect(dirOf("hello سلام")).toBe("ltr");
    expect(cvLanguage(sampleCvAr())).toBe("ar");
    expect(cvLanguage(sampleCvEn())).toBe("en");
  });
  it("converts Arabic-Indic digits", () => {
    expect(toLatinDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲")).toBe("0123456789 012");
  });
});

describe("contact masking (privacy)", () => {
  it("masks emails and phones but not years / date ranges", () => {
    const text = "Omar\nomar@example.com | +971 50 123 4567\nLed team 2019-2022 and 2020 - 2023, grew revenue 300000 yearly";
    const { masked, emails, phones } = maskContactDetails(text);
    expect(emails).toEqual(["omar@example.com"]);
    expect(phones).toHaveLength(1);
    expect(masked).not.toContain("omar@example.com");
    expect(masked).not.toContain("123 4567");
    expect(masked).toContain("2019-2022");
    expect(masked).toContain("2020 - 2023");
  });
  it("masks Arabic-Indic phone numbers", () => {
    const { masked, phones } = maskContactDetails("الجوال: ٠٥٠١٢٣٤٥٦٧");
    expect(phones).toHaveLength(1);
    expect(masked).not.toMatch(/٠٥٠/);
  });
  it("restores leaked tokens and strips the contact block", () => {
    const { tokens } = maskContactDetails("a@b.com");
    expect(restoreTokens({ x: ["[[EMAIL_1]]"] }, tokens)).toEqual({ x: ["a@b.com"] });
    expect("contact" in stripContact(sampleCvEn())).toBe(false);
  });
});

describe("change tracking", () => {
  it("computes per-bullet changes and reverts them", () => {
    const original = sampleCvEn();
    const current = structuredClone(original);
    current.summary = "New summary";
    current.experience[0].bullets[1] = "Coached 5 junior developers.";
    current.skills = ["React", "TypeScript", "HTML", "CSS", "Jest"];
    const changes = computeChanges(original, current);
    expect(changes.map((c) => c.path)).toEqual(["summary", "experience.0.bullets.1", "skills"]);
    const reverted = revertChange(original, current, "experience.0.bullets.1");
    expect(reverted.experience[0].bullets[1]).toBe(original.experience[0].bullets[1]);
    expect(reverted.summary).toBe("New summary"); // other changes untouched
    expect(computeChanges(original, revertChange(original, reverted, "summary"))).toHaveLength(1);
  });
  it("highlights added/removed words", () => {
    const d = wordDiff("Built a dashboard", "Built a fast dashboard");
    expect(d.after.filter((s) => s.kind === "added").map((s) => s.text.trim()).filter(Boolean)).toEqual(["fast"]);
    expect(d.before.every((s) => s.kind === "same")).toBe(true);
  });
});

describe("anti-fabrication guards", () => {
  const original = sampleCvEn();
  const base = () => stripContact(structuredClone(original));

  it("restores facts the model altered", () => {
    const t = base();
    t.experience[0].company = "Google";
    t.experience[0].start = "2010";
    t.experience[0].title = "CTO";
    t.name = "Someone Else";
    t.headline = "Principal Architect";
    const { cv } = sanitizeTailored(original, t, { translating: false });
    expect(cv.experience[0].company).toBe("Noon Digital");
    expect(cv.experience[0].start).toBe("Jan 2021");
    expect(cv.experience[0].title).toBe("Senior Frontend Engineer");
    expect(cv.name).toBe(original.name);
    expect(cv.headline).toBe(original.headline);
    expect(cv.contact).toEqual(original.contact);
  });

  it("removes invented skills but keeps reordering", () => {
    const t = base();
    t.skills = ["Kubernetes", "TypeScript", "React", "CSS", "HTML"];
    const { cv, warnings } = sanitizeTailored(original, t, { translating: false });
    expect(cv.skills).toEqual(["TypeScript", "React", "CSS", "HTML", "Jest"]);
    expect(warnings.some((w) => w.includes("Kubernetes"))).toBe(true);
  });

  it("rejects invented numbers in bullets and summary", () => {
    const t = base();
    t.experience[0].bullets[0] = "Led migration and improved page load time by 65%.";
    t.summary = "Engineer with 15 years of experience.";
    const { cv, warnings } = sanitizeTailored(original, t, { translating: false });
    expect(cv.experience[0].bullets).toEqual(original.experience[0].bullets);
    expect(cv.summary).toBe(original.summary);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts legitimate rephrasing that reuses existing numbers", () => {
    const t = base();
    t.experience[0].bullets[1] = "Coached 5 junior developers via code reviews.";
    const { cv, warnings } = sanitizeTailored(original, t, { translating: false });
    expect(cv.experience[0].bullets[1]).toBe("Coached 5 junior developers via code reviews.");
    expect(warnings).toHaveLength(0);
  });

  it("never lets the model drop/add experience or education", () => {
    const t = base();
    t.experience.pop();
    t.education = [];
    const { cv } = sanitizeTailored(original, t, { translating: false });
    expect(cv.experience).toHaveLength(2);
    expect(cv.education).toEqual(original.education);
  });
});

describe("file names", () => {
  it("builds FirstName_LastName_Company.pdf", () => {
    expect(pdfFileName("Omar Al-Hassan", "Noon Digital")).toBe("Omar_Al-Hassan_Noon_Digital.pdf");
    expect(pdfFileName("Mohammed Ali Khan", "A/B: Co?")).toBe("Mohammed_Khan_A_B_Co.pdf");
    expect(pdfFileName("سارة محمد العتيبي", "")).toBe("سارة_العتيبي.pdf");
    expect(pdfFileName("", "")).toBe("CV.pdf");
  });
});

describe("auth", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
    process.env.APP_PASSWORD = "correct horse";
    __resetRateLimitForTests();
  });
  it("signs and verifies session tokens; rejects tampering", async () => {
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
    expect(await verifySessionToken(token.slice(0, -3) + "abc")).toBe(false);
    expect(await verifySessionToken("garbage")).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
    process.env.SESSION_SECRET = "another-secret-another-secret-12345678";
    expect(await verifySessionToken(token)).toBe(false);
  });
  it("compares the password", () => {
    expect(passwordMatches("correct horse")).toBe(true);
    expect(passwordMatches("wrong")).toBe(false);
    expect(passwordMatches("")).toBe(false);
  });
  it("rate-limits repeated failures", () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) recordLoginFailure("1.2.3.4", now);
    expect(loginBlockedFor("1.2.3.4", now + 1000)).toBeGreaterThan(0);
    expect(loginBlockedFor("9.9.9.9", now)).toBe(0);
    expect(loginBlockedFor("1.2.3.4", now + 16 * 60 * 1000)).toBe(0);
  });
});
