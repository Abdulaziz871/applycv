/**
 * Optional live check against the real Gemini API (uses your free key):
 *   GEMINI_API_KEY=... npx tsx scripts/smoke-ai.ts
 * Sends only the fictional fixture CV (no contact details) and prints the results.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { parseCvText, tailorCv } from "../lib/cv-service";

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY first");
  const buffer = readFileSync(path.join(process.cwd(), "tests", "fixtures", "cv-en.docx"));
  const text = (await mammoth.extractRawText({ buffer })).value;
  const cv = await parseCvText(text);
  console.log("PARSED:", JSON.stringify(cv, null, 2).slice(0, 1200), "\n");
  const res = await tailorCv({
    cv,
    jobDescription:
      "Senior Frontend Engineer. You will build performant React + TypeScript interfaces, mentor developers, and work with Kubernetes-based CI. 5+ years experience.",
    company: "Acme",
    jobTitle: "Senior Frontend Engineer",
    outputLanguage: "auto",
    mode: "tailor",
  });
  console.log("REASONS:", res.reasons, "\nMISSING:", res.missingSkills, "\nWARNINGS:", res.warnings);
  console.log("SKILLS:", res.cv.skills, "\nSUMMARY:", res.cv.summary, "\n\nLETTER:\n" + res.coverLetter);
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
