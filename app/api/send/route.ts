import { NextResponse, type NextRequest } from "next/server";
import { isAuthed, jsonError } from "@/lib/api";
import { unseal } from "@/lib/crypto";
import { buildMime, normalizeEmail, toRaw } from "@/lib/gmail-mime";
import {
  accessTokenFromRefresh,
  GMAIL_COOKIE,
  GMAIL_ERROR_MESSAGES_AR,
  GmailError,
  googleConfig,
  isMockMode,
  requestOrigin,
  sendRaw,
  type SendErrorCode,
} from "@/lib/google";
import { renderCvPdf } from "@/lib/pdf";
import { sendRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const STATUS: Record<SendErrorCode, number> = {
  reauth: 401,
  quota: 429,
  rejected: 422,
  failed: 502,
  not_connected: 409,
};

function fail(code: SendErrorCode, clearCookie = false) {
  const res = NextResponse.json({ error: GMAIL_ERROR_MESSAGES_AR[code], code }, { status: STATUS[code] });
  if (clearCookie) res.cookies.set(GMAIL_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

/**
 * Sends ONE approved application: renders the PDF on the server, builds the MIME message
 * and calls Gmail. The client drives the queue (delays, cap, pause); this route never
 * sends anything that lacks `approved: true`. CV / letter text is never logged.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) return jsonError("غير مصرّح.", 401);

  const parsed = sendRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("بيانات الإرسال غير صالحة أو لم يتم اعتمادها.");
  const { to, subject, body, cv, fileName } = parsed.data;
  const email = normalizeEmail(to);
  if (!email) return jsonError("عنوان المستلم غير صالح.", 422);

  const refreshToken = unseal(req.cookies.get(GMAIL_COOKIE)?.value);
  if (!refreshToken) return fail("not_connected");

  try {
    const pdf = await renderCvPdf(cv);
    const raw = toRaw(
      buildMime({
        to: email,
        subject,
        text: body,
        attachment: { fileName, content: pdf, mimeType: "application/pdf" },
      }),
    );

    if (isMockMode()) {
      // dev/test only: everything above ran for real, only the Gmail call is skipped
      return NextResponse.json({ ok: true, id: "mock", bytes: raw.length });
    }

    const accessToken = await accessTokenFromRefresh(googleConfig(requestOrigin(req)), refreshToken);
    const id = await sendRaw(accessToken, raw);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof GmailError) return fail(err.code, err.code === "reauth");
    return fail("failed");
  }
}
