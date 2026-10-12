import { toLatinDigits } from "./lang";
import type { Cv, CvNoContact } from "./schemas";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// digits (Latin / Arabic-Indic / Persian) joined by single separators, optional leading +
const PHONE_RE =
  /(?<![\w/])\+?[(\d٠-٩۰-۹][\d٠-٩۰-۹\s().-]{5,22}[\d٠-٩۰-۹](?![\w])/g;

export interface MaskResult {
  masked: string;
  emails: string[];
  phones: string[];
  /** token → original text, used to undo accidental masking */
  tokens: Record<string, string>;
}

function looksLikeDateRange(raw: string): boolean {
  const nums = toLatinDigits(raw).match(/\d+/g) ?? [];
  return nums.length > 0 && nums.every((n) => n.length === 4 && +n >= 1950 && +n <= 2100);
}

/**
 * Replaces e-mails and phone numbers with placeholders BEFORE the CV text is
 * sent to the AI, so contact details never leave the server.
 */
export function maskContactDetails(input: string): MaskResult {
  const tokens: Record<string, string> = {};
  const emails: string[] = [];
  const phones: string[] = [];

  let out = input.replace(EMAIL_RE, (m) => {
    const token = `[[EMAIL_${emails.length + 1}]]`;
    emails.push(m);
    tokens[token] = m;
    return token;
  });

  out = out.replace(PHONE_RE, (m) => {
    const digits = toLatinDigits(m).replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15 || looksLikeDateRange(m)) return m;
    const token = `[[PHONE_${phones.length + 1}]]`;
    phones.push(m.trim());
    tokens[token] = m;
    return token;
  });

  return { masked: out, emails, phones, tokens };
}

/** Deeply restores any placeholder that survived into AI output. */
export function restoreTokens<T>(value: T, tokens: Record<string, string>): T {
  const entries = Object.entries(tokens);
  if (entries.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let s = v;
      for (const [token, original] of entries) s = s.split(token).join(original);
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

/** Contact block never goes to the AI. */
export function stripContact(cv: Cv): CvNoContact {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { contact, ...rest } = cv;
  return rest;
}

export function attachContact(cv: CvNoContact, contact: Cv["contact"]): Cv {
  return { ...cv, contact };
}
