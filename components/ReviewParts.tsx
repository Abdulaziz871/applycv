"use client";

import clsx from "clsx";
import { Check, Copy, Undo2 } from "lucide-react";
import { useMemo } from "react";
import { displayValue, wordDiff, type Change, type Segment } from "@/lib/diff";
import { wordCount } from "@/lib/lang";
import { Button, Card, Textarea, useToast } from "./ui";

export const STEPS = ["الوظيفة", "المراجعة", "الإنهاء"] as const;

export function Stepper({ current }: { current: number }) {
  return (
    <nav aria-label="خطوات التقديم" className="mb-6">
      {/* mobile: collapsed */}
      <div className="flex items-center justify-between rounded-[12px] border border-border bg-surface px-4 py-2.5 sm:hidden">
        <span className="text-sm text-muted">
          الخطوة {current + 1} من {STEPS.length}
        </span>
        <span className="font-semibold text-primary">{STEPS[current]}</span>
      </div>
      <ol className="hidden items-center gap-2 sm:flex">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={i === current ? "step" : undefined}>
            <span
              className={clsx(
                "grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold",
                i < current && "bg-primary text-white",
                i === current && "bg-primary-soft text-primary ring-2 ring-primary",
                i > current && "bg-surface-muted text-muted",
              )}
            >
              {i < current ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={clsx("text-[15px]", i === current ? "font-semibold text-text" : "text-muted")}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px flex-1 bg-border" />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Segments({ segments, tone }: { segments: Segment[]; tone: "added" | "removed" }) {
  return (
    <>
      {segments.map((s, i) => (
        <span
          key={i}
          className={clsx(
            s.kind === "added" && tone === "added" && "rounded-[4px] bg-add px-0.5 text-[#22503a]",
            s.kind === "removed" && tone === "removed" && "rounded-[4px] bg-modify px-0.5 text-[#6d4f14] line-through decoration-warning/60",
          )}
        >
          {s.text}
        </span>
      ))}
    </>
  );
}

export function reasonFor(reasons: Record<string, string>, path: string): string {
  if (reasons[path]) return reasons[path];
  const parts = path.split(".");
  while (parts.length > 1) {
    parts.pop();
    const r = reasons[parts.join(".")];
    if (r) return r;
  }
  return "تعديل لمطابقة متطلبات الوظيفة.";
}

function ChangeRow({ change, reason, onRevert }: { change: Change; reason: string; onRevert: () => void }) {
  const before = displayValue(change.before);
  const after = displayValue(change.after);
  const diff = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <li className="rounded-[14px] border border-border p-4" data-testid="change-row" data-path={change.path}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-primary">{change.label}</span>
        <Button size="sm" variant="ghost" onClick={onRevert} aria-label={`تراجع عن تغيير ${change.label}`}>
          <Undo2 className="size-4" /> تراجع
        </Button>
      </div>
      <div className="space-y-2.5 text-[14.5px] leading-7">
        <div>
          <span className="mb-0.5 block text-[12.5px] font-medium text-muted">قبل</span>
          <p dir="auto" className="rounded-[10px] bg-surface-muted/70 px-3 py-2">
            {before ? <Segments segments={diff.before} tone="removed" /> : <em className="text-muted">— فارغ —</em>}
          </p>
        </div>
        <div>
          <span className="mb-0.5 block text-[12.5px] font-medium text-muted">بعد</span>
          <p dir="auto" className="rounded-[10px] bg-surface-muted/70 px-3 py-2">
            {after ? <Segments segments={diff.after} tone="added" /> : <em className="text-muted">— فارغ —</em>}
          </p>
        </div>
      </div>
      <p className="mt-2.5 text-[13.5px] text-muted">
        <span className="font-medium text-text">السبب: </span>
        {reason}
      </p>
    </li>
  );
}

export function ChangesList({
  changes,
  reasons,
  onRevert,
  onRevertAll,
  tailored,
}: {
  changes: Change[];
  reasons: Record<string, string>;
  onRevert: (path: string) => void;
  onRevertAll: () => void;
  tailored: boolean;
}) {
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          التعديلات على السيرة {changes.length > 0 && <span className="text-muted">({changes.length})</span>}
        </h2>
        {changes.length > 1 && (
          <Button size="sm" variant="ghost" onClick={onRevertAll}>
            <Undo2 className="size-4" /> تراجع عن الكل
          </Button>
        )}
      </div>
      {changes.length === 0 ? (
        <p className="text-[15px] text-muted">
          {tailored
            ? "لا توجد تعديلات الآن — سيرتك مطابقة للأصل."
            : "تُستخدم سيرتك الأساسية كما هي بدون أي تعديل."}
        </p>
      ) : (
        <ul className="space-y-3">
          {changes.map((c) => (
            <ChangeRow key={c.path} change={c} reason={reasonFor(reasons, c.path)} onRevert={() => onRevert(c.path)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function CoverLetterEditor({
  value,
  onChange,
  fallback,
}: {
  value: string;
  onChange: (v: string) => void;
  fallback: boolean;
}) {
  const toast = useToast();
  const words = wordCount(value);
  const good = words >= 100 && words <= 180;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast("تم نسخ الرسالة.");
    } catch {
      toast("تعذّر النسخ. حدّد النص وانسخه يدوياً.", "error");
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">رسالة التقديم</h2>
        <div className="flex items-center gap-3">
          <span className={clsx("text-sm", good ? "text-success" : "text-warning")} data-testid="word-count">
            {words} كلمة
          </span>
          <Button size="sm" variant="ghost" onClick={copy}>
            <Copy className="size-4" /> نسخ
          </Button>
        </div>
      </div>
      {fallback && <p className="mb-3 text-[13.5px] text-warning">هذه رسالة جاهزة بسيطة لأن الذكاء الاصطناعي غير متاح الآن — عدّلها كما تريد.</p>}
      <Textarea
        aria-label="رسالة التقديم"
        rows={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="mt-1.5 text-[13px] text-muted">الطول المناسب: 110–170 كلمة تقريباً.</p>
    </Card>
  );
}
