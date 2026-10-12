"use client";

import { Check, Pencil, Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { computeChanges, revertChange } from "@/lib/diff";
import type { ReviewData } from "@/lib/schemas";
import { CvEditor } from "./CvEditor";
import { CvPreview } from "./CvPreview";
import { ChangesList, CoverLetterEditor } from "./ReviewParts";
import { Button, Card, Notice } from "./ui";

const normSkill = (s: string) => s.trim().toLowerCase();
const hasSkill = (skills: string[], s: string) => skills.some((x) => normSkill(x) === normSkill(s));
/** Missing skills are only added when the user confirms they really have them. */
const toggleSkill = (skills: string[], s: string) =>
  hasSkill(skills, s) ? skills.filter((x) => normSkill(x) !== normSkill(s)) : [...skills, s.trim()];

/**
 * The mandatory review screen: changes with before/after + reason + revert, editable
 * cover letter, editable CV fields and the live A4 preview. Used for a single application
 * (/apply) and for every queued application (/send).
 */
export function ReviewWorkspace({
  data,
  onChange,
  beforeLetter,
}: {
  data: ReviewData;
  onChange: (patch: Partial<ReviewData>) => void;
  /** Extra controls shown above the cover letter (e.g. the e-mail subject). */
  beforeLetter?: ReactNode;
}) {
  const [showEditor, setShowEditor] = useState(false);
  const { original, current } = data;
  const changes = useMemo(() => computeChanges(original, current), [original, current]);
  const changedPaths = useMemo(() => new Set(changes.map((c) => c.path)), [changes]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div className="space-y-5">
        {data.warnings.map((w) => (
          <Notice key={w} tone="warning">
            {w}
          </Notice>
        ))}

        {data.missingSkills.length > 0 && (
          <Card>
            <h2 className="mb-1 text-lg font-semibold">مطلوب في الوظيفة وغير موجود في سيرتك</h2>
            <p className="mb-3 text-[14px] text-muted">
              لم نُضفها تلقائياً لأننا لا نضيف مهارات غير حقيقية. إذا كنت تتقنها فعلاً، اضغط عليها لإضافتها
              إلى المهارات في سيرتك، واضغط مرة أخرى لإزالتها.
            </p>
            <div className="flex flex-wrap gap-2">
              {data.missingSkills.map((s) => {
                const added = hasSkill(current.skills, s);
                return (
                  <button
                    key={s}
                    type="button"
                    dir="auto"
                    aria-pressed={added}
                    onClick={() => onChange({ current: { ...current, skills: toggleSkill(current.skills, s) } })}
                    className={
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors " +
                      (added
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-transparent bg-surface-muted hover:border-primary")
                    }
                  >
                    {added ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                    {s}
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        <ChangesList
          changes={changes}
          reasons={data.reasons}
          tailored={data.hasJobDescription}
          onRevert={(path) => onChange({ current: revertChange(data.original, data.current, path) })}
          onRevertAll={() => onChange({ current: data.original })}
        />

        {beforeLetter}

        <CoverLetterEditor
          value={data.coverLetter}
          fallback={data.coverLetterFallback}
          onChange={(v) => onChange({ coverLetter: v })}
        />

        <div>
          <Button variant="secondary" onClick={() => setShowEditor((s) => !s)}>
            <Pencil className="size-4" /> {showEditor ? "إخفاء تعديل الحقول" : "تعديل حقول السيرة بالتفصيل"}
          </Button>
          {showEditor && (
            <div className="mt-4">
              <CvEditor value={data.current} changed={changedPaths} onChange={(cv) => onChange({ current: cv })} />
            </div>
          )}
        </div>
      </div>

      <div className="lg:sticky lg:top-28 lg:self-start">
        <h2 className="mb-3 text-lg font-semibold">معاينة الـ PDF</h2>
        <CvPreview cv={data.current} />
      </div>
    </div>
  );
}
