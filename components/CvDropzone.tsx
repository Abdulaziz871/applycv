"use client";

import clsx from "clsx";
import { FileUp, Loader2, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import type { Cv } from "@/lib/schemas";
import { Notice } from "./ui";

const MAX_BYTES = 5 * 1024 * 1024;

export async function uploadCv(file: File): Promise<{ cv?: Cv; error?: string }> {
  if (!file.name.toLowerCase().endsWith(".docx")) return { error: "الملف يجب أن يكون بصيغة Word (.docx)." };
  if (file.size > MAX_BYTES) return { error: "حجم الملف أكبر من 5 ميغابايت." };
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/api/parse-cv", { method: "POST", body: form });
    const data = (await res.json().catch(() => null)) as { cv?: Cv; error?: string } | null;
    if (!res.ok || !data?.cv) return { error: data?.error ?? "تعذّرت قراءة السيرة الذاتية." };
    return { cv: data.cv };
  } catch {
    return { error: "تعذّر الاتصال بالخادم. تحقق من الإنترنت." };
  }
}

export function CvDropzone({ onParsed }: { onParsed: (cv: Cv) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    const { cv, error: err } = await uploadCv(file);
    setBusy(false);
    if (err || !cv) setError(err ?? "حدث خطأ.");
    else onParsed(cv);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void handle(e.dataTransfer.files[0]);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="رفع ملف السيرة الذاتية"
        className={clsx(
          "flex cursor-pointer flex-col items-center rounded-[16px] border-2 border-dashed px-6 py-12 text-center transition-colors",
          over ? "border-primary bg-primary-soft" : "border-border bg-surface hover:border-primary/50 hover:bg-primary-soft/40",
        )}
      >
        <div className="mb-4 grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
          {busy ? <Loader2 className="size-6 animate-spin" /> : <FileUp className="size-6" />}
        </div>
        <p className="text-lg font-semibold">{busy ? "جارٍ قراءة سيرتك الذاتية…" : "اسحب ملف السيرة (Word) هنا"}</p>
        <p className="mt-1 text-[15px] text-muted">
          {busy ? "قد يستغرق ذلك حتى نصف دقيقة" : "أو اضغط لاختيار ملف .docx — حتى 5 ميغابايت"}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          data-testid="cv-file-input"
          onChange={(e) => void handle(e.target.files?.[0])}
        />
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <p className="flex items-center justify-center gap-2 text-[13.5px] text-muted">
        <ShieldCheck className="size-4 text-success" aria-hidden />
        لا يتم إرسال رقم الجوال أو الإيميل للذكاء الاصطناعي
      </p>
    </div>
  );
}
