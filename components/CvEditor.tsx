"use client";

import clsx from "clsx";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { setAtPath } from "@/lib/diff";
import type { Cv } from "@/lib/schemas";
import { Button, Card, Field, Input, Textarea } from "./ui";

interface Props {
  value: Cv;
  onChange: (cv: Cv) => void;
  /** Paths (see lib/diff.ts) that differ from the original — highlighted in amber. */
  changed?: Set<string>;
}

function SectionCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function Chips({
  items,
  onChange,
  placeholder,
  changed,
  label,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  changed?: boolean;
  label: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...items, ...parts]);
    setDraft("");
  };
  return (
    <div className={clsx("rounded-[12px] border border-border p-3", changed && "border-warning/60 bg-modify/30")}>
      <div className="flex flex-wrap gap-2" aria-label={label}>
        {items.map((s, i) => (
          <span key={`${s}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 ps-3 pe-1.5 text-sm text-primary">
            <span dir="auto">{s}</span>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="rounded-full p-0.5 hover:bg-primary/10"
              aria-label={`حذف ${s}`}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-sm text-muted">لا يوجد شيء بعد</span>}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          aria-label={placeholder}
        />
        <Button type="button" size="md" onClick={add} disabled={!draft.trim()} aria-label="إضافة">
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function CvEditor({ value: cv, onChange, changed }: Props) {
  const set = (path: string, v: unknown) => onChange(setAtPath(cv, path, v));
  const mutate = (fn: (draft: Cv) => void) => {
    const draft = structuredClone(cv);
    fn(draft);
    onChange(draft);
  };
  const ch = (path: string) => !!changed?.has(path);
  const bulletChanged = (i: number, j: number) => ch(`experience.${i}.bullets.${j}`) || ch(`experience.${i}.bullets`);
  const [extra, setExtra] = useState<{ certifications: boolean; projects: boolean; languages: boolean }>({
    certifications: false,
    projects: false,
    languages: false,
  });
  const showCerts = cv.certifications.length > 0 || extra.certifications;
  const showProjects = cv.projects.length > 0 || extra.projects;
  const showLangs = cv.languages.length > 0 || extra.languages;

  return (
    <div className="space-y-5">
      <SectionCard title="المعلومات الأساسية">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم">{(id) => <Input id={id} value={cv.name} onChange={(e) => set("name", e.target.value)} />}</Field>
          <Field label="المسمى المهني">
            {(id) => <Input id={id} value={cv.headline} changed={ch("headline")} onChange={(e) => set("headline", e.target.value)} />}
          </Field>
          <Field label="البريد الإلكتروني">
            {(id) => <Input id={id} type="email" dir="ltr" value={cv.contact.email} onChange={(e) => set("contact.email", e.target.value)} />}
          </Field>
          <Field label="رقم الجوال">
            {(id) => <Input id={id} type="tel" dir="ltr" value={cv.contact.phone} onChange={(e) => set("contact.phone", e.target.value)} />}
          </Field>
          <Field label="المدينة / الدولة">
            {(id) => <Input id={id} value={cv.contact.location} onChange={(e) => set("contact.location", e.target.value)} />}
          </Field>
          <Field label="الروابط (رابط في كل سطر)">
            {(id) => (
              <Textarea
                id={id}
                dir="ltr"
                rows={2}
                value={cv.contact.links.join("\n")}
                onChange={(e) => set("contact.links", e.target.value.split("\n"))}
                onBlur={(e) => set("contact.links", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
              />
            )}
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="الملخص المهني">
        <Textarea
          aria-label="الملخص المهني"
          autoGrow
          rows={4}
          value={cv.summary}
          changed={ch("summary")}
          onChange={(e) => set("summary", e.target.value)}
        />
      </SectionCard>

      <SectionCard
        title="الخبرة العملية"
        action={
          <Button
            size="sm"
            onClick={() =>
              mutate((d) =>
                d.experience.push({ title: "", company: "", location: "", start: "", end: "", bullets: [] }),
              )
            }
          >
            <Plus className="size-4" /> إضافة خبرة
          </Button>
        }
      >
        {cv.experience.length === 0 && <p className="text-sm text-muted">لم تُضف أي خبرة بعد.</p>}
        {cv.experience.map((e, i) => (
          <div key={i} className="rounded-[14px] border border-border bg-background/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted">خبرة {i + 1}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" disabled={i === 0} aria-label="نقل لأعلى" onClick={() => mutate((d) => d.experience.splice(i - 1, 2, d.experience[i], d.experience[i - 1]))}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={i === cv.experience.length - 1} aria-label="نقل لأسفل" onClick={() => mutate((d) => d.experience.splice(i, 2, d.experience[i + 1], d.experience[i]))}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="حذف الخبرة" onClick={() => mutate((d) => d.experience.splice(i, 1))}>
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="المسمى الوظيفي">{(id) => <Input id={id} value={e.title} changed={ch(`experience.${i}.title`)} onChange={(x) => set(`experience.${i}.title`, x.target.value)} />}</Field>
              <Field label="الشركة">{(id) => <Input id={id} value={e.company} changed={ch(`experience.${i}.company`)} onChange={(x) => set(`experience.${i}.company`, x.target.value)} />}</Field>
              <Field label="المكان">{(id) => <Input id={id} value={e.location} changed={ch(`experience.${i}.location`)} onChange={(x) => set(`experience.${i}.location`, x.target.value)} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="من">{(id) => <Input id={id} value={e.start} changed={ch(`experience.${i}.start`)} onChange={(x) => set(`experience.${i}.start`, x.target.value)} />}</Field>
                <Field label="إلى">{(id) => <Input id={id} value={e.end} changed={ch(`experience.${i}.end`)} onChange={(x) => set(`experience.${i}.end`, x.target.value)} />}</Field>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <span className="block text-sm font-medium">النقاط</span>
              {e.bullets.map((b, j) => (
                <div key={j} className="flex items-start gap-2">
                  <Textarea
                    aria-label={`نقطة ${j + 1}`}
                    autoGrow
                    rows={1}
                    value={b}
                    changed={bulletChanged(i, j)}
                    onChange={(x) => set(`experience.${i}.bullets.${j}`, x.target.value)}
                  />
                  <Button size="sm" variant="ghost" aria-label="حذف النقطة" className="mt-1" onClick={() => mutate((d) => d.experience[i].bullets.splice(j, 1))}>
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => mutate((d) => d.experience[i].bullets.push(""))}>
                <Plus className="size-4" /> إضافة نقطة
              </Button>
            </div>
          </div>
        ))}
      </SectionCard>

      <SectionCard
        title="التعليم"
        action={
          <Button
            size="sm"
            onClick={() => mutate((d) => d.education.push({ degree: "", institution: "", location: "", start: "", end: "", details: "" }))}
          >
            <Plus className="size-4" /> إضافة تعليم
          </Button>
        }
      >
        {cv.education.length === 0 && <p className="text-sm text-muted">لم تُضف أي مؤهل بعد.</p>}
        {cv.education.map((e, i) => (
          <div key={i} className="rounded-[14px] border border-border bg-background/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted">مؤهل {i + 1}</span>
              <Button size="sm" variant="ghost" aria-label="حذف المؤهل" onClick={() => mutate((d) => d.education.splice(i, 1))}>
                <Trash2 className="size-4 text-danger" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="الدرجة / التخصص">{(id) => <Input id={id} value={e.degree} changed={ch(`education.${i}.degree`)} onChange={(x) => set(`education.${i}.degree`, x.target.value)} />}</Field>
              <Field label="الجهة التعليمية">{(id) => <Input id={id} value={e.institution} changed={ch(`education.${i}.institution`)} onChange={(x) => set(`education.${i}.institution`, x.target.value)} />}</Field>
              <Field label="المكان">{(id) => <Input id={id} value={e.location} onChange={(x) => set(`education.${i}.location`, x.target.value)} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="من">{(id) => <Input id={id} value={e.start} onChange={(x) => set(`education.${i}.start`, x.target.value)} />}</Field>
                <Field label="إلى">{(id) => <Input id={id} value={e.end} onChange={(x) => set(`education.${i}.end`, x.target.value)} />}</Field>
              </div>
              <Field label="تفاصيل (اختياري)" className="sm:col-span-2">
                {(id) => <Input id={id} value={e.details} changed={ch(`education.${i}.details`)} onChange={(x) => set(`education.${i}.details`, x.target.value)} />}
              </Field>
            </div>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="المهارات">
        <Chips label="المهارات" items={cv.skills} placeholder="أضف مهارة ثم Enter" changed={ch("skills")} onChange={(v) => set("skills", v)} />
      </SectionCard>

      {showLangs && (
        <SectionCard title="اللغات">
          <Chips label="اللغات" items={cv.languages} placeholder="مثال: العربية — لغة أم" changed={ch("languages")} onChange={(v) => set("languages", v)} />
        </SectionCard>
      )}

      {showCerts && (
        <SectionCard title="الشهادات">
          <Chips label="الشهادات" items={cv.certifications} placeholder="أضف شهادة ثم Enter" changed={ch("certifications")} onChange={(v) => set("certifications", v)} />
        </SectionCard>
      )}

      {showProjects && (
        <SectionCard
          title="المشاريع"
          action={
            <Button size="sm" onClick={() => mutate((d) => d.projects.push({ name: "", description: "" }))}>
              <Plus className="size-4" /> إضافة مشروع
            </Button>
          }
        >
          {cv.projects.map((p, i) => (
            <div key={i} className="rounded-[14px] border border-border bg-background/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-muted">مشروع {i + 1}</span>
                <Button size="sm" variant="ghost" aria-label="حذف المشروع" onClick={() => mutate((d) => d.projects.splice(i, 1))}>
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </div>
              <div className="space-y-3">
                <Field label="اسم المشروع">{(id) => <Input id={id} value={p.name} onChange={(x) => set(`projects.${i}.name`, x.target.value)} />}</Field>
                <Field label="الوصف">
                  {(id) => <Textarea id={id} autoGrow rows={2} value={p.description} changed={ch(`projects.${i}.description`)} onChange={(x) => set(`projects.${i}.description`, x.target.value)} />}
                </Field>
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      {(!showLangs || !showCerts || !showProjects) && (
        <div className="flex flex-wrap gap-2">
          {!showLangs && <Button size="sm" variant="ghost" onClick={() => setExtra((x) => ({ ...x, languages: true }))}><Plus className="size-4" /> قسم اللغات</Button>}
          {!showCerts && <Button size="sm" variant="ghost" onClick={() => setExtra((x) => ({ ...x, certifications: true }))}><Plus className="size-4" /> قسم الشهادات</Button>}
          {!showProjects && <Button size="sm" variant="ghost" onClick={() => setExtra((x) => ({ ...x, projects: true }))}><Plus className="size-4" /> قسم المشاريع</Button>}
        </div>
      )}
    </div>
  );
}
