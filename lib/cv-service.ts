import { AiError, getProvider } from "./ai";
import { fallbackCoverLetter } from "./cover-fallback";
import { cvLanguage, detectLang, type Lang } from "./lang";
import { maskContactDetails, restoreTokens, stripContact } from "./privacy";
import {
  buildCoverPrompt,
  buildTailorPrompt,
  COVER_SYSTEM,
  PARSE_SYSTEM,
  TAILOR_SYSTEM,
} from "./prompts";
import { sanitizeTailored } from "./sanitize";
import {
  coverLetterAiOutputSchema,
  parsedCvSchema,
  tailorAiOutputSchema,
  type Cv,
  type OutputLanguage,
  type TailorRequest,
  type TailorResponse,
} from "./schemas";

export function resolveOutputLanguage(
  choice: OutputLanguage,
  jobDescription: string,
  cvLang: Lang,
): Lang {
  if (choice === "ar" || choice === "en") return choice;
  if (choice === "cv") return cvLang;
  return jobDescription.trim() ? detectLang(jobDescription, cvLang) : cvLang;
}

/**
 * Raw CV text → structured CV. E-mails and phone numbers are masked before the
 * text reaches the AI and re-attached locally afterwards.
 */
export async function parseCvText(rawText: string): Promise<Cv> {
  const { masked, emails, phones, tokens } = maskContactDetails(rawText.slice(0, 60000));
  const provider = await getProvider();
  const parsed = await provider.generateJson({
    system: PARSE_SYSTEM,
    prompt: `CV TEXT:\n<<<\n${masked}\n>>>`,
    schema: parsedCvSchema,
    temperature: 0,
  });
  const restored = restoreTokens(parsed, tokens);
  restored.contact.email = emails[0] ?? "";
  restored.contact.phone = phones[0] ?? "";
  return restored;
}

const notProvided = (s: string) => (s.trim() ? s.trim() : "");

export async function tailorCv(req: TailorRequest): Promise<TailorResponse> {
  const cvLang = cvLanguage(req.cv);
  const outLang = resolveOutputLanguage(req.outputLanguage, req.jobDescription, cvLang);
  const company = notProvided(req.company);
  const jobTitle = notProvided(req.jobTitle);
  const provider = await getProvider();

  // ---- No job description: CV as-is + generic cover letter ----
  if (req.mode === "asis") {
    let coverLetter: string;
    let fallback = false;
    try {
      const out = await provider.generateJson({
        system: COVER_SYSTEM,
        prompt: buildCoverPrompt({ cv: stripContact(req.cv), company, jobTitle, outputLanguage: outLang }),
        schema: coverLetterAiOutputSchema,
        temperature: 0.5,
      });
      coverLetter = out.cover_letter.trim();
    } catch (err) {
      if (err instanceof AiError && err.code === "config") throw err;
      coverLetter = fallbackCoverLetter(req.cv, outLang, company, jobTitle);
      fallback = true;
    }
    return {
      cv: req.cv,
      coverLetter,
      reasons: {},
      missingSkills: [],
      warnings: fallback ? ["تعذّر الوصول للذكاء الاصطناعي، فاستُخدمت رسالة جاهزة بسيطة. عدّلها كما تريد."] : [],
      language: outLang,
      coverLetterFallback: fallback,
    };
  }

  // ---- Tailoring + cover letter in ONE call ----
  const out = await provider.generateJson({
    system: TAILOR_SYSTEM,
    prompt: buildTailorPrompt({
      cv: stripContact(req.cv), // contact info is never sent
      jobDescription: req.jobDescription,
      company,
      jobTitle,
      outputLanguage: outLang,
      cvLanguage: cvLang,
    }),
    schema: tailorAiOutputSchema,
    temperature: 0.3,
  });

  const { cv, warnings } = sanitizeTailored(req.cv, out.cv, { translating: outLang !== cvLang });

  const reasons: Record<string, string> = {};
  for (const c of out.changes) {
    // normalise "experience[0].bullets[2]" → "experience.0.bullets.2"
    const path = c.path.replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "").trim();
    if (path && c.reason_ar) reasons[path] = c.reason_ar;
  }

  return {
    cv,
    coverLetter: out.cover_letter.trim(),
    reasons,
    missingSkills: out.missing_skills.map((s) => s.trim()).filter(Boolean).slice(0, 20),
    warnings,
    language: outLang,
    coverLetterFallback: false,
  };
}
