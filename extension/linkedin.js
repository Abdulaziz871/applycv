// Muqaddim — runs inside linkedin.com tabs opened by the background worker.
// Commands: collect (search results), jobInfo (one job page), apply (Easy Apply form).
// Selectors target LinkedIn's 2026 UI: job cards carry componentkey="job-card-component-ref-<id>",
// the Easy Apply form is a dialog headed "Apply to <Company>".

if (!window.__muqLoaded) {
  window.__muqLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (min, max) => sleep(min + Math.random() * (max - min));
  const clean = (s) => (s || "").replace(/\s+/g, " ").replace(/\*/g, "").replace(/\bRequired\b/gi, "").trim();

  async function waitFor(fn, timeoutMs = 15000, every = 300) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(every);
    }
    return null;
  }

  class Skip extends Error {}

  // ---------------- search results ----------------

  function scrollParent(el) {
    for (let p = el?.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 50) return p;
    }
    return document.scrollingElement;
  }

  async function collect() {
    const first = await waitFor(() => document.querySelector('[componentkey^="job-card-component-ref-"]'), 15000);
    if (!first) return { cards: [] };
    const scroller = scrollParent(first);
    for (let i = 0; i < 8; i++) {
      scroller.scrollBy(0, 900);
      await jitter(600, 1100);
    }
    const cards = new Map();
    document.querySelectorAll('[componentkey^="job-card-component-ref-"]').forEach((el) => {
      const id = el.getAttribute("componentkey").replace("job-card-component-ref-", "");
      if (!/^\d+$/.test(id) || cards.has(id)) return;
      const lines = (el.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
      const title = (lines[0] || "").replace(/^Selected,\s*/, "").replace(/\s*\(Verified job\)\s*$/, "");
      cards.set(id, { id, title, applied: lines.includes("Applied"), text: lines.join(" | ").slice(0, 300) });
    });
    return { cards: [...cards.values()] };
  }

  // ---------------- job page ----------------

  async function jobInfo() {
    await waitFor(
      () => [...document.querySelectorAll("h2")].some((h) => /About the job/i.test(h.innerText)) ||
        document.querySelector('button[aria-label^="Easy Apply"]'),
      15000,
    );
    const parts = document.title.replace(/^\(\d+\)\s*/, "").split(" | ");
    const title = parts[0] || "";
    const company = parts.length > 2 ? parts.slice(1, -1).join(" | ") : "";

    let description = "";
    const h = [...document.querySelectorAll("h2")].find((x) => /About the job/i.test(x.innerText));
    if (h) {
      let sec = h;
      for (let i = 0; i < 5 && sec && sec.innerText.length < 200; i++) sec = sec.parentElement;
      description = (sec?.innerText || "").replace(/^About the job\s*/i, "").trim();
    }
    const top = (document.querySelector("main")?.innerText || "").slice(0, 1500);
    const location = (top.split("\n").find((l) => l.includes(" · ")) || "").split(" · ")[0].trim();
    return {
      title,
      company,
      location,
      description,
      easyApply: !!document.querySelector('button[aria-label^="Easy Apply"]'),
      applied: /\bApplied\b[^\n]{0,40}\bago\b|Application submitted|Application sent/i.test(top),
    };
  }

  // ---------------- Easy Apply form ----------------

  const PRIMARY = /^(Next|Continue|Review|Submit application|Continue to next step|Review your application)$/i;

  function findModal() {
    const h = [...document.querySelectorAll("h2")].find((x) => /^Apply to /.test(x.innerText.trim()));
    let c = h;
    while (c && ![...c.querySelectorAll("button")].some((b) => PRIMARY.test(b.innerText.trim()))) c = c.parentElement;
    return c && c !== document.body ? c : null;
  }

  function primaryButton(modal) {
    const btns = [...modal.querySelectorAll("button")].filter((b) => !b.disabled);
    const by = (re) => btns.find((b) => re.test(b.innerText.trim()) || re.test(b.getAttribute("aria-label") || ""));
    return (
      by(/^Submit application$/i) ||
      by(/^(Review|Review your application)$/i) ||
      by(/^(Next|Continue|Continue to next step)$/i)
    );
  }

  function errorsIn(modal) {
    const texts = [...modal.querySelectorAll('[role="alert"], [aria-live], [id*="error"], [class*="error"]')]
      .map((e) => e.innerText.trim())
      .filter((t) => t && /enter|select|required|valid|choose|answer|اختر|أدخل|مطلوب/i.test(t));
    return texts.length ? texts[0].slice(0, 150) : null;
  }

  function labelFor(el, modal) {
    const byFor = el.id && modal.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText;
    if (byFor) return clean(byFor);
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
      if (t.trim()) return clean(t);
    }
    const legend = el.closest("fieldset")?.querySelector("legend")?.innerText;
    if (legend) return clean(legend);
    const wrap = el.closest("label")?.innerText;
    if (wrap) return clean(wrap);
    let p = el.parentElement;
    for (let i = 0; i < 4 && p && !clean(p.innerText); i++) p = p.parentElement;
    return clean(p?.innerText).slice(0, 300);
  }

  function radioOptionText(r, modal) {
    return clean(
      (r.id && modal.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.innerText) ||
        r.closest("label")?.innerText ||
        r.getAttribute("aria-label") ||
        r.parentElement?.innerText ||
        r.value,
    );
  }

  function radioGroupLabel(radios, modal) {
    const fs = radios[0].closest("fieldset");
    const legend = fs?.querySelector("legend")?.innerText;
    if (legend) return clean(legend);
    // nearest ancestor holding all radios; its text minus the option texts
    let c = radios[0].parentElement;
    while (c && !radios.every((r) => c.contains(r))) c = c.parentElement;
    let text = c?.innerText || "";
    for (const r of radios) text = text.replace(radioOptionText(r, modal), "");
    return clean(text).slice(0, 300);
  }

  const nativeSetter = (el) =>
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set ??
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;

  async function setText(el, value) {
    el.focus();
    nativeSetter(el).call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(900);
    // typeahead (city etc.): pick the first suggestion
    const opt = document.querySelector('[role="listbox"] [role="option"]');
    if (opt && opt.offsetParent !== null) {
      opt.click();
      await sleep(400);
    }
    el.blur();
  }

  function setSelect(el, optionText) {
    const opt = [...el.options].find((o) => clean(o.text) === clean(optionText));
    if (!opt) return false;
    nativeSetter(el).call(el, opt.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // ---- rule-based answers (no AI) ----

  function skillYears(label, a) {
    const L = label.toLowerCase();
    let best = null;
    for (const line of (a.skillYears || "").split("\n")) {
      const m = line.match(/^\s*(.+?)\s*[:=]\s*(\d+(?:\.\d+)?)\s*$/);
      if (!m) continue;
      const names = m[1].toLowerCase().split(/[\/,]| or /).map((s) => s.trim()).filter(Boolean);
      for (const n of names) if (L.includes(n) && (!best || n.length > best.len)) best = { len: n.length, years: m[2] };
    }
    return best ? String(Math.round(Number(best.years))) : null;
  }

  function pickOption(options, re) {
    return options.find((o) => re.test(o)) ?? null;
  }

  function ruleAnswer(label, kind, options, ctx) {
    const L = label.toLowerCase();
    const a = ctx.answers;
    const isChoice = kind === "select" || kind === "radio";
    if (/country code|phone country/.test(L)) return pickOption(options, /\(\+966\)/) ?? (isChoice ? null : a.phoneCountry);
    if (/phone|mobile|جوال|هاتف/.test(L) && !isChoice) return a.phoneNational || null;
    if (/first name/.test(L)) return ctx.cvName.split(" ")[0] || null;
    if (/last name|family name|surname/.test(L)) return ctx.cvName.split(" ").slice(1).join(" ") || null;
    if (/salary|compensation|راتب/.test(L) && a.expectedSalary > 0) {
      if (kind === "number" || /number|numeric|amount/.test(L)) return String(a.expectedSalary);
      if (!isChoice) return `${a.expectedSalary} ${a.salaryCurrency}`;
      return null;
    }
    if (/notice period|notice|فترة الإشعار/.test(L)) {
      if (kind === "number") return String(a.noticeDays);
      if (isChoice) return a.noticeDays === 0 ? pickOption(options, /immediate|^0|none|no notice|فوري/i) : null;
      return a.noticeDays === 0 ? "0" : String(a.noticeDays);
    }
    if (/(years|سنوات).*(experience|خبرة)|(experience|خبرة).*(years|سنوات)/.test(L) && !isChoice) {
      const y = skillYears(label, a);
      if (y !== null) return y;
      if (/total|overall|professional|work experience|relevant experience|إجمالي/.test(L) || !/with|in|using|of\s+\w/.test(L)) {
        return String(Math.round(a.totalYears));
      }
      return null; // a specific skill not in the list → AI decides (0 if not in the CV)
    }
    if (/\bcity\b|location|المدينة|مكان الإقامة/.test(L) && !isChoice) return a.city || null;
    if (/nationality|الجنسية/.test(L) && !isChoice) return a.nationality || null;
    const urls = ctx.links.filter((l) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+\/?\S*$/i.test(l.trim()));
    if (/linkedin/.test(L) && !isChoice) return urls.find((l) => /linkedin/i.test(l)) || null;
    if (/github/.test(L) && !isChoice) return urls.find((l) => /github/i.test(l)) || null;
    if (/portfolio|website/.test(L) && !isChoice) return urls.find((l) => !/linkedin|github/i.test(l)) || null;
    return null;
  }

  async function askAi(question, kind, options, ctx) {
    const numeric = /how many|number of|years|سنوات|كم/i.test(question) && (kind === "text" || kind === "number");
    const res = await chrome.runtime.sendMessage({ type: "answer", question, kind: numeric ? "number" : kind, options });
    return res?.answer ?? null;
  }

  async function answerFor(label, kind, options, ctx) {
    return ruleAnswer(label, kind, options, ctx) ?? (await askAi(label, kind, options, ctx));
  }

  // ---- resume upload ----

  async function uploadResume(modal, ctx) {
    const btn = [...modal.querySelectorAll("button")].find((b) => /^Upload resume$/i.test(b.innerText.trim()));
    if (!btn) return;
    const before = new Set(document.querySelectorAll('input[type="file"]'));
    btn.click(); // no user gesture → Chrome will not open the native picker
    const input = await waitFor(
      () => [...document.querySelectorAll('input[type="file"]')].find((f) => !before.has(f)) ||
        [...document.querySelectorAll('input[type="file"]')].pop(),
      5000,
    );
    if (!input) throw new Skip("تعذّر رفع السيرة (لم يظهر حقل الملف).");
    const bytes = Uint8Array.from(atob(ctx.pdfBase64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], ctx.fileName, { type: "application/pdf" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const stem = ctx.fileName.replace(/\.pdf$/i, "").slice(0, 18);
    const radio = await waitFor(() => {
      const m = findModal();
      return m && [...m.querySelectorAll('input[type="radio"]')].find((r) => radioOptionText(r, m).includes(stem));
    }, 25000, 500);
    if (!radio) throw new Skip("لم يظهر ملف السيرة المرفوع في النموذج.");
    if (!radio.checked) radio.click();
    ctx.uploaded = true;
    await jitter(800, 1500);
  }

  // ---- one step of the form ----

  function isResumeRadio(r, modal) {
    return /\.(pdf|docx?)\b/i.test(radioOptionText(r, modal));
  }

  async function fillStep(modal, ctx) {
    if (!ctx.uploaded && [...modal.querySelectorAll("button")].some((b) => /^Upload resume$/i.test(b.innerText.trim()))) {
      await uploadResume(modal, ctx);
      modal = findModal() || modal;
    }

    // selects
    for (const el of modal.querySelectorAll("select")) {
      const label = labelFor(el, modal);
      const options = [...el.options].map((o) => clean(o.text)).filter((t) => t && !/^select an option$/i.test(t));
      const current = clean(el.options[el.selectedIndex]?.text);
      const forced = /country code|phone country/i.test(label);
      if (!forced && el.value && current && !/^select an option$/i.test(current)) continue;
      if (/email/i.test(label) && el.value) continue;
      const ans = await answerFor(label, "select", options, ctx);
      if (ans && setSelect(el, ans)) { await jitter(300, 700); continue; }
      if (el.required || el.getAttribute("aria-required") === "true" || !el.value) throw new Skip(`سؤال بلا جواب: ${label}`);
    }

    // text-like inputs and textareas
    const textEls = [...modal.querySelectorAll("input, textarea")].filter((el) => {
      if (el.tagName === "TEXTAREA") return true;
      return ["text", "number", "tel", "email", "url", ""].includes(el.type) && el.offsetParent !== null;
    });
    for (const el of textEls) {
      const label = labelFor(el, modal);
      const kind = el.tagName === "TEXTAREA" ? "textarea" : el.type === "number" ? "number" : "text";
      const forced = /phone|mobile|جوال/i.test(label);
      if (el.value.trim() && !forced) continue;
      let ans;
      if (kind === "textarea" && /cover letter|رسالة/i.test(label)) ans = ctx.coverLetter;
      else ans = await answerFor(label, kind, [], ctx);
      if (ans !== null && ans !== undefined && String(ans).trim()) {
        await setText(el, ans);
        await jitter(300, 800);
        continue;
      }
      const required = el.required || el.getAttribute("aria-required") === "true" || /\*/.test(el.labels?.[0]?.innerText || "");
      if (required) throw new Skip(`سؤال بلا جواب: ${label}`);
    }

    // radio groups (resume list excluded)
    const groups = new Map();
    for (const r of modal.querySelectorAll('input[type="radio"]')) {
      if (isResumeRadio(r, modal)) continue;
      const key = r.name || r.closest("fieldset")?.id || "group";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const radios of groups.values()) {
      if (radios.some((r) => r.checked)) continue;
      const label = radioGroupLabel(radios, modal);
      const options = radios.map((r) => radioOptionText(r, modal));
      const ans = await answerFor(label, "radio", options, ctx);
      const idx = ans ? options.findIndex((o) => o.toLowerCase() === String(ans).toLowerCase()) : -1;
      if (idx < 0) throw new Skip(`سؤال بلا جواب: ${label}`);
      radios[idx].click();
      await jitter(300, 700);
    }

    // checkboxes: never follow the company; consent/other checkboxes via AI
    for (const cb of modal.querySelectorAll('input[type="checkbox"]')) {
      const label = labelFor(cb, modal);
      if (/follow/i.test(label)) {
        if (cb.checked) cb.click();
        continue;
      }
      if (cb.checked) continue;
      const required = cb.required || cb.getAttribute("aria-required") === "true";
      if (!required) continue;
      const ans = await answerFor(label, "checkbox", [], ctx);
      if (ans === "true") cb.click();
      else throw new Skip(`خانة إلزامية بلا جواب: ${label}`);
    }
  }

  async function discard() {
    const dismiss = document.querySelector('button[aria-label="Dismiss"]');
    dismiss?.click();
    const d = await waitFor(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Discard"), 4000);
    d?.click();
    await sleep(800);
  }

  async function apply(ctx) {
    const btn = document.querySelector('button[aria-label^="Easy Apply"]');
    if (!btn) return { status: "skipped", reason: "لا يوجد زر Easy Apply." };
    btn.click();
    let modal = await waitFor(findModal, 12000);
    if (!modal) return { status: "skipped", reason: "لم يفتح نموذج التقديم." };

    try {
      let stuck = 0;
      for (let step = 0; step < 15; step++) {
        modal = findModal();
        if (!modal) throw new Skip("أُغلق النموذج بشكل غير متوقع.");
        await fillStep(modal, ctx);

        const primary = primaryButton(modal);
        if (!primary) throw new Skip("لم أجد زر المتابعة.");
        const label = primary.innerText.trim();

        if (/^Submit application$/i.test(label)) {
          for (const cb of modal.querySelectorAll('input[type="checkbox"]')) {
            if (/follow/i.test(labelFor(cb, modal)) && cb.checked) cb.click();
          }
          if (ctx.dry) {
            await discard();
            return { status: "dry" };
          }
          await jitter(800, 1600);
          primary.click();
          const ok = await waitFor(
            () => /application was sent|application sent|application submitted|تم إرسال طلبك/i.test(document.body.innerText) || !findModal(),
            20000,
          );
          if (!ok) throw new Skip("لم يتأكد الإرسال.");
          await sleep(1200);
          const done = [...document.querySelectorAll("button")].find((b) => /^(Done|Dismiss)$/i.test(b.innerText.trim() || b.getAttribute("aria-label") || ""));
          done?.click();
          return { status: "submitted" };
        }

        const sig = modal.innerText.slice(0, 400);
        await jitter(700, 1400);
        primary.click();
        await sleep(1600);
        const after = findModal();
        const err = after && errorsIn(after);
        if (err) throw new Skip(`خطأ في النموذج: ${err}`);
        if (after && after.innerText.slice(0, 400) === sig) {
          if (++stuck >= 2) throw new Skip("النموذج لم يتقدم.");
        } else stuck = 0;
      }
      throw new Skip("النموذج طويل جداً.");
    } catch (e) {
      await discard();
      return { status: "skipped", reason: e instanceof Skip ? e.message : `خطأ: ${String(e?.message || e).slice(0, 200)}` };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg?.muq) return;
    const run = msg.cmd === "collect" ? collect() : msg.cmd === "jobInfo" ? jobInfo() : msg.cmd === "apply" ? apply({ ...msg, uploaded: false }) : null;
    if (!run) return;
    run.then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) }));
    return true;
  });
}
