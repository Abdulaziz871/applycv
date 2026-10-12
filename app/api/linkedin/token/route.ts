import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isSessionAuthed, jsonError } from "@/lib/api";
import { createExtensionToken, EXTENSION_TOKEN_MAX_AGE } from "@/lib/auth";

export const runtime = "nodejs";

/** Issues the Chrome extension's bearer token. Requires a real browser session. */
export async function POST(req: NextRequest) {
  if (!(await isSessionAuthed(req))) return jsonError("غير مصرّح.", 401);
  const expiresAt = new Date(Date.now() + EXTENSION_TOKEN_MAX_AGE * 1000).toISOString();
  return NextResponse.json({ token: await createExtensionToken(), expiresAt });
}
