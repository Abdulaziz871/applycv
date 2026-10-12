import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { aiErrorResponse, isAuthed, jsonError } from "@/lib/api";
import { answerQuestion, answerRequestSchema } from "@/lib/linkedin";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Called by the Chrome extension for one Easy Apply question it cannot answer by rule. */
export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) return jsonError("غير مصرّح.", 401);

  const parsed = answerRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("بيانات الطلب غير صالحة.");

  try {
    return NextResponse.json({ answer: await answerQuestion(parsed.data) });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
