// Muqaddim LinkedIn auto-apply — background service worker.
// Flow per run: search each title (last 24h, Easy Apply) → open each new job →
// tailored CV + PDF from the Muqaddim site → fill the Easy Apply form → submit.
// Everything the site needs (settings, master CV, token) arrives via bridge.js.

const LOG_MAX = 300;
const LOCK_MINUTES = 45;
const CATCH_UP_HOURS = 3;

// ---------------- storage helpers ----------------

const get = async (key, fallback) => (await chrome.storage.local.get(key))[key] ?? fallback;
const set = (key, value) => chrome.storage.local.set({ [key]: value });

const todayKey = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time

async function loadState() {
  const s = await get("state", {});
  const day = todayKey();
  return {
    appliedJobIds: s.appliedJobIds ?? [],
    seenJobIds: s.seenJobIds ?? [],
    slotsDone: (s.slotsDone ?? []).filter((x) => x.startsWith(day)),
    day,
    todayCount: s.day === day ? (s.todayCount ?? 0) : 0,
    lastRun: s.lastRun ?? null,
  };
}
const saveState = (s) =>
  set("state", { ...s, appliedJobIds: s.appliedJobIds.slice(-3000), seenJobIds: s.seenJobIds.slice(-5000) });

async function addLog(entry) {
  const log = await get("log", []);
  log.unshift({ at: new Date().toISOString(), ...entry });
  await set("log", log.slice(0, LOG_MAX));
}

// ---------------- small utils ----------------

// Long sleeps keep the service worker alive (an extension API call every 20s).
async function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, Math.min(20000, end - Date.now())));
    await chrome.runtime.getPlatformInfo();
  }
}
const rand = (min, max) => Math.round(min + Math.random() * (max - min));

function titleAllowed(title, settings) {
  const t = ` ${title.toLowerCase()} `;
  const has = (w) => {
    const word = w.trim().toLowerCase();
    if (!word) return false;
    // short words ("ai", "bi", "ml") must match as whole words
    if (word.length <= 3) return new RegExp(`[^a-z]${word}[^a-z]`).test(t);
    return t.includes(word);
  };
  if (settings.titleExclude.some(has)) return false;
  return settings.titleInclude.length === 0 || settings.titleInclude.some(has);
}

function searchUrl(title, location) {
  const q = location ? `${title} jobs in ${location}` : title;
  const p = new URLSearchParams({ keywords: q, f_AL: "true", f_TPR: "r86400", sortBy: "DD" });
  return `https://www.linkedin.com/jobs/search-results/?${p}`;
}

function safeName(s) {
  return (s || "").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "Company";
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------------- site API ----------------

class StopRun extends Error {}

async function api(config, path, body, binary = false) {
  const res = await fetch(config.siteOrigin + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new StopRun("انتهى ربط الإضافة بالموقع. افتح صفحة LinkedIn في الموقع واضغط «ربط الإضافة».");
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    if (res.status === 429) throw new StopRun(j.error || "انتهى حد الذكاء الاصطناعي اليومي.");
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  return binary ? res.arrayBuffer() : res.json();
}

// ---------------- tab control ----------------

function waitForLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(timer);
      resolve();
    };
    const onUpd = (id, info) => id === tabId && info.status === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpd);
  });
}

async function openInTab(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await waitForLoad(tabId);
  await sleep(rand(2500, 4500));
  await chrome.scripting.executeScript({ target: { tabId }, files: ["linkedin.js"] });
}

async function callTab(tabId, cmd, payload = {}) {
  const res = await chrome.tabs.sendMessage(tabId, { muq: true, cmd, ...payload });
  if (!res) throw new Error("no response from page");
  if (res.error) throw new Error(res.error);
  return res;
}

// ---------------- the run ----------------

let running = false;
let currentJob = null; // context for "answer" requests from the page

async function runOnce({ trigger, dry = false }) {
  if (running) return { started: false, reason: "يعمل الآن" };
  const lock = await get("lock", null);
  if (lock && Date.now() - lock < LOCK_MINUTES * 60000) return { started: false, reason: "يعمل الآن" };

  const config = await get("config", null);
  if (!config?.settings || !config.cv || !config.token || !config.siteOrigin) {
    await addLog({ status: "failed", reason: "الإضافة غير مربوطة بالموقع بعد." });
    return { started: false, reason: "غير مربوطة" };
  }
  const settings = config.settings;
  if (trigger === "alarm" && !settings.enabled) return { started: false, reason: "متوقفة" };
  const dryRun = dry || settings.submitMode === "dry";

  running = true;
  await set("lock", Date.now());
  const state = await loadState();
  const summary = { at: new Date().toISOString(), trigger, dryRun, found: 0, submitted: 0, skipped: 0, failed: 0, note: "" };
  let windowId = null;

  try {
    let budget = dryRun ? settings.maxPerRun : Math.min(settings.maxPerRun, settings.maxPerDay - state.todayCount);
    if (budget <= 0) {
      summary.note = "وصلت للحد اليومي.";
      return { started: true };
    }

    const win = await chrome.windows.create({ url: "about:blank", focused: false, width: 1280, height: 900 });
    windowId = win.id;
    const tabId = win.tabs[0].id;

    // 1) collect candidates from every title
    const known = new Set([...state.appliedJobIds, ...state.seenJobIds]);
    const candidates = new Map();
    for (const title of settings.titles) {
      await openInTab(tabId, searchUrl(title, settings.location));
      const { cards } = await callTab(tabId, "collect");
      for (const c of cards) {
        if (c.applied || known.has(c.id) || candidates.has(c.id)) continue;
        if (!titleAllowed(c.title, settings)) continue;
        candidates.set(c.id, c);
      }
      await sleep(rand(3000, 7000));
    }
    summary.found = candidates.size;

    // 2) apply
    for (const card of candidates.values()) {
      if (budget <= 0) break;
      const url = `https://www.linkedin.com/jobs/view/${card.id}/`;
      try {
        await openInTab(tabId, url);
        const job = await callTab(tabId, "jobInfo");
        const base = { jobId: card.id, url, title: job.title || card.title, company: job.company };

        if (!job.easyApply || job.applied) {
          state.seenJobIds.push(card.id);
          if (job.applied) state.appliedJobIds.push(card.id);
          continue;
        }
        if (!titleAllowed(base.title, settings)) {
          state.seenJobIds.push(card.id);
          continue;
        }

        const hasJd = (job.description || "").trim().length >= 30;
        const tailored = await api(config, "/api/tailor", {
          cv: config.cv,
          jobDescription: hasJd ? job.description.slice(0, 15000) : "",
          company: (job.company || "").slice(0, 500),
          jobTitle: base.title.slice(0, 500),
          outputLanguage: "en",
          mode: hasJd ? "tailor" : "asis",
        });
        const pdf = await api(config, "/api/pdf", { cv: tailored.cv }, true);
        const fileName = `${safeName(config.cv.name)}_${safeName(job.company)}.pdf`;

        currentJob = { title: base.title, company: job.company, config };
        const result = await callTab(tabId, "apply", {
          pdfBase64: toBase64(pdf),
          fileName,
          coverLetter: tailored.coverLetter,
          dry: dryRun,
          answers: settings.answers,
          cvName: config.cv.name,
          links: config.cv.contact?.links ?? [],
        });
        currentJob = null;

        if (result.status === "submitted") {
          state.appliedJobIds.push(card.id);
          state.todayCount++;
          summary.submitted++;
          budget--;
          await addLog({ ...base, status: "submitted" });
          const pending = await get("pending", []);
          pending.push({
            id: `li-${card.id}`,
            ...base,
            appliedAt: new Date().toISOString(),
            cv: tailored.cv,
            coverLetter: tailored.coverLetter,
            language: tailored.language,
            hasJobDescription: hasJd,
          });
          await set("pending", pending.slice(-200));
        } else if (result.status === "dry") {
          summary.submitted++;
          budget--;
          await addLog({ ...base, status: "dry", reason: "تجربة: عُبّئ النموذج ولم يُرسل." });
        } else {
          state.seenJobIds.push(card.id); // don't retry a form we couldn't complete
          summary.skipped++;
          await addLog({ ...base, status: "skipped", reason: result.reason });
        }
        await saveState(state);
        await sleep(rand(25000, 60000));
      } catch (err) {
        currentJob = null;
        if (err instanceof StopRun) throw err;
        summary.failed++;
        await addLog({ jobId: card.id, url, title: card.title, status: "failed", reason: String(err.message || err).slice(0, 300) });
      }
    }
    if (!summary.found) summary.note = "لا توجد وظائف جديدة مطابقة في آخر 24 ساعة.";
  } catch (err) {
    summary.note = String(err.message || err).slice(0, 300);
    await addLog({ status: "failed", reason: summary.note });
  } finally {
    if (windowId !== null) await chrome.windows.remove(windowId).catch(() => {});
    state.lastRun = summary;
    await saveState(state);
    await set("lock", null);
    running = false;
  }
  return { started: true };
}

// ---------------- schedule ----------------

function nextOccurrence(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function schedule() {
  await chrome.alarms.clearAll();
  const config = await get("config", null);
  for (const t of config?.settings?.times ?? []) {
    chrome.alarms.create(`slot-${t}`, { when: nextOccurrence(t), periodInMinutes: 1440 });
  }
}

async function runSlot(t) {
  const state = await loadState();
  const slot = `${state.day} ${t}`;
  if (state.slotsDone.includes(slot)) return;
  state.slotsDone.push(slot);
  await saveState(state);
  await runOnce({ trigger: "alarm" });
}

/** Chrome was closed at a scheduled time: run once if it was missed by less than CATCH_UP_HOURS. */
async function catchUp() {
  const config = await get("config", null);
  if (!config?.settings?.enabled) return;
  const now = new Date();
  for (const t of [...(config.settings.times ?? [])].reverse()) {
    const [h, m] = t.split(":").map(Number);
    const at = new Date(now);
    at.setHours(h, m, 0, 0);
    const late = now - at;
    if (late > 60000 && late < CATCH_UP_HOURS * 3600000) {
      await runSlot(t);
      return;
    }
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name.startsWith("slot-")) runSlot(a.name.slice(5));
});
chrome.runtime.onStartup.addListener(async () => {
  await registerBridge();
  await schedule();
  await set("lock", null);
  await catchUp();
});
chrome.runtime.onInstalled.addListener(async () => {
  await registerBridge();
  await schedule();
});

// ---------------- site bridge registration ----------------

const sitePattern = (origin) => {
  const u = new URL(origin);
  return `${u.protocol}//${u.hostname}/*`;
};

async function hasSitePermission(origin) {
  return !!origin && chrome.permissions.contains({ origins: [sitePattern(origin)] });
}

/** (Re)registers bridge.js on the site origin and injects it into already-open site tabs. */
async function registerBridge() {
  const config = await get("config", null);
  await chrome.scripting.unregisterContentScripts({ ids: ["bridge"] }).catch(() => {});
  if (!config?.siteOrigin || !(await hasSitePermission(config.siteOrigin))) return false;
  const pattern = sitePattern(config.siteOrigin);
  try {
    await chrome.scripting.registerContentScripts([
      { id: "bridge", matches: [pattern], js: ["bridge.js"], runAt: "document_start" },
    ]);
  } catch {
    return false;
  }
  for (const tab of await chrome.tabs.query({ url: pattern })) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["bridge.js"] }).catch(() => {});
  }
  return true;
}

chrome.permissions.onAdded.addListener(() => registerBridge());

// ---------------- messages ----------------

async function status() {
  const config = await get("config", null);
  const state = await loadState();
  const alarms = await chrome.alarms.getAll();
  return {
    version: chrome.runtime.getManifest().version,
    siteOrigin: config?.siteOrigin ?? null,
    sitePermission: await hasSitePermission(config?.siteOrigin),
    configured: !!(config?.settings && config?.cv && config?.token),
    enabled: !!config?.settings?.enabled,
    submitMode: config?.settings?.submitMode ?? "dry",
    tokenExpiresAt: config?.tokenExpiresAt ?? null,
    running: running || !!(await get("lock", null)),
    todayCount: state.todayCount,
    maxPerDay: config?.settings?.maxPerDay ?? 0,
    lastRun: state.lastRun,
    nextRuns: alarms.map((a) => a.scheduledTime).sort((a, b) => a - b),
  };
}

async function handle(msg, sender) {
  const fromPopup = sender.id === chrome.runtime.id && !sender.tab;
  const fromLinkedin = sender.tab && sender.url?.startsWith("https://www.linkedin.com/");

  if (fromPopup) {
    if (msg.type === "status") return status();
    if (msg.type === "setSite") {
      const config = { ...(await get("config", {})), siteOrigin: msg.origin };
      await set("config", config);
      await registerBridge();
      return { ok: true };
    }
    if (msg.type === "runNow") {
      if (running) return { started: false, reason: "يعمل الآن" };
      runOnce({ trigger: "manual", dry: !!msg.dry });
      return { started: true };
    }
    if (msg.type === "log") return { log: await get("log", []) };
  }

  if (fromLinkedin && msg.type === "answer") {
    if (!currentJob) return { answer: null };
    const { config, title, company } = currentJob;
    try {
      const r = await api(config, "/api/linkedin/answer", {
        question: msg.question.slice(0, 1500),
        kind: msg.kind,
        options: (msg.options || []).slice(0, 80).map((o) => o.slice(0, 300)),
        jobTitle: (title || "").slice(0, 500),
        company: (company || "").slice(0, 500),
        cv: config.cv,
        answers: config.settings.answers,
      });
      return { answer: r.answer ?? null };
    } catch {
      return { answer: null };
    }
  }

  // Messages relayed from the Muqaddim site page: only from the configured origin.
  if (msg.from === "bridge") {
    const config = await get("config", null);
    if (!config?.siteOrigin || sender.origin !== config.siteOrigin) return { error: "origin not allowed" };
    switch (msg.type) {
      case "status":
        return status();
      case "configure": {
        const { settings, cv, token, tokenExpiresAt } = msg.payload || {};
        if (!settings || !cv) return { error: "missing settings or cv" };
        await set("config", {
          ...config,
          settings,
          cv,
          token: token || config.token,
          tokenExpiresAt: tokenExpiresAt || config.tokenExpiresAt,
        });
        await schedule();
        return status();
      }
      case "runNow":
        if (running) return { started: false, reason: "يعمل الآن" };
        runOnce({ trigger: "manual", dry: !!msg.payload?.dry });
        return { started: true };
      case "getLog":
        return { log: await get("log", []), pending: await get("pending", []) };
      case "ackSynced": {
        const ids = new Set(msg.payload?.ids || []);
        await set("pending", (await get("pending", [])).filter((p) => !ids.has(p.id)));
        return { ok: true };
      }
    }
  }
  return { error: "unknown message" };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) }));
  return true;
});
