import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { aiErrorResponse, isAuthed, jsonError } from "@/lib/api";
import { tailorCv } from "@/lib/cv-service";
import { tailorRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) return jsonError("غير مصرّح.", 401);

  const parsed = tailorRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("بيانات الطلب غير صالحة.");
  if (parsed.data.mode === "tailor" && parsed.data.jobDescription.trim().length < 30) {
    return jsonError("أدخل وصف الوظيفة (30 حرفاً على الأقل) أو اختر «استخدام السيرة كما هي».");
  }

  try {
    return NextResponse.json(await tailorCv(parsed.data));
  } catch (err) {
    return aiErrorResponse(err);
  }
}
