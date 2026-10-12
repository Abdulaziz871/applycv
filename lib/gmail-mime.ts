/** Builds the RFC 5322 / MIME message sent through the Gmail API (users.messages.send). */

const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Trims, lowercases and validates. Returns null when unusable (this also blocks header injection). */
export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase().replace(/^mailto:/, "");
  if (e.length > 254 || /[\r\n\s,;<>]/.test(e)) return null;
  return EMAIL_RE.test(e) ? e : null;
}

const noBreaks = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047 encoded-word for non-ASCII subjects; line breaks are stripped (header injection). */
export function encodeSubject(subject: string): string {
  const clean = noBreaks(subject);
  return isAscii(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

function attachmentHeaders(fileName: string, mimeType: string): string[] {
  const clean = noBreaks(fileName).replace(/["\\]/g, "_");
  const asciiName = clean.replace(/[^\x20-\x7e]/g, "_") || "cv.pdf";
  const disposition = isAscii(clean)
    ? `attachment; filename="${clean}"`
    : `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
  return [`Content-Type: ${mimeType}; name="${asciiName}"`, `Content-Disposition: ${disposition}`];
}

export interface MimeInput {
  to: string;
  subject: string;
  text: string;
  attachment: { fileName: string; content: Buffer; mimeType: string };
  boundary?: string;
}

export function buildMime({ to, subject, text, attachment, boundary }: MimeInput): string {
  const email = normalizeEmail(to);
  if (!email) throw new Error("invalid recipient");
  const b = boundary ?? `muq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  const body = text.replace(/\r?\n/g, "\r\n");

  return [
    `To: ${email}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${b}"`,
    "",
    `--${b}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(body, "utf8").toString("base64")),
    "",
    `--${b}`,
    ...attachmentHeaders(attachment.fileName, attachment.mimeType),
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(attachment.content.toString("base64")),
    "",
    `--${b}--`,
    "",
  ].join("\r\n");
}

/** Gmail expects the whole message as base64url in `raw`. */
export const toRaw = (mime: string) => Buffer.from(mime, "utf8").toString("base64url");
