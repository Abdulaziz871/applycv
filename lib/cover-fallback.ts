import type { Lang } from "./lang";
import type { Cv } from "./schemas";

/** Local template letter used when the AI is unavailable (e.g. quota exhausted). */
export function fallbackCoverLetter(
  cv: Pick<Cv, "name" | "headline" | "skills">,
  lang: Lang,
  company: string,
  jobTitle: string,
): string {
  const skills = cv.skills.slice(0, 4).join(lang === "ar" ? "، " : ", ");
  if (lang === "ar") {
    const target = jobTitle
      ? `للتقدّم لوظيفة «${jobTitle}»${company ? ` لدى ${company}` : ""}`
      : `للتقدّم لفرصة العمل${company ? ` لديكم في ${company}` : " لديكم"}`;
    return [
      company ? `السادة ${company}،` : "السادة فريق التوظيف،",
      `أكتب إليكم ${target}. أعمل في مجال ${cv.headline || "تخصصي"}${skills ? `، ولديّ خبرة في ${skills}` : ""}.`,
      "أرفقت سيرتي الذاتية لتطلعوا على تفاصيل خبرتي ومؤهلاتي، ويسعدني أن أناقش كيف يمكنني أن أضيف قيمة لفريقكم.",
      "شاكراً لكم وقتكم واهتمامكم.",
      `مع خالص التحية،\n${cv.name}`,
    ].join("\n\n");
  }
  return [
    company ? `Dear ${company} Hiring Team,` : "Dear Hiring Manager,",
    `I am writing to apply for ${jobTitle ? `the ${jobTitle} position` : "the opportunity"}${company ? ` at ${company}` : ""}. I work as ${cv.headline || "a professional in my field"}${skills ? `, with experience in ${skills}` : ""}.`,
    "I have attached my CV with the details of my experience and qualifications, and I would be glad to discuss how I can contribute to your team.",
    "Thank you for your time and consideration.",
    `Kind regards,\n${cv.name}`,
  ].join("\n\n");
}
