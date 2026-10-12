import { NextResponse, type NextRequest } from "next/server";
import { AI_ERROR_MESSAGES_AR, AiError } from "./ai";
import { SESSION_COOKIE, verifyExtensionRequest, verifySessionToken } from "./auth";

export const jsonError = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

/** Defense in depth: proxy.ts already guards /api/*, but paid/heavy routes re-check. */
export async function isAuthed(req: NextRequest): Promise<boolean> {
  try {
    return (
      (await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) ||
      (await verifyExtensionRequest(req.nextUrl.pathname, req.headers.get("authorization")))
    );
  } catch {
    return false;
  }
}

/** Browser session only (the extension's bearer token is not enough). */
export async function isSessionAuthed(req: NextRequest): Promise<boolean> {
  try {
    return await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    return false;
  }
}

export function aiErrorResponse(err: unknown) {
  if (err instanceof AiError) {
    const status = err.code === "quota" ? 429 : err.code === "config" ? 503 : 502;
    return jsonError(AI_ERROR_MESSAGES_AR[err.code], status);
  }
  // Deliberately generic: error objects may embed CV text.
  return jsonError("حدث خطأ غير متوقع، حاول مرة أخرى.", 500);
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
