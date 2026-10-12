import { pdfFileName } from "./filename";
import type { Cv } from "./schemas";

/** Saves a Blob through a temporary link (client only). */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Renders the CV on the server and downloads the PDF. Returns an Arabic error message on failure. */
export async function downloadCvPdf(cv: Cv, company: string): Promise<{ error?: string }> {
  try {
    const res = await fetch("/api/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cv }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return { error: data?.error ?? "تعذّر إنشاء ملف PDF." };
    }
    saveBlob(await res.blob(), pdfFileName(cv.name, company));
    return {};
  } catch {
    return { error: "تعذّر الاتصال بالخادم. تحقق من الإنترنت." };
  }
}

/** Builds an editable Word file in the browser (nothing is sent to the server). */
export async function downloadCvDocx(cv: Cv, company: string): Promise<{ error?: string }> {
  try {
    const { renderCvDocx } = await import("./docx"); // loaded only when needed
    saveBlob(await renderCvDocx(cv), pdfFileName(cv.name, company, "docx"));
    return {};
  } catch {
    return { error: "تعذّر إنشاء ملف Word. حاول مرة أخرى." };
  }
}

/** Arabic month names but Latin digits, e.g. "19 سبتمبر 2026". */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-u-nu-latn-ca-gregory", { dateStyle: "medium" }).format(d);
}
