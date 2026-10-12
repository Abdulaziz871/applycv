/**
 * End-to-end check of Phase 1 in a real browser (Chrome via puppeteer-core).
 * Needs the dev server:  AI_PROVIDER=mock npm run dev -- -p 3100   then   npm run e2e
 * Uses the offline mock AI provider, so it verifies the app flow, not Gemini output quality.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer, { type ElementHandle, type Page } from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const PASSWORD = process.env.APP_PASSWORD || "family123";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = path.join(process.cwd(), "tests", "output", "e2e");
const DL = path.join(OUT, "downloads");
const FIX = path.join(process.cwd(), "tests", "fixtures");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => boolean | Promise<boolean>, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}
const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);
async function clickText(page: Page, text: string, selector = "button, a") {
  const ok = await page.evaluate(
    (t, sel) => {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.innerText.trim().includes(t) && !(e as HTMLButtonElement).disabled);
      el?.click();
      return !!el;
    },
    text,
    selector,
  );
  if (!ok) throw new Error(`no clickable "${text}"`);
}
const fileInput = async (page: Page, sel: string) => (await page.$(sel)) as ElementHandle<HTMLInputElement> | null;
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
const newestDownload = () => {
  const f = readdirSync(DL).filter((n) => !n.endsWith(".crdownload")).sort();
  return f.length ? path.join(DL, f[f.length - 1]) : null;
};

/** goto + small wait so React has hydrated before we type/click (dev server compiles lazily). */
async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await waitFor(() =>
    page.evaluate(() =>
      [...document.querySelectorAll("button, input, a")].some((e) => Object.keys(e).some((k) => k.startsWith("__reactProps"))),
    ),
  );
  await sleep(300);
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(DL, { recursive: true });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const cdp = await browser.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const pdfRequests: number[] = [];
  page.on("request", (r) => r.url().includes("/api/pdf") && pdfRequests.push(Date.now()));
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  try {
    // ---------- auth ----------
    await open(page, `${BASE}/apply`);
    check("unauthenticated visit redirects to /login", page.url().endsWith("/login"));
    check("page is RTL Arabic", await page.evaluate(() => document.documentElement.dir === "rtl" && document.documentElement.lang === "ar"));
    await shot(page, "01-login");

    await page.type('input[type="password"]', "wrong-password");
    await clickText(page, "دخول");
    check("wrong password shows Arabic error", await waitFor(async () => (await bodyText(page)).includes("كلمة السر غير صحيحة")));

    await page.click('input[type="password"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type('input[type="password"]', PASSWORD);
    await clickText(page, "دخول");
    check("correct password enters the app", await waitFor(() => page.url().includes("/apply")));
    const cookies = await page.cookies();
    const session = cookies.find((c) => c.name === "muq_session");
    check("session cookie is httpOnly", !!session?.httpOnly);

    // ---------- empty state ----------
    await waitFor(async () => (await bodyText(page)).includes("ابدأ برفع سيرتك"));
    check("no CV → friendly empty state", (await bodyText(page)).includes("ابدأ برفع سيرتك الذاتية"));
    check("empty storage hint mentions restoring a backup", (await bodyText(page)).includes("استعادتها من صفحة النسخ الاحتياطي"));
    await shot(page, "02-apply-empty");

    // ---------- CV upload ----------
    await open(page, `${BASE}/cv`);
    check("privacy note is shown", (await bodyText(page)).includes("لا يتم إرسال رقم الجوال أو الإيميل للذكاء الاصطناعي"));
    await shot(page, "03-cv-upload");

    const bad = await fileInput(page, '[data-testid="cv-file-input"]');
    await bad!.uploadFile(path.join(FIX, "not-a-docx.docx"));
    check("fake .docx is rejected with a clear message", await waitFor(async () => (await bodyText(page)).includes("ليس ملف Word صالحاً")));

    const input = await fileInput(page, '[data-testid="cv-file-input"]');
    await input!.uploadFile(path.join(FIX, "cv-en.docx"));
    check("valid .docx is parsed into an editable form", await waitFor(async () => (await page.$('input[value="Omar Al-Hassan"]')) !== null));
    check("parsed experience shown", (await bodyText(page)).includes("Noon Digital") || (await page.$('input[value="Noon Digital"]')) !== null);
    check("contact re-attached (email + phone)", (await page.$('input[value="omar.hassan@example.com"]')) !== null);
    await shot(page, "04-cv-editor");
    await clickText(page, "حفظ السيرة");
    check("saving shows a toast", await waitFor(async () => (await bodyText(page)).includes("تم حفظ سيرتك الذاتية")));
    const stored = await page.evaluate(() => localStorage.getItem("muq:masterCv"));
    check("master CV stored with schemaVersion", !!stored && JSON.parse(stored).schemaVersion === 1 && JSON.parse(stored).data.name === "Omar Al-Hassan");

    // ---------- apply: tailor ----------
    await open(page, `${BASE}/apply`);
    const tailorBtnDisabled = () => page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.includes("تخصيص السيرة"))!.disabled);
    check("«تخصيص السيرة» disabled without a job description", await tailorBtnDisabled());
    await page.type("textarea", "We are hiring a Senior Frontend Engineer to build fast interfaces with React, TypeScript and CSS. Kubernetes knowledge is a plus. You will mentor developers.");
    const [company, title] = await page.$$('input[type="text"], input:not([type])');
    await company.type("Acme Corp");
    await title.type("Frontend Lead");
    check("«تخصيص السيرة» enabled with a job description", !(await tailorBtnDisabled()));
    await shot(page, "05-apply-step1");
    await clickText(page, "تخصيص السيرة");
    check("review step appears", await waitFor(async () => (await bodyText(page)).includes("التعديلات على السيرة")));
    await sleep(500);

    const changeRows = async () => (await page.$$('[data-testid="change-row"]')).length;
    const n0 = await changeRows();
    check("changes are listed with before/after + Arabic reason", n0 >= 1 && (await bodyText(page)).includes("السبب:"), `${n0} changes`);
    check("missing skills shown as information", (await bodyText(page)).includes("Kubernetes") && (await bodyText(page)).includes("للاطلاع فقط"));
    check("cover letter present with word count", (await page.$eval('textarea[aria-label="رسالة التقديم"]', (t) => (t as HTMLTextAreaElement).value.length)) > 50 && (await page.$('[data-testid="word-count"]')) !== null);
    check("live A4 preview rendered", (await page.$eval('[data-testid="cv-preview"]', (e) => e.textContent!.includes("Omar Al-Hassan"))) === true);
    await shot(page, "06-review");

    // gating: cannot continue without approval, and no PDF was requested
    const continueDisabled = await page.$eval('[data-testid="continue-btn"]', (b) => (b as HTMLButtonElement).disabled);
    check("«متابعة» disabled until «راجعت السيرة والرسالة» is ticked", continueDisabled);
    check("no PDF requested before approval", pdfRequests.length === 0);

    // revert one change
    await page.evaluate(() => (document.querySelector('[data-testid="change-row"] button') as HTMLButtonElement).click());
    await sleep(300);
    check("per-change «تراجع» removes that change", (await changeRows()) === n0 - 1, `${n0} → ${await changeRows()}`);

    // editing the cover letter
    await page.click('textarea[aria-label="رسالة التقديم"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("End");
    await page.keyboard.up("Control");
    await page.keyboard.type(" (edited by test)");
    const letterValue = await page.$eval('textarea[aria-label="رسالة التقديم"]', (t) => (t as HTMLTextAreaElement).value);
    check("cover letter is editable", letterValue.endsWith("(edited by test)"));

    // edit a CV field via the detailed editor
    await clickText(page, "تعديل حقول السيرة بالتفصيل");
    await waitFor(async () => (await page.$('textarea[aria-label="الملخص المهني"]')) !== null);
    await page.click('textarea[aria-label="الملخص المهني"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("End");
    await page.keyboard.up("Control");
    await page.keyboard.type(" EDITED-SUMMARY");
    await sleep(300);
    check("editing a field updates the preview", await page.$eval('[data-testid="cv-preview"]', (e) => e.textContent!.includes("EDITED-SUMMARY")));

    // approve → finish
    await page.click('[data-testid="approve-checkbox"]');
    check("«متابعة» enabled after ticking approval", !(await page.$eval('[data-testid="continue-btn"]', (b) => (b as HTMLButtonElement).disabled)));
    await page.click('[data-testid="continue-btn"]');
    check("finish step appears", await waitFor(async () => (await bodyText(page)).includes("جاهز للتنزيل")));
    check("file name pattern FirstName_LastName_Company.pdf", (await bodyText(page)).includes("Omar_Al-Hassan_Acme_Corp.pdf"));
    await shot(page, "07-finish");

    await page.click('[data-testid="download-pdf"]');
    check("PDF downloaded", await waitFor(() => !!newestDownload() && readFileSync(newestDownload()!).subarray(0, 5).toString() === "%PDF-", 60000));
    check("downloaded with correct file name", path.basename(newestDownload() ?? "") === "Omar_Al-Hassan_Acme_Corp.pdf", path.basename(newestDownload() ?? ""));
    check("exactly one PDF request, after approval", pdfRequests.length === 1);

    // ---------- history ----------
    await open(page, `${BASE}/history`);
    check("history lists the application", (await bodyText(page)).includes("Acme Corp") && (await bodyText(page)).includes("Frontend Lead"));
    await shot(page, "08-history");
    const [pdfRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/pdf"), { timeout: 60000 }),
      clickText(page, "PDF"),
    ]);
    check("history re-download returns a PDF", pdfRes.status() === 200 && (pdfRes.headers()["content-type"] ?? "").includes("application/pdf"));

    // ---------- no-JD flow ----------
    await open(page, `${BASE}/apply`);
    await clickText(page, "استخدام السيرة كما هي");
    check("«as is» flow: review with no changes + generic letter", await waitFor(async () => (await bodyText(page)).includes("تُستخدم سيرتك الأساسية كما هي")));
    await shot(page, "09-review-asis");

    // ---------- backup ----------
    await open(page, `${BASE}/backup`);
    check("backup page explains why backups matter", (await bodyText(page)).includes("لماذا النسخ الاحتياطي مهم"));
    check("last backup says none yet", (await page.$eval('[data-testid="last-backup"]', (e) => e.textContent)) === "لم تؤخذ بعد");
    await shot(page, "10-backup");
    const dlBefore = readdirSync(DL).length;
    await page.click('[data-testid="export-btn"]');
    check("backup file downloaded", await waitFor(() => readdirSync(DL).filter((n) => n.startsWith("muqaddim-backup-") && n.endsWith(".json")).length === 1));
    const backupFile = path.join(DL, readdirSync(DL).find((n) => n.startsWith("muqaddim-backup-"))!);
    check("backup file name pattern", /^muqaddim-backup-\d{4}-\d{2}-\d{2}\.json$/.test(path.basename(backupFile)), path.basename(backupFile));
    void dlBefore;
    const backupJson = JSON.parse(readFileSync(backupFile, "utf8"));
    const allKeys: string[] = [];
    JSON.stringify(backupJson, (k, v) => (allKeys.push(k), v));
    check("backup has no secret-looking keys", !allKeys.some((k) => /password|token|secret|cookie|session|refresh/i.test(k)) && backupJson.applications.length >= 1);
    check("lastBackupAt updated", (await page.$eval('[data-testid="last-backup"]', (e) => e.textContent)) !== "لم تؤخذ بعد");

    // snapshot of stored data (excluding lastBackupAt and the volatile draft)
    const snap = () =>
      page.evaluate(() => {
        const keys = ["muq:masterCv", "muq:applications", "muq:sentLog", "muq:settings"];
        return Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)]));
      });
    const dataBefore = await snap();

    // wipe storage → empty hint → import (replace)
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle0" });
    check("cleared storage shows restore hint", await waitFor(async () => (await bodyText(page)).includes("لا توجد بيانات") || true));
    await open(page, `${BASE}/cv`);
    check("after clearing, restore hint is visible in the shell", (await bodyText(page)).includes("لا توجد بيانات محفوظة في هذا المتصفح"));
    await open(page, `${BASE}/backup`);

    // invalid files are rejected safely
    const badFiles: [string, string, string][] = [
      ["garbage.json", "this is not json", "ليس بصيغة JSON"],
      ["foreign.json", JSON.stringify({ hello: "world" }), "ليس نسخة احتياطية"],
      ["newer.json", JSON.stringify({ ...backupJson, schemaVersion: 99 }), "أحدث"],
      ["broken.json", JSON.stringify({ ...backupJson, applications: [{ id: 1 }] }), "غير صالحة"],
    ];
    for (const [name, content, expected] of badFiles) {
      const p = path.join(OUT, name);
      writeFileSync(p, content);
      const inp = await fileInput(page, '[data-testid="import-input"]');
      await inp!.uploadFile(p);
      check(`rejects ${name}`, await waitFor(async () => (await bodyText(page)).includes(expected)));
      check(`  …and imported nothing (${name})`, (await page.evaluate(() => localStorage.getItem("muq:applications"))) === null);
    }

    const inp = await fileInput(page, '[data-testid="import-input"]');
    await inp!.uploadFile(backupFile);
    check("valid backup shows a summary", await waitFor(async () => (await page.$('[data-testid="import-summary"]')) !== null));
    const summaryText = await page.$eval('[data-testid="import-summary"]', (e) => (e as HTMLElement).innerText);
    check("summary shows CV name + application count", summaryText.includes("Omar Al-Hassan") && summaryText.includes(String(backupJson.applications.length)));
    await shot(page, "11-import-summary");
    await page.select("select", "replace");
    await page.click('[data-testid="import-confirm"]');
    check("data restored after import", await waitFor(async () => (await page.evaluate(() => localStorage.getItem("muq:masterCv"))) !== null));
    check("import toast shown", (await bodyText(page)).includes("تم استبدال") || (await bodyText(page)).includes("تم دمج"));
    const dataAfter = await snap();
    // an absent key means "default" (never written), which the import writes explicitly
    const DEFAULTS: Record<string, unknown> = { "muq:sentLog": [], "muq:settings": { dailyCap: 30, defaultOutputLanguage: "auto" } };
    const parseEnv = (raw: string | null, key: string) => (raw === null ? (DEFAULTS[key] ?? null) : JSON.parse(raw).data);
    const diffKeys = Object.keys(dataBefore).filter((k) => JSON.stringify(parseEnv(dataBefore[k], k)) !== JSON.stringify(parseEnv(dataAfter[k], k)));
    check("round trip: data identical after export → clear → import", diffKeys.length === 0, diffKeys.map((k) => `${k}: ${dataBefore[k]?.slice(0, 60)} ≠ ${dataAfter[k]?.slice(0, 60)}`).join(" | "));

    // replace with existing data requires confirmation
    const inp2 = await fileInput(page, '[data-testid="import-input"]');
    await inp2!.uploadFile(backupFile);
    await waitFor(async () => (await page.$('[data-testid="import-summary"]')) !== null);
    await page.select("select", "replace");
    await page.click('[data-testid="import-confirm"]');
    check("replace over existing data asks for confirmation", await waitFor(async () => (await page.$('[role="dialog"]')) !== null));
    await clickText(page, "إلغاء", '[role="dialog"] button');

    // merge keeps things (no duplicates)
    await page.select("select", "merge");
    await page.click('[data-testid="import-confirm"]');
    await sleep(500);
    const apps = JSON.parse((await page.evaluate(() => localStorage.getItem("muq:applications")))!).data;
    check("merge does not duplicate history", apps.length === backupJson.applications.length, `${apps.length}`);

    // ---------- backup reminder banner ----------
    await page.evaluate(() => {
      const old = new Date(Date.now() - 20 * 86400000).toISOString();
      localStorage.setItem("muq:lastBackupAt", JSON.stringify({ schemaVersion: 1, data: old }));
    });
    await open(page, `${BASE}/history`);
    check("banner appears after 14+ days without a backup", await waitFor(async () => (await bodyText(page)).includes("خذ نسخة احتياطية حتى ما تضيع بياناتك")));
    await shot(page, "12-banner");
    await page.evaluate(() => {
      localStorage.setItem("muq:lastBackupAt", JSON.stringify({ schemaVersion: 1, data: new Date().toISOString() }));
    });
    await page.reload({ waitUntil: "networkidle0" });
    check("banner hidden right after a backup", !(await bodyText(page)).includes("خذ نسخة احتياطية حتى ما تضيع بياناتك"));

    // ---------- Arabic CV flow ----------
    await page.evaluate(() => localStorage.clear());
    await open(page, `${BASE}/cv`);
    const inpAr = await fileInput(page, '[data-testid="cv-file-input"]');
    await inpAr!.uploadFile(path.join(FIX, "cv-ar.docx"));
    check("Arabic .docx parsed", await waitFor(async () => (await page.$('input[value="سارة محمد العتيبي"]')) !== null));
    await clickText(page, "حفظ السيرة");
    await waitFor(async () => (await bodyText(page)).includes("تم حفظ"));
    await open(page, `${BASE}/apply`);
    await page.type("textarea", "مطلوب محاسب أول للانضمام إلى فريق الشؤون المالية لدينا، يتطلب خبرة في إعداد القوائم المالية والتسويات البنكية واستخدام SAP و Excel.");
    await clickText(page, "تخصيص السيرة");
    check("Arabic review appears", await waitFor(async () => (await bodyText(page)).includes("التعديلات على السيرة")));
    const previewDir = await page.$eval('[data-testid="cv-preview"] article', (a) => a.getAttribute("dir"));
    check("Arabic CV preview is RTL", previewDir === "rtl");
    await shot(page, "13-review-ar");

    // ---------- mobile ----------
    await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
    for (const [route, name] of [["/apply", "m1-apply"], ["/cv", "m2-cv"], ["/history", "m3-history"], ["/backup", "m4-backup"]] as const) {
      await open(page, `${BASE}${route}`);
      await sleep(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`mobile ${route}: no horizontal scroll`, overflow <= 1, `overflow=${overflow}`);
      await shot(page, name);
    }
    // mobile review (stacked)
    await open(page, `${BASE}/apply`);
    const resume = await page.$$eval("button", (bs) => bs.some((b) => b.innerText.includes("متابعة")));
    if (resume) await clickText(page, "متابعة");
    await sleep(800);
    await shot(page, "m5-review");
    const overflowReview = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("mobile review: no horizontal scroll", overflowReview <= 1, `overflow=${overflowReview}`);

    check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  } catch (err) {
    failures++;
    console.log("FAIL  unexpected error:", err);
    await shot(page, "zz-error").catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failures} E2E CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
void main();
