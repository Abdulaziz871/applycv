import { z } from "zod";
import { getProvider } from "./ai";
import { stripContact } from "./privacy";
import { linkedinSettingsSchema } from "./linkedin-settings";
import { cvSchema } from "./schemas";

/**
 * Server side of LinkedIn auto-apply: the extension asks here for answers to
 * Easy Apply questions it cannot fill by rule.
 */

const short = z.string().max(500);

// ---------- answering one form question ----------

export const answerRequestSchema = z.object({
  question: z.string().min(1).max(1500),
  kind: z.enum(["text", "textarea", "number", "select", "radio", "checkbox"]),
  options: z.array(z.string().max(300)).max(80).default([]),
  jobTitle: short.default(""),
  company: short.default(""),
  cv: cvSchema,
  answers: linkedinSettingsSchema.shape.answers,
});
export type AnswerRequest = z.infer<typeof answerRequestSchema>;

const answerAiSchema = z.object({
  known: z.boolean(),
  answer: z.string().max(2000),
});

export const ANSWER_SYSTEM = `You answer ONE question from a job application form on behalf of a candidate.
Use ONLY the CANDIDATE FACTS and CV provided. Never invent experience, skills, certifications, licenses, degrees, clearances, or numbers.

Rules:
- If the facts/CV clearly answer the question, set known=true and give the answer.
- If they do not (e.g. sponsorship, relocation, criminal record, a specific license, an unstated preference), set known=false and answer "".
- "select"/"radio": answer must be EXACTLY one of the OPTIONS strings (copy it verbatim).
- "checkbox": answer "true" or "false".
- "number": digits only (decimals allowed), no units.
- Years of experience with a skill: use the SKILL YEARS facts. A skill that is not in the CV or facts → "0" (known=true).
- Yes/No about having a skill or tool: "Yes" only if the CV or facts show it, otherwise "No".
- "text"/"textarea": short, factual, professional, in the language of the question. Max 3 sentences for textarea, one line for text.`;

export function buildAnswerPrompt(req: AnswerRequest): string {
  const a = req.answers;
  const facts = [
    `City: ${a.city}`,
    a.nationality && `Nationality: ${a.nationality}`,
    a.residency && `Residency / work status: ${a.residency}`,
    a.expectedSalary > 0 && `Expected monthly salary: ${a.expectedSalary} ${a.salaryCurrency}`,
    `Notice period: ${a.noticeDays} days${a.noticeDays === 0 ? " (available immediately)" : ""}`,
    `Total years of professional experience: ${a.totalYears}`,
    a.skillYears.trim() && `SKILL YEARS:\n${a.skillYears.trim()}`,
    a.extraFacts.trim() && `OTHER FACTS:\n${a.extraFacts.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
  return [
    `JOB: ${req.jobTitle || "(unknown)"} at ${req.company || "(unknown)"}`,
    `QUESTION (${req.kind}): ${req.question}`,
    req.options.length ? `OPTIONS:\n${req.options.map((o) => `- ${o}`).join("\n")}` : "",
    "",
    "CANDIDATE FACTS:",
    facts,
    "",
    "CV (JSON, no contact details):",
    JSON.stringify(stripContact(req.cv)),
  ].join("\n");
}

/** Returns null when the question cannot be answered truthfully (the extension then skips the job). */
export async function answerQuestion(req: AnswerRequest): Promise<string | null> {
  const provider = await getProvider();
  const out = await provider.generateJson({
    system: ANSWER_SYSTEM,
    prompt: buildAnswerPrompt(req),
    schema: answerAiSchema,
    temperature: 0,
  });
  return sanitizeAnswer(req, out);
}

export function sanitizeAnswer(req: Pick<AnswerRequest, "kind" | "options">, out: { known: boolean; answer: string }): string | null {
  if (!out.known) return null;
  const answer = out.answer.trim();
  if (!answer) return null;
  if (req.kind === "select" || req.kind === "radio") {
    const norm = (s: string) => s.trim().toLowerCase();
    return req.options.find((o) => norm(o) === norm(answer)) ?? null;
  }
  if (req.kind === "number") return /^\d+(\.\d+)?$/.test(answer) ? answer : null;
  if (req.kind === "checkbox") return answer === "true" || answer === "false" ? answer : null;
  return answer;
}
