/**
 * Generates sample CV fixtures (.docx) used by the tests:  npm run fixtures
 * Data is fictional.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

const out = (f: string) => path.join(process.cwd(), "tests", "fixtures", f);

function para(text: string, opts: { rtl?: boolean; bold?: boolean; heading?: boolean; size?: number } = {}) {
  return new Paragraph({
    bidirectional: opts.rtl,
    heading: opts.heading ? HeadingLevel.HEADING_2 : undefined,
    children: [new TextRun({ text, rightToLeft: opts.rtl, bold: opts.bold || opts.heading, size: opts.size })],
  });
}

async function build(file: string, lines: { t: string; h?: boolean; b?: boolean; s?: number }[], rtl: boolean) {
  const doc = new Document({
    sections: [{ children: lines.map((l) => para(l.t, { rtl, heading: l.h, bold: l.b, size: l.s })) }],
  });
  writeFileSync(out(file), await Packer.toBuffer(doc));
}

const en = [
  { t: "Omar Al-Hassan", b: true, s: 40 },
  { t: "Senior Frontend Engineer" },
  { t: "omar.hassan@example.com | +971 50 123 4567 | Dubai, UAE | linkedin.com/in/omar-hassan" },
  { t: "Summary", h: true },
  { t: "Frontend engineer with 8 years of experience building web applications in React and TypeScript. Improved page load time by 40% and mentored 5 junior developers." },
  { t: "Experience", h: true },
  { t: "Senior Frontend Engineer | Noon Digital | Jan 2021 - Present" },
  { t: "- Led migration of a legacy dashboard to React and TypeScript, improving page load time by 40%." },
  { t: "- Mentored 5 junior developers through code reviews and pairing sessions." },
  { t: "- Built a reusable component library used by 6 product teams." },
  { t: "Frontend Developer | Careem | Mar 2017 - Dec 2020" },
  { t: "- Developed responsive web interfaces with JavaScript, HTML and CSS." },
  { t: "- Wrote unit and integration tests with Jest." },
  { t: "Education", h: true },
  { t: "BSc Computer Science | American University of Sharjah | 2013 - 2017" },
  { t: "Skills", h: true },
  { t: "React, TypeScript, JavaScript, HTML, CSS, Jest, Git, Node.js, Figma" },
  { t: "Languages", h: true },
  { t: "Arabic - Native" },
  { t: "English - Fluent" },
  { t: "Certifications", h: true },
  { t: "AWS Certified Cloud Practitioner" },
];

const ar = [
  { t: "سارة محمد العتيبي", b: true, s: 40 },
  { t: "محاسبة أولى" },
  { t: "sara.otaibi@example.com | 0501234567 | الرياض، السعودية" },
  { t: "الملخص المهني", h: true },
  { t: "محاسبة بخبرة تزيد على 6 سنوات في إعداد القوائم المالية والتقارير الشهرية وإدارة الحسابات الدائنة والمدينة، مع إتقان للتعامل مع أنظمة ERP." },
  { t: "الخبرات", h: true },
  { t: "محاسبة أولى | شركة الراجحي للتطوير | 2020 - حتى الآن" },
  { t: "- إعداد القوائم المالية الشهرية والربع سنوية وتسليمها في الموعد المحدد." },
  { t: "- خفض زمن إغلاق الحسابات الشهري من 10 أيام إلى 6 أيام." },
  { t: "- إدارة الحسابات الدائنة والمدينة لأكثر من 120 مورداً." },
  { t: "محاسبة | مجموعة الفيصلية | 2017 - 2020" },
  { t: "- مراجعة القيود اليومية والتسويات البنكية." },
  { t: "- إعداد تقارير ضريبة القيمة المضافة." },
  { t: "التعليم", h: true },
  { t: "بكالوريوس محاسبة | جامعة الملك سعود | 2013 - 2017" },
  { t: "المهارات", h: true },
  { t: "Excel، SAP، إعداد القوائم المالية، ضريبة القيمة المضافة، التسويات البنكية، Power BI" },
  { t: "اللغات", h: true },
  { t: "العربية - لغة أم" },
  { t: "الإنجليزية - جيد جداً" },
];

async function main() {
  await build("cv-en.docx", en, false);
  await build("cv-ar.docx", ar, true);
  // a non-docx file with a .docx name, to test rejection
  writeFileSync(out("not-a-docx.docx"), "this is plain text, not a zip file");
  console.log("fixtures written to tests/fixtures");
}
void main();
