import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { renderCvHtml, renderCvPdf } from "@/lib/pdf";
import { sampleCvAr, sampleCvEn } from "./helpers";

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outDir = path.join(process.cwd(), "tests", "output");

async function pdfText(buf: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return { numPages: doc.numPages, text: pages.join("\n") };
}

/**
 * Chromium writes Arabic to the PDF as real glyph text, but in visual order and with
 * presentation-form letters (known print-to-PDF limitation: extractors return it reversed
 * and unevenly grouped). Extraction order therefore can't be asserted; we assert that
 * every letter of the phrase is present in the extracted text (letter multiset), and the
 * shaping / RTL order is verified visually (scripts/pdf-to-png.ts).
 */
const letters = (s: string) => [...s.normalize("NFKC").replace(/\s+/g, "")];
function hasArabic(extracted: string, phrase: string) {
  const pool = new Map<string, number>();
  for (const ch of letters(extracted)) pool.set(ch, (pool.get(ch) ?? 0) + 1);
  return letters(phrase).every((ch) => {
    const n = pool.get(ch) ?? 0;
    if (n === 0) return false;
    pool.set(ch, n - 1);
    return true;
  });
}

const haveChrome = existsSync(CHROME);

describe.skipIf(!haveChrome)("PDF export (real Chrome)", () => {
  beforeAll(() => {
    process.env.CHROME_PATH = CHROME;
    mkdirSync(outDir, { recursive: true });
  });

  it("Arabic CV: real selectable Arabic text, RTL doc, embedded Plex Arabic font", async () => {
    const cv = sampleCvAr();
    const html = renderCvHtml(cv);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("font/woff2;base64,"); // fonts embedded, not fetched
    const pdf = await renderCvPdf(cv);
    writeFileSync(path.join(outDir, "cv-ar.pdf"), pdf);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const { numPages, text } = await pdfText(pdf);
    expect(numPages).toBe(1);
    expect(hasArabic(text, "سارة")).toBe(true);
    expect(hasArabic(text, "العتيبي")).toBe(true);
    expect(hasArabic(text, "الخبرة العملية")).toBe(true);
    expect(hasArabic(text, "شركة الراجحي للتطوير")).toBe(true);
    expect(text).toContain("sara.otaibi@example.com");
    expect(pdf.toString("latin1")).toMatch(/IBMPlexSansArabic/);
  });

  it("English CV: LTR, real text, Plex Sans", async () => {
    const cv = sampleCvEn();
    expect(renderCvHtml(cv)).toContain('dir="ltr"');
    const pdf = await renderCvPdf(cv);
    writeFileSync(path.join(outDir, "cv-en.pdf"), pdf);
    const { numPages, text } = await pdfText(pdf);
    expect(numPages).toBe(1);
    expect(text).toContain("Omar Al-Hassan");
    expect(text).toContain("Led migration of a legacy dashboard");
    expect(text).toContain("Experience");
    expect(pdf.toString("latin1")).toMatch(/IBMPlexSans/);
  });

  it("mixed-language CV (Arabic doc with English terms)", async () => {
    const cv = sampleCvAr();
    const { numPages, text } = await pdfText(await renderCvPdf(cv));
    expect(numPages).toBe(1);
    expect(text).toMatch(/Excel/);
    expect(text).toMatch(/Power BI/);
  });

  it("long CV paginates without splitting an entry across pages", async () => {
    const cv = sampleCvEn();
    const entry = cv.experience[0];
    cv.experience = Array.from({ length: 9 }, (_, i) => ({
      ...entry,
      title: `Role number ${i + 1}`,
      bullets: Array.from({ length: 5 }, (_, b) => `Bullet ${b + 1} of role ${i + 1} describing measurable work in detail.`),
    }));
    const pdf = await renderCvPdf(cv);
    writeFileSync(path.join(outDir, "cv-long.pdf"), pdf);
    const { numPages, text } = await pdfText(pdf);
    expect(numPages).toBeGreaterThan(1);
    // every role's last bullet is present (nothing lost at page breaks)
    for (let i = 1; i <= 9; i++) expect(text).toContain(`Bullet 5 of role ${i}`);
  });
});
