import type { ReactNode } from "react";
import { blockDir, langDir, type Lang } from "./lang";
import type { Cv } from "./schemas";

/**
 * The single CV template. It is rendered live in the browser (review preview)
 * and to static HTML on the server for the PDF, so both always match.
 * Single column, real text, semantic markup, no tables/images (ATS friendly).
 */

const LABELS: Record<Lang, Record<string, string>> = {
  ar: {
    summary: "الملخص المهني",
    experience: "الخبرة العملية",
    education: "التعليم",
    skills: "المهارات",
    languages: "اللغات",
    certifications: "الشهادات",
    projects: "المشاريع",
    present: "حتى الآن",
  },
  en: {
    summary: "Summary",
    experience: "Experience",
    education: "Education",
    skills: "Skills",
    languages: "Languages",
    certifications: "Certifications",
    projects: "Projects",
    present: "Present",
  },
};

const join = (parts: string[], sep = " · ") => parts.filter((p) => p.trim()).join(sep);

function dateRange(start: string, end: string): string {
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cv-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function CvDocument({ cv, lang }: { cv: Cv; lang: Lang }) {
  const t = LABELS[lang];
  const docDir = langDir(lang);
  const bd = (text: string) => blockDir(text, docDir);
  const contactBits = [cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links].filter(
    (s) => s.trim(),
  );

  return (
    <article className="cv-root" dir={langDir(lang)} lang={lang}>
      <header className="cv-header">
        <h1 dir={bd(cv.name)}>{cv.name}</h1>
        {cv.headline && (
          <p className="cv-headline" dir={bd(cv.headline)}>
            {cv.headline}
          </p>
        )}
        {contactBits.length > 0 && (
          <p className="cv-contact">
            {contactBits.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="cv-sep"> | </span>}
                <bdi dir="auto">{c}</bdi>
              </span>
            ))}
          </p>
        )}
      </header>

      {cv.summary.trim() && (
        <Section title={t.summary}>
          <p dir={bd(cv.summary)}>{cv.summary}</p>
        </Section>
      )}

      {cv.experience.length > 0 && (
        <Section title={t.experience}>
          {cv.experience.map((e, i) => (
            <div className="cv-entry" key={i}>
              <div className="cv-entry-head">
                <h3 dir={bd(e.title)}>{e.title}</h3>
                <span className="cv-dates" dir="auto">
                  {dateRange(e.start, e.end)}
                </span>
              </div>
              {(e.company || e.location) && (
                <p className="cv-sub" dir={bd(join([e.company, e.location]))}>
                  {join([e.company, e.location])}
                </p>
              )}
              {e.bullets.length > 0 && (
                <ul>
                  {e.bullets.map((b, j) => (
                    <li key={j} dir={bd(b)}>
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </Section>
      )}

      {cv.education.length > 0 && (
        <Section title={t.education}>
          {cv.education.map((e, i) => (
            <div className="cv-entry" key={i}>
              <div className="cv-entry-head">
                <h3 dir={bd(e.degree || e.institution)}>{e.degree || e.institution}</h3>
                <span className="cv-dates" dir="auto">
                  {dateRange(e.start, e.end)}
                </span>
              </div>
              {(e.degree ? join([e.institution, e.location]) : e.location) && (
                <p className="cv-sub" dir={bd(e.institution + e.location)}>
                  {e.degree ? join([e.institution, e.location]) : e.location}
                </p>
              )}
              {e.details.trim() && <p dir={bd(e.details)}>{e.details}</p>}
            </div>
          ))}
        </Section>
      )}

      {cv.skills.length > 0 && (
        <Section title={t.skills}>
          <p dir={bd(cv.skills.join(" "))}>{cv.skills.join(lang === "ar" ? "، " : ", ")}</p>
        </Section>
      )}

      {cv.projects.length > 0 && (
        <Section title={t.projects}>
          {cv.projects.map((p, i) => (
            <div className="cv-entry" key={i}>
              <h3 dir={bd(p.name)}>{p.name}</h3>
              {p.description.trim() && <p dir={bd(p.description)}>{p.description}</p>}
            </div>
          ))}
        </Section>
      )}

      {cv.certifications.length > 0 && (
        <Section title={t.certifications}>
          <ul>
            {cv.certifications.map((c, i) => (
              <li key={i} dir={bd(c)}>
                {c}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {cv.languages.length > 0 && (
        <Section title={t.languages}>
          <p dir={bd(cv.languages.join(" "))}>{cv.languages.join(lang === "ar" ? "، " : ", ")}</p>
        </Section>
      )}
    </article>
  );
}

export const cvCss = `
.cv-root {
  font-family: "CVLatin", "CVArabic", "IBM Plex Sans Arabic", "IBM Plex Sans", sans-serif;
  font-size: 10.5pt;
  line-height: 1.6;
  color: #1f2933;
  letter-spacing: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.cv-root[lang="ar"] { line-height: 1.85; }
.cv-root h1, .cv-root h2, .cv-root h3, .cv-root p, .cv-root ul { margin: 0; padding: 0; }
.cv-header { margin-bottom: 4mm; }
.cv-root h1 { font-size: 22pt; font-weight: 700; line-height: 1.3; color: #1f2933; }
.cv-headline { font-size: 12pt; color: #3f6b6a; font-weight: 600; margin-top: 1mm; }
.cv-contact { font-size: 9.5pt; color: #4b5563; margin-top: 2mm; }
.cv-sep { color: #b8b4a6; }
.cv-section { margin-top: 5mm; }
.cv-root h2 {
  font-size: 11.5pt;
  font-weight: 700;
  color: #3f6b6a;
  border-bottom: 0.75pt solid #3f6b6a;
  padding-bottom: 0.8mm;
  margin-bottom: 2.5mm;
  break-after: avoid;
}
.cv-entry { margin-bottom: 3.5mm; break-inside: avoid; }
.cv-entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; break-after: avoid; }
.cv-root h3 { font-size: 10.5pt; font-weight: 600; }
.cv-dates { font-size: 9.5pt; color: #4b5563; white-space: nowrap; }
.cv-sub { color: #4b5563; font-size: 10pt; margin-bottom: 1mm; }
.cv-root ul { list-style: disc; padding-inline-start: 5mm; margin-top: 1mm; }
.cv-root li { margin-bottom: 0.6mm; }
`;
