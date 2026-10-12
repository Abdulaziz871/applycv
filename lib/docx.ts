import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
  type IRunOptions,
  type ISpacingProperties,
} from "docx";
import { blockDir, cvLanguage, langDir } from "./lang";
import type { Cv } from "./schemas";

/**
 * Editable Word version of the CV. Mirrors the single template in cv-template.tsx
 * (same sections, order, colours and per-block text direction) using native Word
 * paragraphs, so the file stays ATS friendly and easy to edit.
 */

const LABELS = {
  ar: {
    summary: "الملخص المهني",
    experience: "الخبرة العملية",
    education: "التعليم",
    skills: "المهارات",
    languages: "اللغات",
    certifications: "الشهادات",
    projects: "المشاريع",
  },
  en: {
    summary: "Summary",
    experience: "Experience",
    education: "Education",
    skills: "Skills",
    languages: "Languages",
    certifications: "Certifications",
    projects: "Projects",
  },
};

const ACCENT = "3F6B6A";
const TEXT = "1F2933";
const MUTED = "4B5563";
const FONT = { ascii: "Calibri", hAnsi: "Calibri", cs: "Arial" };
// A4 with 18mm margins, in twips.
const MARGIN = 1020;
const CONTENT_WIDTH = 11906 - 2 * MARGIN;

const pt = (n: number) => Math.round(n * 2); // docx sizes are half-points
const join = (parts: string[], sep = " · ") => parts.filter((p) => p.trim()).join(sep);
const dateRange = (start: string, end: string) => (start && end ? `${start} – ${end}` : start || end);

export function buildCvDocx(cv: Cv): Document {
  const lang = cvLanguage(cv);
  const t = LABELS[lang];
  const docDir = langDir(lang);
  const rtl = (text: string) => blockDir(text, docDir) === "rtl";

  const run = (text: string, opts: IRunOptions = {}) =>
    new TextRun({
      text,
      font: FONT,
      size: pt(10.5),
      sizeComplexScript: pt(10.5),
      color: TEXT,
      rightToLeft: rtl(text),
      ...opts,
      ...(opts.size ? { sizeComplexScript: opts.size } : {}),
      ...(opts.bold ? { boldComplexScript: true } : {}),
    });

  const para = (text: string, runOpts: IRunOptions = {}, spacing: ISpacingProperties = { after: 60 }) =>
    new Paragraph({ bidirectional: rtl(text), spacing, children: [run(text, runOpts)] });

  const heading = (title: string) =>
    new Paragraph({
      bidirectional: docDir === "rtl",
      keepNext: true,
      spacing: { before: 240, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 2 } },
      children: [run(title, { bold: true, size: pt(11.5), color: ACCENT, rightToLeft: docDir === "rtl" })],
    });

  /** Title on the start side, dates on the end side (like the flex row in the template). */
  const entryHead = (title: string, dates: string) =>
    new Paragraph({
      bidirectional: docDir === "rtl",
      keepNext: true,
      spacing: { before: 120, after: 20 },
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
      children: [
        run(title, { bold: true }),
        ...(dates ? [run("\t" + dates, { size: pt(9.5), color: MUTED, rightToLeft: false })] : []),
      ],
    });

  const bullet = (text: string) =>
    new Paragraph({ bidirectional: rtl(text), bullet: { level: 0 }, spacing: { after: 30 }, children: [run(text)] });

  const children: Paragraph[] = [];
  const contact = [cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links].filter((s) =>
    s.trim(),
  );

  children.push(para(cv.name, { bold: true, size: pt(22) }, { after: 40 }));
  if (cv.headline) children.push(para(cv.headline, { bold: true, size: pt(12), color: ACCENT }, { after: 60 }));
  if (contact.length) {
    children.push(
      new Paragraph({
        bidirectional: docDir === "rtl",
        spacing: { after: 120 },
        children: contact.flatMap((c, i) => [
          ...(i > 0 ? [run(" | ", { color: "B8B4A6", size: pt(9.5) })] : []),
          run(c, { color: MUTED, size: pt(9.5) }),
        ]),
      }),
    );
  }

  if (cv.summary.trim()) children.push(heading(t.summary), para(cv.summary));

  if (cv.experience.length) {
    children.push(heading(t.experience));
    for (const e of cv.experience) {
      children.push(entryHead(e.title, dateRange(e.start, e.end)));
      const sub = join([e.company, e.location]);
      if (sub) children.push(para(sub, { color: MUTED, size: pt(10) }, { after: 40 }));
      for (const b of e.bullets) children.push(bullet(b));
    }
  }

  if (cv.education.length) {
    children.push(heading(t.education));
    for (const e of cv.education) {
      children.push(entryHead(e.degree || e.institution, dateRange(e.start, e.end)));
      const sub = e.degree ? join([e.institution, e.location]) : e.location;
      if (sub) children.push(para(sub, { color: MUTED, size: pt(10) }, { after: 40 }));
      if (e.details.trim()) children.push(para(e.details));
    }
  }

  const listSep = lang === "ar" ? "، " : ", ";
  if (cv.skills.length) children.push(heading(t.skills), para(cv.skills.join(listSep)));

  if (cv.projects.length) {
    children.push(heading(t.projects));
    for (const p of cv.projects) {
      children.push(para(p.name, { bold: true }, { before: 120, after: 20 }));
      if (p.description.trim()) children.push(para(p.description));
    }
  }

  if (cv.certifications.length) {
    children.push(heading(t.certifications));
    for (const c of cv.certifications) children.push(bullet(c));
  }

  if (cv.languages.length) children.push(heading(t.languages), para(cv.languages.join(listSep)));

  return new Document({
    creator: cv.name || "CV",
    title: cv.name || "CV",
    styles: { default: { document: { run: { font: FONT, size: pt(10.5) } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        children,
      },
    ],
  });
}

export const renderCvDocx = (cv: Cv): Promise<Blob> => Packer.toBlob(buildCvDocx(cv));
