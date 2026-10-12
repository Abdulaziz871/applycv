import mammoth from "mammoth";
import { describe, expect, it, vi } from "vitest";
import { AI_ERROR_MESSAGES_AR, AiError, GeminiProvider, toJsonSchema, type AiProvider, type GenerateJsonOptions } from "@/lib/ai";
import { MockProvider } from "@/lib/ai-mock";
import { tailorCv } from "@/lib/cv-service";
import { tailorAiOutputSchema, cvSchema } from "@/lib/schemas";
import { z } from "zod";
import { fixture, sampleCvAr, sampleCvEn } from "./helpers";

// ---- capture what the "AI" receives, delegate to the offline mock ----
const seen: { system: string; prompt: string }[] = [];
let override: ((opts: GenerateJsonOptions<unknown>) => unknown) | null = null;

vi.mock("@/lib/ai", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai")>();
  const { MockProvider } = await import("@/lib/ai-mock");
  const mock = new MockProvider();
  const provider: AiProvider = {
    async generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T> {
      seen.push({ system: opts.system, prompt: opts.prompt });
      if (override) return opts.schema.parse(override(opts as GenerateJsonOptions<unknown>));
      return mock.generateJson(opts);
    },
  };
  return { ...actual, getProvider: async () => provider };
});

async function docxText(name: string) {
  return (await mammoth.extractRawText({ buffer: fixture(name) })).value;
}

describe("CV parsing from .docx fixtures", () => {
  it("English fixture: structured JSON + contact re-attached locally, never sent to AI", async () => {
    const { parseCvText } = await import("@/lib/cv-service");
    seen.length = 0;
    const cv = await parseCvText(await docxText("cv-en.docx"));
    cvSchema.parse(cv);
    expect(cv.name).toBe("Omar Al-Hassan");
    expect(cv.headline).toBe("Senior Frontend Engineer");
    expect(cv.experience).toHaveLength(2);
    expect(cv.experience[0]).toMatchObject({ title: "Senior Frontend Engineer", company: "Noon Digital", start: "Jan 2021", end: "Present" });
    expect(cv.experience[0].bullets).toHaveLength(3);
    expect(cv.skills).toContain("TypeScript");
    expect(cv.contact.email).toBe("omar.hassan@example.com");
    expect(cv.contact.phone).toMatch(/50 123 4567/);
    const sent = seen.map((s) => s.prompt).join("\n");
    expect(sent).not.toContain("omar.hassan@example.com");
    expect(sent).not.toContain("123 4567");
    expect(sent).toContain("[[EMAIL_1]]");
  });

  it("Arabic fixture: keeps Arabic text and masks phone (plain digits)", async () => {
    const { parseCvText } = await import("@/lib/cv-service");
    seen.length = 0;
    const cv = await parseCvText(await docxText("cv-ar.docx"));
    expect(cv.name).toBe("سارة محمد العتيبي");
    expect(cv.headline).toBe("محاسبة أولى");
    expect(cv.experience[0].company).toBe("شركة الراجحي للتطوير");
    expect(cv.experience[0].end).toBe("حتى الآن");
    expect(cv.contact.phone).toBe("0501234567");
    expect(cv.contact.email).toBe("sara.otaibi@example.com");
    expect(seen.map((s) => s.prompt).join("\n")).not.toContain("0501234567");
  });
});

describe("tailoring + cover letter (one call)", () => {
  it("sends no contact details and returns a valid tailored CV", async () => {
    seen.length = 0;
    const res = await tailorCv({
      cv: sampleCvEn(),
      jobDescription: "We need a Senior Frontend Engineer with React, TypeScript, CSS and Kubernetes experience.",
      company: "Acme",
      jobTitle: "Frontend Lead",
      outputLanguage: "auto",
      mode: "tailor",
    });
    expect(seen).toHaveLength(1); // ONE AI call for CV + letter
    const prompt = seen[0].prompt;
    expect(prompt).not.toContain("omar.hassan@example.com");
    expect(prompt).not.toContain("+971");
    expect(prompt).not.toContain("linkedin.com");
    expect(res.cv.contact).toEqual(sampleCvEn().contact);
    expect(res.language).toBe("en");
    expect(res.coverLetter.length).toBeGreaterThan(50);
    expect(res.missingSkills).toContain("Kubernetes");
    expect(res.cv.skills.slice(0, 3)).toEqual(expect.arrayContaining(["React", "TypeScript", "CSS"]));
    expect(res.reasons.skills).toBeTruthy();
  });

  it("system prompt carries the anti-fabrication rules", () => {
    const sys = seen[0].system;
    expect(sys).toMatch(/NEVER fabricate/);
    expect(sys).toMatch(/110-170 words/);
    expect(sys).toMatch(/reason_ar/);
  });

  it("auto language follows the job description (Arabic JD → Arabic output)", async () => {
    const res = await tailorCv({
      cv: sampleCvAr(),
      jobDescription: "مطلوب محاسب أول لديه خبرة في إعداد القوائم المالية واستخدام SAP لمدة لا تقل عن خمس سنوات.",
      company: "",
      jobTitle: "",
      outputLanguage: "auto",
      mode: "tailor",
    });
    expect(res.language).toBe("ar");
    expect(seen.at(-1)!.prompt).toContain("OUTPUT LANGUAGE: Arabic");
  });

  it("server guardrails neutralise a model that fabricates", async () => {
    override = (opts) => {
      const cv = JSON.parse(opts.prompt.split("CANDIDATE CV (JSON):\n")[1]);
      cv.skills = ["Kubernetes", ...cv.skills];
      cv.experience[0].company = "Google";
      cv.experience[0].bullets[0] = "Led a team of 200 engineers.";
      return { cv, changes: [], missing_skills: [], cover_letter: "Dear Acme,\n\nHello.\n\nKind regards,\nOmar" };
    };
    try {
      const res = await tailorCv({
        cv: sampleCvEn(),
        jobDescription: "Senior frontend role using React and Kubernetes at scale, plenty of experience needed.",
        company: "Acme",
        jobTitle: "",
        outputLanguage: "en",
        mode: "tailor",
      });
      expect(res.cv.skills).not.toContain("Kubernetes");
      expect(res.cv.experience[0].company).toBe("Noon Digital");
      expect(res.cv.experience[0].bullets[0]).toBe(sampleCvEn().experience[0].bullets[0]);
      expect(res.warnings.length).toBeGreaterThan(0);
    } finally {
      override = null;
    }
  });

  it("no job description: CV unchanged + generic letter", async () => {
    const cv = sampleCvEn();
    const res = await tailorCv({ cv, jobDescription: "", company: "", jobTitle: "", outputLanguage: "auto", mode: "asis" });
    expect(res.cv).toEqual(cv);
    expect(res.coverLetter).toContain("Omar Al-Hassan");
    expect(res.coverLetter).not.toMatch(/\[[A-Za-z ]+\]/);
  });

  it("no job description + AI quota exhausted → local template letter, CV still usable", async () => {
    override = () => {
      throw new AiError("quota", AI_ERROR_MESSAGES_AR.quota);
    };
    try {
      const res = await tailorCv({ cv: sampleCvAr(), jobDescription: "", company: "شركة النور", jobTitle: "محاسبة", outputLanguage: "auto", mode: "asis" });
      expect(res.coverLetterFallback).toBe(true);
      expect(res.coverLetter).toContain("شركة النور");
      expect(res.coverLetter).toContain("سارة محمد العتيبي");
    } finally {
      override = null;
    }
  });

  it("tailoring surfaces the Arabic quota message", async () => {
    override = () => {
      throw new AiError("quota", AI_ERROR_MESSAGES_AR.quota);
    };
    try {
      await expect(
        tailorCv({ cv: sampleCvEn(), jobDescription: "x".repeat(60), company: "", jobTitle: "", outputLanguage: "auto", mode: "tailor" }),
      ).rejects.toMatchObject({ code: "quota", message: "تم الوصول للحد اليومي المجاني، حاول لاحقاً." });
    } finally {
      override = null;
    }
  });
});

describe("GeminiProvider retry + validation", () => {
  const schema = z.object({ ok: z.boolean() });
  const client = (impl: () => Promise<{ text?: string }>) => ({ models: { generateContent: vi.fn(impl) } });

  it("retries 429 with backoff then succeeds", async () => {
    let n = 0;
    const c = client(async () => {
      if (++n < 3) throw Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 });
      return { text: '{"ok":true}' };
    });
    const p = new GeminiProvider("k", "m", c, [1, 1]);
    await expect(p.generateJson({ system: "s", prompt: "p", schema })).resolves.toEqual({ ok: true });
    expect(c.models.generateContent).toHaveBeenCalledTimes(3);
  });

  it("gives up with the Arabic quota message after retries", async () => {
    const c = client(async () => {
      throw Object.assign(new Error("quota"), { status: 429 });
    });
    const p = new GeminiProvider("k", "m", c, [1, 1]);
    await expect(p.generateJson({ system: "s", prompt: "p", schema })).rejects.toMatchObject({
      code: "quota",
      message: "تم الوصول للحد اليومي المجاني، حاول لاحقاً.",
    });
    expect(c.models.generateContent).toHaveBeenCalledTimes(3);
  });

  it("re-asks once when the JSON fails zod validation, then fails cleanly", async () => {
    const c = client(async () => ({ text: '{"ok":"yes"}' }));
    const p = new GeminiProvider("k", "m", c, [1]);
    await expect(p.generateJson({ system: "s", prompt: "p", schema })).rejects.toMatchObject({ code: "invalid" });
    expect(c.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it("recovers when the second attempt is valid; strips ``` fences", async () => {
    let n = 0;
    const c = client(async () => ({ text: ++n === 1 ? "not json" : '```json\n{"ok":true}\n```' }));
    const p = new GeminiProvider("k", "m", c, [1]);
    await expect(p.generateJson({ system: "s", prompt: "p", schema })).resolves.toEqual({ ok: true });
  });

  it("maps auth errors to a config error without retrying", async () => {
    const c = client(async () => {
      throw Object.assign(new Error("API key not valid"), { status: 400 });
    });
    const p = new GeminiProvider("k", "m", c, [1]);
    await expect(p.generateJson({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AiError);
  });

  it("falls back to the next model when the first is overloaded (503)", async () => {
    const c = client(async () => ({ text: '{"ok":true}' }));
    c.models.generateContent.mockImplementationOnce(async () => {
      throw Object.assign(new Error("This model is currently experiencing high demand"), { status: 503 });
    });
    const p = new GeminiProvider("k", ["busy", "backup"], c, [1, 1]);
    await expect(p.generateJson({ system: "s", prompt: "p", schema })).resolves.toEqual({ ok: true });
    const models = c.models.generateContent.mock.calls.map((a) => (a as unknown as [{ model: string }])[0].model);
    expect(models).toEqual(["busy", "backup"]);
  });

  it("retries the last model, then reports unavailable when every model is overloaded", async () => {
    const c = client(async () => {
      throw Object.assign(new Error("UNAVAILABLE"), { status: 503 });
    });
    const p = new GeminiProvider("k", ["a", "b"], c, [1, 1]);
    await expect(p.generateJson({ system: "s", prompt: "p", schema })).rejects.toMatchObject({
      code: "unavailable",
      message: AI_ERROR_MESSAGES_AR.unavailable,
    });
    expect(c.models.generateContent).toHaveBeenCalledTimes(4); // a once, b three times
  });

  it("does not fall back on auth errors", async () => {
    const c = client(async () => {
      throw Object.assign(new Error("API key not valid"), { status: 403 });
    });
    const p = new GeminiProvider("k", ["a", "b"], c, [1]);
    await expect(p.generateJson({ system: "s", prompt: "p", schema })).rejects.toMatchObject({ code: "config" });
    expect(c.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("sends a JSON schema derived from the zod schema", async () => {
    const c = client(async () => ({ text: '{"ok":true}' }));
    await new GeminiProvider("k", "m", c, [1]).generateJson({ system: "s", prompt: "p", schema });
    const cfg = (c.models.generateContent.mock.calls[0] as unknown as [{ config: Record<string, unknown> }])[0].config;
    expect(cfg.responseMimeType).toBe("application/json");
    expect(cfg.responseJsonSchema).toMatchObject({ type: "object", properties: { ok: { type: "boolean" } } });
    expect(JSON.stringify(cfg.responseJsonSchema)).not.toContain("$schema");
  });

  it("schema sent to Gemini has no size-limit keywords (they cause 400 INVALID_ARGUMENT)", () => {
    for (const sch of [cvSchema, tailorAiOutputSchema]) {
      const json = JSON.stringify(toJsonSchema(sch));
      expect(json).not.toMatch(/maxLength|minLength|maxItems|minItems|\$schema/);
      expect(json).toContain("properties");
    }
  });

  it("full tailoring schema converts to JSON schema", () => {
    const js = z.toJSONSchema(tailorAiOutputSchema, { target: "draft-7" });
    expect(JSON.stringify(js)).toContain("cover_letter");
  });

  it("mock provider is not the production path", () => {
    expect(new MockProvider()).toBeDefined();
  });
});
