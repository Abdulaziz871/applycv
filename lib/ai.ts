import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

/**
 * Small provider abstraction. To swap Gemini for another provider (e.g. Groq),
 * implement `AiProvider` and return it from `getProvider()`.
 * Never log prompts or responses here: they contain CV / job-description text.
 */

export type AiErrorCode = "quota" | "config" | "invalid" | "unavailable";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export const AI_ERROR_MESSAGES_AR: Record<AiErrorCode, string> = {
  quota: "تم الوصول للحد اليومي المجاني، حاول لاحقاً.",
  config: "خدمة الذكاء الاصطناعي غير مهيأة (تحقق من GEMINI_API_KEY على الخادم).",
  invalid: "لم يُرجع الذكاء الاصطناعي نتيجة صالحة، حاول مرة أخرى.",
  unavailable: "خوادم الذكاء الاصطناعي (Google) مزدحمة حالياً، حاول بعد دقيقة أو دقيقتين.",
};

export interface GenerateJsonOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
}

export interface AiProvider {
  generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gemini rejects size-limit keywords (400 INVALID_ARGUMENT). They are still enforced by
// zod when the response is validated, so they are only removed from the schema we send.
const UNSUPPORTED_KEYWORDS = new Set(["$schema", "maxLength", "minLength", "maxItems", "minItems"]);

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7" });
  return JSON.parse(JSON.stringify(js, (k, v) => (UNSUPPORTED_KEYWORDS.has(k) ? undefined : v)));
}

/**
 * retryable: worth retrying the same model after a pause.
 * fallback: worth trying the next model (overload, per-model quota, model not found).
 */
function classify(err: unknown): { retryable: boolean; fallback: boolean; code: AiErrorCode } {
  const e = err as { status?: number; code?: number; message?: string };
  const status = e?.status ?? e?.code;
  const msg = String(e?.message ?? "");
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg)) {
    return { retryable: true, fallback: true, code: "quota" };
  }
  if (status === 401 || status === 403 || /API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) {
    return { retryable: false, fallback: false, code: "config" };
  }
  if (status === 404 || /NOT_FOUND|is not found/i.test(msg)) {
    return { retryable: false, fallback: true, code: "unavailable" };
  }
  if (status === 400) return { retryable: false, fallback: false, code: "invalid" };
  if (status === 500 || status === 503 || status === 504 || /UNAVAILABLE|overloaded|high demand|fetch failed/i.test(msg)) {
    return { retryable: true, fallback: true, code: "unavailable" };
  }
  return { retryable: false, fallback: true, code: "unavailable" };
}

/** Minimal surface of the SDK we use (lets tests inject a fake client). */
export interface GeminiClientLike {
  models: {
    generateContent(args: {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    }): Promise<{ text?: string }>;
  };
}

export class GeminiProvider implements AiProvider {
  private client: GeminiClientLike;
  private models: string[];

  /** `model` may be a list: when one is overloaded / out of quota, the next is tried. */
  constructor(
    apiKey: string,
    model: string | string[],
    client?: GeminiClientLike,
    private retryDelaysMs: number[] = [1500, 5000],
  ) {
    this.models = [...new Set((Array.isArray(model) ? model : [model]).filter(Boolean))];
    this.client = client ?? (new GoogleGenAI({ apiKey }) as unknown as GeminiClientLike);
  }

  /** Calls the first model, retrying with backoff; on persistent failure moves to the next model. */
  private async callWithFallback(system: string, prompt: string, schema: z.ZodType, temperature: number) {
    for (let m = 0; m < this.models.length; m++) {
      const isLast = m === this.models.length - 1;
      const delays = this.retryDelaysMs;
      for (let i = 0; ; i++) {
        try {
          return await this.callOnce(this.models[m], system, prompt, schema, temperature);
        } catch (err) {
          const { retryable, fallback, code } = classify(err);
          if (!isLast && fallback) break; // a fresh model beats waiting on an overloaded one
          if (retryable && i < delays.length) {
            await sleep(delays[i]);
            continue;
          }
          throw new AiError(code, AI_ERROR_MESSAGES_AR[code]);
        }
      }
    }
    throw new AiError("unavailable", AI_ERROR_MESSAGES_AR.unavailable);
  }

  private async callOnce(model: string, system: string, prompt: string, schema: z.ZodType, temperature: number) {
    const res = await this.client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: toJsonSchema(schema),
        temperature,
      },
    });
    return res.text ?? "";
  }

  async generateJson<T>({ system, prompt, schema, temperature = 0.3 }: GenerateJsonOptions<T>): Promise<T> {
    let lastError: AiError | null = null;
    let extra = "";
    // up to 2 validation attempts; each call itself retries quota/5xx and falls back to other models
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.callWithFallback(system, prompt + extra, schema, temperature);
      try {
        const json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
        const parsed = schema.safeParse(json);
        if (parsed.success) return parsed.data;
        extra =
          "\n\nYour previous JSON did not match the required schema. Fix these problems and answer again with valid JSON only:\n" +
          parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
      } catch {
        extra = "\n\nYour previous answer was not valid JSON. Answer again with valid JSON only.";
      }
      lastError = new AiError("invalid", AI_ERROR_MESSAGES_AR.invalid);
    }
    throw lastError ?? new AiError("invalid", AI_ERROR_MESSAGES_AR.invalid);
  }
}

const DEFAULT_FALLBACK_MODELS = "gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite";

let cached: AiProvider | null = null;

export async function getProvider(): Promise<AiProvider> {
  if (cached) return cached;
  if (process.env.AI_PROVIDER === "mock" && process.env.NODE_ENV !== "production") {
    const { MockProvider } = await import("./ai-mock");
    cached = new MockProvider();
    return cached;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("config", AI_ERROR_MESSAGES_AR.config);
  // Free-tier models get overloaded (503 "high demand"); fall back to others, each with its own quota.
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? DEFAULT_FALLBACK_MODELS)
    .split(",")
    .map((m) => m.trim());
  cached = new GeminiProvider(key, [process.env.GEMINI_MODEL || "gemini-3.6-flash", ...fallbacks]);
  return cached;
}
