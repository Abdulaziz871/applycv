import type { AiProvider, GenerateJsonOptions } from "./ai";
import { fallbackCoverLetter } from "./cover-fallback";
import { detectLang } from "./lang";
import { emptyCv, type Cv, type CvNoContact } from "./schemas";

/**
 * Deterministic offline provider for local development and automated tests
 * (AI_PROVIDER=mock, disabled in production). It performs NO real AI work:
 * a heading-based CV parser, a skills reorder, and a template cover letter.
 */

const SECTION_HEADS: Record<string, string> = {
  summary: "summary", "professional summary": "summary", profile: "summary", "الملخص المهني": "summary", "نبذة": "summary", "الملخص": "summary",
  experience: "experience", "work experience": "experience", "الخبرات": "experience", "الخبرة العملية": "experience", "الخبرات العملية": "experience",
  education: "education", "التعليم": "education", "المؤهلات العلمية": "education",
  skills: "skills", "المهارات": "skills",
  languages: "languages", "اللغات": "languages",
  certifications: "certifications", "الشهادات": "certifications",
  projects: "projects", "المشاريع": "projects",
};

function mockParse(raw: string): Cv {
  const cv = emptyCv();
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  cv.name = lines[0] ?? "";
  let i = 1;
  if (lines[1] && !SECTION_HEADS[lines[1].toLowerCase()] && !lines[1].includes("[[")) {
    cv.headline = lines[1];
    i = 2;
  }
  let section = "";
  const buckets: Record<string, string[]> = {};
  for (; i < lines.length; i++) {
    const head = SECTION_HEADS[lines[i].toLowerCase().replace(/[:：]$/, "")];
    if (head) {
      section = head;
      buckets[section] ??= [];
      continue;
    }
    if (!section) {
      if (/\|/.test(lines[i]) && !cv.contact.location) {
        const loc = lines[i].split("|").map((s) => s.trim()).find((p) => p && !p.includes("[["));
        if (loc) cv.contact.location = loc;
      }
      continue;
    }
    buckets[section].push(lines[i]);
  }
  cv.summary = (buckets.summary ?? []).join(" ");
  cv.skills = (buckets.skills ?? []).join(",").split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  cv.languages = buckets.languages ?? [];
  cv.certifications = buckets.certifications ?? [];
  // experience: "Title | Company | Start - End" then bullets starting with -/•
  let cur: Cv["experience"][number] | null = null;
  for (const l of buckets.experience ?? []) {
    if (/^[-•*]\s*/.test(l)) {
      cur?.bullets.push(l.replace(/^[-•*]\s*/, ""));
    } else {
      const [title = "", company = "", dates = ""] = l.split("|").map((s) => s.trim());
      const [start = "", end = ""] = dates.split(/\s[-–—]\s/);
      cur = { title, company, location: "", start, end, bullets: [] };
      cv.experience.push(cur);
    }
  }
  for (const l of buckets.education ?? []) {
    const [degree = "", institution = "", dates = ""] = l.split("|").map((s) => s.trim());
    const [start = "", end = ""] = dates.split(/\s[-–—]\s/);
    cv.education.push({ degree, institution, location: "", start, end, details: "" });
  }
  return cv;
}

export class MockProvider implements AiProvider {
  async generateJson<T>({ system, prompt, schema }: GenerateJsonOptions<T>): Promise<T> {
    let data: unknown;
    if (system.startsWith("You are a precise CV")) {
      data = mockParse(prompt.replace(/^[\s\S]*?<<<\n?/, "").replace(/\n?>>>[\s\S]*$/, ""));
    } else if (system.startsWith("You are an expert CV editor")) {
      const jd = prompt.match(/JOB DESCRIPTION:\n<<<\n([\s\S]*?)\n>>>/)?.[1] ?? "";
      const cv = JSON.parse(prompt.split("CANDIDATE CV (JSON):\n")[1]) as CvNoContact;
      const company = (prompt.match(/COMPANY: (.*)/)?.[1] ?? "").replace("(not provided)", "");
      const jobTitle = (prompt.match(/JOB TITLE: (.*)/)?.[1] ?? "").replace("(not provided)", "");
      const lang = /OUTPUT LANGUAGE: Arabic/.test(prompt) ? "ar" : "en";
      const jdLower = jd.toLowerCase();
      const skills = [...cv.skills].sort(
        (a, b) => Number(jdLower.includes(b.toLowerCase())) - Number(jdLower.includes(a.toLowerCase())),
      );
      const tailored: CvNoContact = structuredClone(cv);
      tailored.skills = skills;
      const changes = [] as { path: string; before: string; after: string; reason_ar: string }[];
      if (cv.summary) {
        tailored.summary = cv.summary + (lang === "ar" ? " أركّز على تلبية متطلبات هذه الوظيفة." : " Focused on the needs of this role.");
        changes.push({ path: "summary", before: cv.summary, after: tailored.summary, reason_ar: "تكييف الملخص مع متطلبات الوظيفة." });
      }
      const b0 = tailored.experience[0]?.bullets[0];
      if (b0) {
        tailored.experience[0].bullets[0] = b0.replace(/^(\S+)/, (w) => (detectLang(w) === "en" ? "Led: " + w : w));
      }
      if (JSON.stringify(skills) !== JSON.stringify(cv.skills)) {
        changes.push({ path: "skills", before: cv.skills.join(", "), after: skills.join(", "), reason_ar: "ترتيب المهارات الأقرب للوظيفة أولاً." });
      }
      const missing = ["Kubernetes", "GraphQL"].filter((k) => jdLower.includes(k.toLowerCase()) && !cv.skills.join(" ").toLowerCase().includes(k.toLowerCase()));
      data = {
        cv: tailored,
        changes,
        missing_skills: missing,
        cover_letter: fallbackCoverLetter(cv, lang, company, jobTitle),
      };
    } else if (system.startsWith("You answer ONE question")) {
      // first option for choices, otherwise "unknown" (the extension then skips the job)
      const first = prompt.match(/OPTIONS:\n- (.*)/)?.[1];
      data = first ? { known: true, answer: first } : { known: false, answer: "" };
    } else {
      const cv = JSON.parse(prompt.split("CANDIDATE CV DATA (JSON):\n")[1]) as Cv;
      const company = prompt.match(/COMPANY: (.*)/)?.[1] ?? "";
      const jobTitle = prompt.match(/JOB TITLE: (.*)/)?.[1] ?? "";
      const lang = /OUTPUT LANGUAGE: Arabic/.test(prompt) ? "ar" : "en";
      data = { cover_letter: fallbackCoverLetter(cv, lang, company === "(not provided)" ? "" : company, jobTitle === "(not provided)" ? "" : jobTitle) };
    }
    return schema.parse(data);
  }
}
