import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import puppeteer from "puppeteer-core";
import { CvDocument, cvCss } from "./cv-template";
import { cvLanguage } from "./lang";
import type { Cv } from "./schemas";

/**
 * Route handlers are bundled with the "react-server" condition, where react-dom/server is
 * an empty module. The template is plain markup (no hooks), so we load the regular
 * react-dom/server through Node's own resolver at runtime.
 */
function renderToStaticMarkup(element: ReactElement): string {
  const req = createRequire(path.join(process.cwd(), "package.json"));
  return (req("react-dom/server") as typeof import("react-dom/server")).renderToStaticMarkup(element);
}

const FONT_FILES: [family: string, weight: number, file: string][] = [
  ["CVArabic", 400, "plex-arabic-400.woff2"],
  ["CVArabic", 600, "plex-arabic-600.woff2"],
  ["CVArabic", 700, "plex-arabic-700.woff2"],
  ["CVLatin", 400, "plex-latin-400.woff2"],
  ["CVLatin", 600, "plex-latin-600.woff2"],
  ["CVLatin", 700, "plex-latin-700.woff2"],
];

let fontCss: string | null = null;

/** Fonts are bundled in the repo and embedded as base64: Vercel's Chromium has no Arabic fonts. */
function embeddedFontCss(): string {
  if (fontCss) return fontCss;
  const dir = path.join(process.cwd(), "public", "fonts");
  fontCss = FONT_FILES.map(([family, weight, file]) => {
    const b64 = readFileSync(path.join(dir, file)).toString("base64");
    return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  }).join("\n");
  return fontCss;
}

export function renderCvHtml(cv: Cv): string {
  const lang = cvLanguage(cv);
  const body = renderToStaticMarkup(createElement(CvDocument, { cv, lang }));
  return `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${escapeHtml(
    cv.name || "CV",
  )}</title><style>${embeddedFontCss()}
@page { size: A4; margin: 14mm 16mm; }
html, body { margin: 0; padding: 0; background: #fff; }
${cvCss}</style></head><body>${body}</body></html>`;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function launchBrowser() {
  const local = process.env.CHROME_PATH;
  if (local) {
    return puppeteer.launch({
      executablePath: local,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });
  }
  const { default: chromium } = await import("@sparticuz/chromium");
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });
}

export async function renderCvPdf(cv: Cv): Promise<Buffer> {
  const html = renderCvHtml(cv);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
