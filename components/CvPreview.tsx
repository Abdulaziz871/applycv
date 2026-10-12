"use client";

import { useEffect, useRef, useState } from "react";
import { CvDocument, cvCss } from "@/lib/cv-template";
import { cvLanguage } from "@/lib/lang";
import type { Cv } from "@/lib/schemas";

const A4_WIDTH_PX = 794; // 210mm @ 96dpi
const CONTENT_HEIGHT_PX = 1016; // (297mm - 2 × 14mm margin) @ 96dpi

/** Live preview built from the exact same template used for the exported PDF. */
export function CvPreview({ cv }: { cv: Cv }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (outer.current) setScale(Math.min(1, outer.current.clientWidth / A4_WIDTH_PX));
      if (inner.current) setHeight(inner.current.scrollHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [cv]);

  const pages = Math.max(1, Math.ceil((height - 106) / CONTENT_HEIGHT_PX));

  return (
    <div>
      <div
        ref={outer}
        dir="ltr"
        className="overflow-hidden rounded-[12px] border border-border bg-white shadow-soft"
        style={{ height: height * scale || undefined }}
      >
        <style>{cvCss}</style>
        <div
          ref={inner}
          data-testid="cv-preview"
          style={{
            width: A4_WIDTH_PX,
            padding: "14mm 16mm",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            boxSizing: "border-box",
            background: "#fff",
          }}
        >
          <CvDocument cv={cv} lang={cvLanguage(cv)} />
        </div>
      </div>
      <p className="mt-2 text-center text-[13px] text-muted">
        تقدير الطول: {pages} {pages === 1 ? "صفحة" : "صفحات"} A4
        {pages > 2 && " — يفضّل ألا تتجاوز صفحتين"}
      </p>
    </div>
  );
}
