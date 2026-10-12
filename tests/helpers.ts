import { readFileSync } from "node:fs";
import path from "node:path";
import type { Application, Cv } from "@/lib/schemas";

export const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests", "fixtures", name));

export const sampleCvEn = (): Cv => ({
  name: "Omar Al-Hassan",
  headline: "Senior Frontend Engineer",
  contact: {
    email: "omar.hassan@example.com",
    phone: "+971 50 123 4567",
    location: "Dubai, UAE",
    links: ["linkedin.com/in/omar-hassan"],
  },
  summary:
    "Frontend engineer with 8 years of experience building web applications in React and TypeScript. Improved page load time by 40%.",
  experience: [
    {
      title: "Senior Frontend Engineer",
      company: "Noon Digital",
      location: "",
      start: "Jan 2021",
      end: "Present",
      bullets: [
        "Led migration of a legacy dashboard to React and TypeScript, improving page load time by 40%.",
        "Mentored 5 junior developers through code reviews.",
      ],
    },
    {
      title: "Frontend Developer",
      company: "Careem",
      location: "",
      start: "Mar 2017",
      end: "Dec 2020",
      bullets: ["Developed responsive web interfaces with JavaScript, HTML and CSS."],
    },
  ],
  education: [
    { degree: "BSc Computer Science", institution: "American University of Sharjah", location: "", start: "2013", end: "2017", details: "" },
  ],
  skills: ["HTML", "CSS", "React", "TypeScript", "Jest"],
  languages: ["Arabic — Native", "English — Fluent"],
  certifications: ["AWS Certified Cloud Practitioner"],
  projects: [],
});

export const sampleCvAr = (): Cv => ({
  name: "سارة محمد العتيبي",
  headline: "محاسبة أولى",
  contact: { email: "sara.otaibi@example.com", phone: "0501234567", location: "الرياض، السعودية", links: [] },
  summary: "محاسبة بخبرة تزيد على 6 سنوات في إعداد القوائم المالية والتقارير الشهرية وإدارة الحسابات الدائنة والمدينة.",
  experience: [
    {
      title: "محاسبة أولى",
      company: "شركة الراجحي للتطوير",
      location: "الرياض",
      start: "2020",
      end: "حتى الآن",
      bullets: [
        "إعداد القوائم المالية الشهرية والربع سنوية وتسليمها في الموعد المحدد.",
        "خفض زمن إغلاق الحسابات الشهري من 10 أيام إلى 6 أيام.",
        "إدارة الحسابات الدائنة والمدينة لأكثر من 120 مورداً مع استخدام Excel و SAP.",
      ],
    },
    {
      title: "محاسبة",
      company: "مجموعة الفيصلية",
      location: "",
      start: "2017",
      end: "2020",
      bullets: ["مراجعة القيود اليومية والتسويات البنكية.", "إعداد تقارير ضريبة القيمة المضافة."],
    },
  ],
  education: [{ degree: "بكالوريوس محاسبة", institution: "جامعة الملك سعود", location: "", start: "2013", end: "2017", details: "" }],
  skills: ["Excel", "SAP", "إعداد القوائم المالية", "ضريبة القيمة المضافة", "التسويات البنكية", "Power BI"],
  languages: ["العربية — لغة أم", "الإنجليزية — جيد جداً"],
  certifications: [],
  projects: [],
});

export const sampleApplication = (id: string, over: Partial<Application> = {}): Application => ({
  id,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  company: "Acme",
  jobTitle: "Engineer",
  hasJobDescription: true,
  language: "en",
  cv: sampleCvEn(),
  coverLetter: "Dear Acme,\n\nHello.\n\nKind regards,\nOmar",
  ...over,
});

/** In-memory localStorage stand-in for lib/storage tests. */
export function installFakeLocalStorage() {
  const data = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage, dispatchEvent: () => true };
  return { data, localStorage };
}
