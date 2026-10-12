import { z } from "zod";

/** Current version of every persisted structure (localStorage + backup file). */
export const SCHEMA_VERSION = 1;

const text = z.string().max(20000);
const short = z.string().max(500);

export const contactSchema = z.object({
  email: short,
  phone: short,
  location: short,
  links: z.array(short).max(20),
});

export const experienceSchema = z.object({
  title: short,
  company: short,
  location: short,
  start: short,
  end: short,
  bullets: z.array(text).max(40),
});

export const educationSchema = z.object({
  degree: short,
  institution: short,
  location: short,
  start: short,
  end: short,
  details: text,
});

export const projectSchema = z.object({
  name: short,
  description: text,
});

export const cvSchema = z.object({
  name: short,
  headline: short,
  contact: contactSchema,
  summary: text,
  experience: z.array(experienceSchema).max(40),
  education: z.array(educationSchema).max(20),
  skills: z.array(short).max(120),
  languages: z.array(short).max(20),
  certifications: z.array(short).max(40),
  projects: z.array(projectSchema).max(30),
});

export type Contact = z.infer<typeof contactSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Cv = z.infer<typeof cvSchema>;

/** CV without the contact block — the only shape ever sent to the AI. */
export const cvNoContactSchema = cvSchema.omit({ contact: true });
export type CvNoContact = z.infer<typeof cvNoContactSchema>;

/** Parsing output: contact.email/phone are filled locally, never by the AI. */
export const parsedCvSchema = cvSchema;

export const emptyCv = (): Cv => ({
  name: "",
  headline: "",
  contact: { email: "", phone: "", location: "", links: [] },
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  projects: [],
});

// ---------- Tailoring ----------

export const aiChangeSchema = z.object({
  path: z.string(),
  before: z.string(),
  after: z.string(),
  reason_ar: z.string(),
});

export const tailorAiOutputSchema = z.object({
  cv: cvNoContactSchema,
  changes: z.array(aiChangeSchema),
  missing_skills: z.array(z.string()),
  cover_letter: z.string().min(1),
});
export type TailorAiOutput = z.infer<typeof tailorAiOutputSchema>;

export const coverLetterAiOutputSchema = z.object({
  cover_letter: z.string().min(1),
});

export const outputLanguageSchema = z.enum(["auto", "ar", "en", "cv"]);
export type OutputLanguage = z.infer<typeof outputLanguageSchema>;

export const tailorRequestSchema = z.object({
  cv: cvSchema,
  jobDescription: z.string().max(15000).default(""),
  company: short.default(""),
  jobTitle: short.default(""),
  outputLanguage: outputLanguageSchema.default("auto"),
  mode: z.enum(["tailor", "asis"]),
});
export type TailorRequest = z.infer<typeof tailorRequestSchema>;

export const tailorResponseSchema = z.object({
  cv: cvSchema,
  coverLetter: z.string(),
  reasons: z.record(z.string(), z.string()),
  missingSkills: z.array(z.string()),
  warnings: z.array(z.string()),
  language: z.enum(["ar", "en"]),
  coverLetterFallback: z.boolean(),
});
export type TailorResponse = z.infer<typeof tailorResponseSchema>;

// ---------- Persisted data ----------

export const applicationSchema = z.object({
  id: z.string().min(1).max(100),
  createdAt: z.string(),
  updatedAt: z.string(),
  company: short,
  jobTitle: short,
  hasJobDescription: z.boolean(),
  language: z.enum(["ar", "en"]),
  cv: cvSchema,
  coverLetter: text,
  /** Set when the application was e-mailed (Phase 2). Optional, so old backups stay valid. */
  recipientEmail: short.optional(),
  /** Set for applications submitted by the LinkedIn extension. */
  source: z.enum(["linkedin"]).optional(),
  jobUrl: short.optional(),
});
export type Application = z.infer<typeof applicationSchema>;

export const sentLogEntrySchema = z.object({
  id: z.string().min(1).max(100),
  email: short,
  company: short,
  position: short,
  sentAt: z.string(),
  status: z.enum(["sent", "failed"]),
  error: short.optional(),
});
export type SentLogEntry = z.infer<typeof sentLogEntrySchema>;

export const settingsSchema = z.object({
  dailyCap: z.number().int().min(1).max(100),
  defaultOutputLanguage: outputLanguageSchema,
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): Settings => ({
  dailyCap: 30,
  defaultOutputLanguage: "auto",
});

// ---------- Backup file ----------

export const BACKUP_APP_ID = "muqaddim";

export const backupSchema = z.object({
  app: z.literal(BACKUP_APP_ID),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string(),
  masterCv: cvSchema.nullable(),
  applications: z.array(applicationSchema).max(5000),
  sentLog: z.array(sentLogEntrySchema).max(20000),
  settings: settingsSchema,
});
export type Backup = z.infer<typeof backupSchema>;

// ---------- Phase 2: send queue (transient, not part of the backup) ----------

export const reviewDataSchema = z.object({
  original: cvSchema,
  current: cvSchema,
  coverLetter: text,
  reasons: z.record(z.string(), z.string()),
  missingSkills: z.array(z.string()),
  warnings: z.array(z.string()),
  language: z.enum(["ar", "en"]),
  coverLetterFallback: z.boolean(),
  hasJobDescription: z.boolean(),
});
export type ReviewData = z.infer<typeof reviewDataSchema>;

export const queueItemSchema = z.object({
  id: z.string().min(1).max(100),
  email: short,
  company: short,
  position: short,
  jobDescription: z.string().max(15000),
  prep: z.enum(["pending", "tailoring", "ready", "failed"]),
  prepError: short.optional(),
  approved: z.boolean(),
  send: z.enum(["waiting", "sending", "sent", "failed"]),
  sendError: short.optional(),
  subject: short,
  review: reviewDataSchema.optional(),
});
export type QueueItem = z.infer<typeof queueItemSchema>;

export const MAX_DAILY_CAP = 100;

/** POST /api/send body. `approved: true` is mandatory: the API refuses anything else. */
export const sendRequestSchema = z.object({
  to: z.string().max(254),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20000),
  cv: cvSchema,
  fileName: z.string().min(1).max(120),
  approved: z.literal(true),
});
export type SendRequest = z.infer<typeof sendRequestSchema>;
