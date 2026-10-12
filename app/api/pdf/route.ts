import type { NextRequest } from "next/server";
import { isAuthed, jsonError } from "@/lib/api";
import { renderCvPdf } from "@/lib/pdf";
import { cvSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) return jsonError("غير مصرّح.", 401);

  const body = (await req.json().catch(() => null)) as { cv?: unknown } | null;
  const parsed = cvSchema.safeParse(body?.cv);
  if (!parsed.success) return jsonError("بيانات السيرة غير صالحة.");

  try {
    const pdf = await renderCvPdf(parsed.data);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="cv.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonError("تعذّر إنشاء ملف PDF. حاول مرة أخرى.", 500);
  }
}
