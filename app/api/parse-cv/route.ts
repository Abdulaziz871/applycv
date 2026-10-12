import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { aiErrorResponse, isAuthed, jsonError } from "@/lib/api";
import { parseCvText } from "@/lib/cv-service";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) return jsonError("غير مصرّح.", 401);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("لم يتم رفع أي ملف.");
  if (!file.name.toLowerCase().endsWith(".docx")) return jsonError("الملف يجب أن يكون بصيغة Word (.docx).");
  if (file.size > MAX_BYTES) return jsonError("حجم الملف أكبر من 5 ميغابايت.");

  const buffer = Buffer.from(await file.arrayBuffer());
  // .docx is a zip container: must start with "PK"
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return jsonError("الملف ليس ملف Word صالحاً (.docx).");
  }

  let text: string;
  try {
    text = (await mammoth.extractRawText({ buffer })).value.trim();
  } catch {
    return jsonError("تعذّر قراءة ملف Word. تأكد أنه غير تالف ولا محمي بكلمة سر.");
  }
  if (text.length < 40) {
    return jsonError("لم أجد نصاً كافياً في الملف. قد يكون صورة أو ملفاً فارغاً.");
  }

  try {
    const cv = await parseCvText(text);
    return NextResponse.json({ cv });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
