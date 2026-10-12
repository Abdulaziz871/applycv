/**
 * End-to-end check of Phase 2 (send queue) in real Chrome.
 * Needs a dev server in mock mode (no Google / Gemini calls):
 *   AI_PROVIDER=mock GMAIL_MODE=mock npm run dev -- -p 3100     then   npm run e2e:send
 * In GMAIL_MODE=mock the server still validates, renders the PDF and builds the MIME
 * message; only the final HTTP call to Gmail is skipped, and delays are 1–2 s instead of 20–60 s.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer, { type ElementHandle, type Page } from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const PASSWORD = process.env.APP_PASSWORD || "family123";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = path.join(process.cwd(), "tests", "output", "e2e-send");
const DL = path.join(OUT, "downloads");
const FIX = path.join(process.cwd(), "tests", "fixtures");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean | Promise<boolean>, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch {
      /* page is navigating: retry */
    }
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
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
const fileInput = async (page: Page, sel: string) => (await page.$(sel)) as ElementHandle<HTMLInputElement> | null;
async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await waitFor(() =>
    page.evaluate(() => [...document.querySelectorAll("button, input, a")].some((e) => Object.keys(e).some((k) => k.startsWith("__reactProps")))),
  );
  await sleep(300);
}
/** Clicks via the DOM: the sticky send bar can sit on top of buttons near the viewport bottom. */
async function domClick(page: Page, selector: string) {
  await page.$eval(selector, (el) => (el as HTMLElement).click());
}
async function setValue(page: Page, selector: string, value: string) {
  await page.$eval(
    selector,
    (el, v) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value,
  );
}
const items = (page: Page) =>
  page.$$eval('[data-testid="queue-item"]', (els) =>
    els.map((e) => ({
      email: e.getAttribute("data-email")!,
      send: e.getAttribute("data-send")!,
      prep: e.getAttribute("data-prep")!,
      approved: e.getAttribute("data-approved") === "true",
    })),
  );
const statusOf = async (page: Page, email: string) => (await items(page)).find((i) => i.email === email);
const runState = (page: Page) => page.$eval('[data-testid="run-bar"]', (e) => e.getAttribute("data-run-state"));
const storageJson = (page: Page, key: string) =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw).data : null;
  }, key);

async function approveItem(page: Page, email: string, edit?: string) {
  await page.evaluate((em) => {
    const row = [...document.querySelectorAll('[data-testid="queue-item"]')].find((e) => e.getAttribute("data-email") === em)!;
    (row.querySelector('[data-testid="review-open"]') as HTMLButtonElement).click();
  }, email);
  await waitFor(async () => (await page.$('[data-testid="review-sheet"]')) !== null);
  const disabledBefore = await page.$eval('[data-testid="sheet-approve"]', (b) => (b as HTMLButtonElement).disabled);
  check(`  review of ${email}: «اعتماد» disabled until the checkbox is ticked`, disabledBefore);
  if (edit) {
    await page.focus('textarea[aria-label="رسالة التقديم"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("End");
    await page.keyboard.up("Control");
    await page.keyboard.type(edit);
  }
  await domClick(page, '[data-testid="sheet-approve-checkbox"]');
  await domClick(page, '[data-testid="sheet-approve"]');
  await waitFor(async () => (await page.$('[data-testid="review-sheet"]')) === null);
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(DL, { recursive: true });

  // ---- fixtures: CSV (Arabic-locale style ';' + BOM) and XLSX ----
  const csv = [
    "email;company;position;job_description",
    "hr@alpha.com;Alpha;Frontend Lead;We are hiring a Senior Frontend Engineer to build fast interfaces with React and TypeScript. Kubernetes is a plus.",
    "jobs@beta.com;Beta;Engineer;",
    "HR@ALPHA.COM;Alpha again;;", // duplicate (case-insensitive)
    "not-an-email;Gamma;;", // invalid
    "team@delta.com;Delta;React Developer;Looking for a React developer with strong CSS and TypeScript skills, ideally with mentoring experience.",
    "careers@epsilon.com;Epsilon;;",
    "",
  ].join("\n");
  writeFileSync(path.join(OUT, "contacts.csv"), "\uFEFF" + csv);
  const { default: writeExcelFile } = await import("write-excel-file/node");
  const xlsx = await writeExcelFile([
    ["Email", "Company", "Position", "Job Description"],
    ["hr@zeta.com", "شركة زيتا", "مطوّر", ""],
    ["jobs@beta.com", "Beta dup", "", ""], // already in queue
  ] as never).toBuffer();
  writeFileSync(path.join(OUT, "contacts.xlsx"), xlsx);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const cdp = await browser.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const sendReqs: { t: number; body: Record<string, unknown> }[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/send") && r.method() === "POST") sendReqs.push({ t: Date.now(), body: JSON.parse(r.postData() ?? "{}") });
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  try {
    // ---------- login + master CV ----------
    await open(page, `${BASE}/login`);
    await page.type('input[type="password"]', PASSWORD);
    await clickText(page, "دخول");
    await waitFor(() => page.url().includes("/apply"));
    await open(page, `${BASE}/cv`);
    await (await fileInput(page, '[data-testid="cv-file-input"]'))!.uploadFile(path.join(FIX, "cv-en.docx"));
    await waitFor(async () => (await page.$('input[value="Omar Al-Hassan"]')) !== null);
    await clickText(page, "حفظ السيرة");
    await waitFor(async () => (await bodyText(page)).includes("تم حفظ سيرتك الذاتية"));

    // ---------- Gmail connection ----------
    await open(page, `${BASE}/send`);
    check("nav has «الإرسال بالإيميل»", (await bodyText(page)).includes("الإرسال بالإيميل"));
    check("Gmail starts disconnected", (await page.$('[data-testid="gmail-disconnected"]')) !== null);
    check("spam-risk explanation is shown", (await bodyText(page)).includes("قد يجعل Gmail يصنّف حسابك"));
    check("cannot start: «اربط Gmail أولاً»", (await bodyText(page)).includes("اربط Gmail أولاً") && (await page.$eval('[data-testid="start-send"]', (b) => (b as HTMLButtonElement).disabled)));
    await shot(page, "01-send-empty");
    await domClick(page, '[data-testid="gmail-connect"]').catch(() => {}); // navigates (OAuth round trip)
    check("connect flow returns and shows connected", await waitFor(async () => (await page.$('[data-testid="gmail-connected"]')) !== null));
    check("success toast after connecting", (await bodyText(page)).includes("تم ربط Gmail"));
    check("URL is cleaned (no ?gmail=)", !page.url().includes("gmail="));
    const cookies = await page.cookies();
    const gm = cookies.find((c) => c.name === "muq_gmail");
    check("Gmail token cookie is httpOnly, encrypted (not the plain token)", !!gm?.httpOnly && !gm.value.includes("mock-refresh-token"));
    check("token is not readable by page JS", !(await page.evaluate(() => document.cookie)).includes("muq_gmail"));
    check("token is not in localStorage", (await page.evaluate(() => Object.keys(localStorage).join(","))).indexOf("gmail") === -1);

    // ---------- import ----------
    await (await fileInput(page, '[data-testid="send-file-input"]'))!.uploadFile(path.join(OUT, "contacts.csv"));
    check("CSV preview shows valid rows", await waitFor(async () => (await page.$('[data-testid="import-preview"]')) !== null));
    const skipped = await page.$eval('[data-testid="skipped-list"]', (e) => (e as HTMLElement).innerText);
    check("duplicate + invalid rows are reported", skipped.includes("مكرر في الملف") && skipped.includes("بريد غير صالح"), skipped.replace(/\n/g, " | "));
    await shot(page, "02-import-preview");
    await domClick(page, '[data-testid="import-add"]');
    await waitFor(async () => (await items(page)).length === 4);
    check("4 valid unique addresses queued from CSV", (await items(page)).length === 4);

    await (await fileInput(page, '[data-testid="send-file-input"]'))!.uploadFile(path.join(OUT, "contacts.xlsx"));
    await waitFor(async () => (await page.$('[data-testid="import-preview"]')) !== null);
    const skipped2 = await page.$eval('[data-testid="skipped-list"]', (e) => (e as HTMLElement).innerText);
    check("XLSX: address already in queue is skipped", skipped2.includes("موجود في الطابور"));
    await domClick(page, '[data-testid="import-add"]');
    await waitFor(async () => (await items(page)).length === 5);
    check("XLSX row added (Arabic company preserved)", (await bodyText(page)).includes("شركة زيتا"));

    await page.evaluate(() => (document.querySelector("details summary") as HTMLElement).click());
    await page.type('[data-testid="manual-email"]', "bad email");
    await domClick(page, '[data-testid="manual-add"]');
    check("manual add rejects an invalid address", await waitFor(async () => (await bodyText(page)).includes("عنوان البريد غير صالح")));
    await setValue(page, '[data-testid="manual-email"]', "manual@eta.com");
    await domClick(page, '[data-testid="manual-add"]');
    await waitFor(async () => (await items(page)).length === 6);
    check("manual address queued", (await statusOf(page, "manual@eta.com")) !== undefined);
    check("all items start unprepared + unapproved", (await items(page)).every((i) => i.prep === "pending" && !i.approved && i.send === "waiting"));

    // ---------- prepare (AI) ----------
    check("cannot start: no approved items", (await page.$eval('[data-testid="start-send"]', (b) => (b as HTMLButtonElement).disabled)));
    await domClick(page, '[data-testid="prep-all"]');
    check("all 6 prepared", await waitFor(async () => (await items(page)).every((i) => i.prep === "ready"), 90000));
    check("prepared ≠ approved: nothing is approved automatically", (await items(page)).every((i) => !i.approved));
    check("still cannot start (0 approved)", (await page.$eval('[data-testid="start-send"]', (b) => (b as HTMLButtonElement).disabled)));
    await shot(page, "03-queue-prepared");

    // ---------- review + approve (A,B,C,D approved; E,F not) ----------
    const A = "hr@alpha.com", B = "jobs@beta.com", C = "team@delta.com", D = "careers@epsilon.com", E = "hr@zeta.com", F = "manual@eta.com";
    await domClick(page, '[data-testid="review-open"]');
    await waitFor(async () => (await page.$('[data-testid="review-sheet"]')) !== null);
    check("review sheet shows changes, letter, preview, subject", (await bodyText(page)).includes("رسالة التقديم") && (await page.$('[data-testid="subject-input"]')) !== null && (await page.$('[data-testid="cv-preview"]')) !== null);
    await shot(page, "04-review-sheet");
    await domClick(page, '[aria-label="إغلاق"]');
    await waitFor(async () => (await page.$('[data-testid="review-sheet"]')) === null);
    check("closing the sheet without approving approves nothing", (await items(page)).every((i) => !i.approved));

    await approveItem(page, A, " P.S. approved-A");
    check("approved item is marked معتمد", (await statusOf(page, A))?.approved === true);
    // editing after approval revokes it
    await page.evaluate((em) => {
      const row = [...document.querySelectorAll('[data-testid="queue-item"]')].find((e) => e.getAttribute("data-email") === em)!;
      (row.querySelector('[data-testid="review-open"]') as HTMLButtonElement).click();
    }, A);
    await waitFor(async () => (await page.$('[data-testid="review-sheet"]')) !== null);
    await page.focus('[data-testid="subject-input"]');
    await page.keyboard.type("!");
    await sleep(200);
    check("editing an approved item revokes its approval", (await page.evaluate(() => document.querySelector('[data-testid="queue-item"]')!.getAttribute("data-approved"))) === "false");
    await domClick(page, '[data-testid="sheet-approve-checkbox"]');
    await domClick(page, '[data-testid="sheet-approve"]');
    await waitFor(async () => (await page.$('[data-testid="review-sheet"]')) === null);
    for (const e of [B, C, D]) await approveItem(page, e);
    check("A,B,C,D approved; E,F not", (await items(page)).filter((i) => i.approved).map((i) => i.email).sort().join() === [A, B, C, D].sort().join());
    check("approved counter shows 4", (await page.$eval('[data-testid="approved-count"]', (e) => e.textContent)) === "4");

    // ---------- daily cap ----------
    await setValue(page, '[data-testid="daily-cap"]', "2");
    await sleep(200);
    check("cap saved in settings", (await storageJson(page, "muq:settings")).dailyCap === 2);
    await setValue(page, '[data-testid="daily-cap"]', "500");
    await sleep(200);
    check("cap hard maximum is 100", (await storageJson(page, "muq:settings")).dailyCap === 100);
    await setValue(page, '[data-testid="daily-cap"]', "2");
    await sleep(200);

    await domClick(page, '[data-testid="start-send"]');
    check("run starts", await waitFor(async () => (await runState(page)) !== "idle"));
    check("warns to keep the tab open", (await bodyText(page)).includes("لا تغلق هذه الصفحة"));
    check("daily cap: exactly 2 sent, then the run stops", await waitFor(async () => (await runState(page)) === "idle" && sendReqs.length >= 2, 60000));
    await sleep(2500);
    check("no third request after the cap", sendReqs.length === 2, `${sendReqs.length} requests`);
    check("cap notice shown", (await bodyText(page)).includes("وصلت الحد اليومي"));
    check("first two approved items were sent, in queue order", (await statusOf(page, A))?.send === "sent" && (await statusOf(page, B))?.send === "sent");
    check("C and D stayed waiting; unapproved E,F untouched", (await statusOf(page, C))?.send === "waiting" && (await statusOf(page, D))?.send === "waiting" && (await statusOf(page, E))?.send === "waiting" && (await statusOf(page, F))?.send === "waiting");
    const gap = sendReqs[1].t - sendReqs[0].t;
    check("delay between e-mails (mock 1–2 s + send time)", gap >= 1000, `${gap} ms`);
    check("every send request carries approved:true + PDF file name + subject", sendReqs.every((r) => r.body.approved === true && String(r.body.fileName).endsWith(".pdf") && String(r.body.subject).length > 3));
    check("subject edit and letter edit were sent", String(sendReqs[0].body.subject).endsWith("!") && String(sendReqs[0].body.body).includes("approved-A"));
    check("sent today counter = 2 of 2", (await page.$eval('[data-testid="sent-today"]', (e) => e.textContent)) === "2");
    check("start disabled when cap reached", (await page.$eval('[data-testid="start-send"]', (b) => (b as HTMLButtonElement).disabled)) && (await bodyText(page)).includes("بلغت الحد اليومي"));
    await shot(page, "05-cap-reached");

    // ---------- pause / resume / cancel ----------
    await setValue(page, '[data-testid="daily-cap"]', "10");
    await sleep(200);
    const before = sendReqs.length;
    await domClick(page, '[data-testid="start-send"]');
    await waitFor(() => sendReqs.length === before + 1, 30000); // C is sent
    await waitFor(async () => (await page.$('[data-testid="countdown"]')) !== null, 10000);
    await domClick(page, '[data-testid="pause-send"]');
    check("run is paused", (await runState(page)) === "paused");
    await shot(page, "06-paused");
    await sleep(3500);
    check("paused: nothing new is sent (D waits)", sendReqs.length === before + 1 && (await statusOf(page, D))?.send === "waiting");
    await domClick(page, '[data-testid="cancel-send"]');
    check("cancel ends the run", await waitFor(async () => (await runState(page)) === "idle", 10000));
    check("cancelled: D still waiting, only C was sent", (await statusOf(page, D))?.send === "waiting" && (await statusOf(page, C))?.send === "sent");
    // resume path
    await domClick(page, '[data-testid="start-send"]');
    await waitFor(async () => (await page.$('[data-testid="pause-send"]')) !== null);
    await domClick(page, '[data-testid="pause-send"]');
    await sleep(500);
    await domClick(page, '[data-testid="resume-send"]');
    check("resume continues and sends D", await waitFor(async () => (await statusOf(page, D))?.send === "sent", 30000));
    check("run finishes when nothing approved remains", await waitFor(async () => (await runState(page)) === "idle", 15000));
    check("unapproved E and F were NEVER sent", (await statusOf(page, E))?.send === "waiting" && (await statusOf(page, F))?.send === "waiting" && !sendReqs.some((r) => [E, F].includes(String(r.body.to))));
    check("exactly 4 sends in total", sendReqs.length === 4, `${sendReqs.length}`);

    // ---------- sent log, history, persistence ----------
    const log = await storageJson(page, "muq:sentLog");
    check("sent log has 4 'sent' entries", log.length === 4 && log.every((e: { status: string }) => e.status === "sent"));
    const apps = await storageJson(page, "muq:applications");
    check("e-mailed applications saved to history with recipient", apps.filter((a: { recipientEmail?: string }) => a.recipientEmail).length === 4);
    await shot(page, "07-after-send");
    await page.reload({ waitUntil: "networkidle0" });
    await waitFor(async () => (await items(page)).length === 6);
    check("queue survives a reload (statuses kept)", (await statusOf(page, A))?.send === "sent" && (await statusOf(page, E))?.prep === "ready");

    // re-import: contacted addresses are skipped
    await (await fileInput(page, '[data-testid="send-file-input"]'))!.uploadFile(path.join(OUT, "contacts.csv"));
    await waitFor(async () => (await page.$('[data-testid="import-preview"]')) !== null);
    const skipped3 = await page.$eval('[data-testid="skipped-list"]', (e) => (e as HTMLElement).innerText);
    check("re-importing skips already-contacted addresses", skipped3.includes("سبق التواصل معه"), skipped3.replace(/\n/g, " | "));
    await clickText(page, "إلغاء", '[data-testid="import-preview"] button');

    // interrupted send is never auto-retried
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("muq:queue")!);
      raw.data.find((i: { email: string }) => i.email === "hr@zeta.com").send = "sending";
      localStorage.setItem("muq:queue", JSON.stringify(raw));
    });
    await page.reload({ waitUntil: "networkidle0" });
    await waitFor(async () => (await items(page)).length === 6);
    check("item found mid-send after a crash is marked failed (not retried)", (await statusOf(page, E))?.send === "failed" && (await bodyText(page)).includes("انقطع الإرسال"));

    // ---------- backup ----------
    await open(page, `${BASE}/backup`);
    await domClick(page, '[data-testid="export-btn"]');
    await waitFor(async () => (await import("node:fs")).readdirSync(DL).some((n) => n.startsWith("muqaddim-backup-")));
    const bf = (await import("node:fs")).readdirSync(DL).find((n) => n.startsWith("muqaddim-backup-"))!;
    const backup = JSON.parse(readFileSync(path.join(DL, bf), "utf8"));
    check("backup includes the sent log (4 entries)", backup.sentLog.length === 4);
    check("backup has no queue / tokens", !("queue" in backup) && !JSON.stringify(Object.keys(backup)).match(/token|gmail|cookie/i) && !JSON.stringify(backup).includes("mock-refresh"));

    // ---------- single application → queue (from /apply step 3) ----------
    await open(page, `${BASE}/apply`);
    await page.type("textarea", "Hiring a Frontend Engineer with React, CSS and TypeScript. Mentoring is a plus. Join our product team and build fast interfaces.");
    const [company] = await page.$$('input[type="text"], input:not([type])');
    await company.type("Theta Co");
    await clickText(page, "تخصيص السيرة");
    await waitFor(async () => (await bodyText(page)).includes("التعديلات على السيرة"));
    await domClick(page, '[data-testid="approve-checkbox"]');
    await domClick(page, '[data-testid="continue-btn"]');
    await waitFor(async () => (await bodyText(page)).includes("جاهز للتنزيل"));
    await domClick(page, '[data-testid="email-open"]');
    await page.type('[data-testid="email-recipient"]', "hr@alpha.com");
    await domClick(page, '[data-testid="email-queue"]');
    check("apply→send: already-contacted recipient is refused", await waitFor(async () => (await bodyText(page)).includes("سبق إرسال تقديم")));
    await setValue(page, '[data-testid="email-recipient"]', "hr@theta.com");
    await domClick(page, '[data-testid="email-queue"]');
    check("apply→send: navigates to /send", await waitFor(() => page.url().endsWith("/send")));
    await waitFor(async () => (await items(page)).some((i) => i.email === "hr@theta.com"));
    const theta = await statusOf(page, "hr@theta.com");
    check("apply→send: item is prepared + approved (already reviewed there)", theta?.prep === "ready" && theta.approved);

    // ---------- disconnect ----------
    await clickText(page, "فصل الحساب");
    check("disconnect works; sending is blocked again", await waitFor(async () => (await page.$('[data-testid="gmail-disconnected"]')) !== null) && (await page.$eval('[data-testid="start-send"]', (b) => (b as HTMLButtonElement).disabled)));
    check("cookie removed on disconnect", !(await page.cookies()).some((c) => c.name === "muq_gmail"));

    // ---------- API guards ----------
    const master = await storageJson(page, "muq:masterCv");
    const post = (body: unknown) =>
      page.evaluate((b) => fetch("/api/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.status), body as never);
    const base = { to: "a@b.com", subject: "s", body: "b", cv: master, fileName: "a.pdf" };
    const guard = {
      noApproval: await post(base),
      badEmail: await post({ ...base, to: "a@b.com\r\nBcc: x@y.com", approved: true }),
      notConnected: await post({ ...base, approved: true }),
    };
    check("API refuses a send without approved:true", guard.noApproval === 400);
    check("API refuses header-injection recipient", guard.badEmail === 422 || guard.badEmail === 400);
    check("API refuses when Gmail is not connected", guard.notConnected === 409);

    // ---------- mobile ----------
    await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
    await open(page, `${BASE}/send`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("mobile /send: no horizontal scroll", overflow <= 1, `overflow=${overflow}`);
    await shot(page, "08-mobile-send");
    check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  } catch (err) {
    failures++;
    console.log("FAIL  unexpected error:", err);
    await shot(page, "zz-error").catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? "\nALL PHASE 2 E2E CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
void main();
