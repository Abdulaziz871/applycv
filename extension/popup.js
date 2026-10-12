const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const fmt = (t) => new Date(t).toLocaleString("ar-SA-u-nu-latn", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const STATUS_AR = { submitted: "قُدّم", dry: "تجربة", skipped: "تُخطّي", failed: "فشل" };

async function refresh() {
  const s = await send({ type: "status" });
  if (s.siteOrigin && document.activeElement !== $("site")) $("site").value = s.siteOrigin;
  const lines = [];
  if (s.siteOrigin && !s.sitePermission) lines.push("⚠️ لم يُمنح الإذن للموقع بعد: اضغط «حفظ ومنح الإذن» ووافق.");
  if (s.siteOrigin && s.sitePermission) lines.push("🔗 الموقع: " + s.siteOrigin + " (حدّث صفحة الموقع بعد أي تغيير)");
  lines.push(s.configured ? "✅ مربوطة بالموقع" : "⚠️ غير مربوطة بالموقع بعد");
  lines.push(s.enabled ? `الجدولة: مفعّلة (${s.submitMode === "auto" ? "إرسال تلقائي" : "وضع تجربة"})` : "الجدولة: متوقفة");
  lines.push(`اليوم: ${s.todayCount} / ${s.maxPerDay}`);
  if (s.running) lines.push("⏳ يعمل الآن…");
  if (s.nextRuns.length) lines.push(`التشغيل القادم: ${fmt(s.nextRuns[0])}`);
  if (s.lastRun) lines.push(`آخر تشغيل: ${fmt(s.lastRun.at)} — قُدّم ${s.lastRun.submitted}، تُخطّي ${s.lastRun.skipped}${s.lastRun.note ? " — " + s.lastRun.note : ""}`);
  $("status").innerHTML = lines.map((l) => `<div>${l.replace(/</g, "&lt;")}</div>`).join("");

  const { log } = await send({ type: "log" });
  $("log").innerHTML = log.slice(0, 25).map((e) => {
    const what = [e.title, e.company].filter(Boolean).join(" — ");
    return `<li><b>${STATUS_AR[e.status] || e.status}</b> ${what.replace(/</g, "&lt;")}${e.reason ? `<div class="muted">${e.reason.replace(/</g, "&lt;")}</div>` : ""}</li>`;
  }).join("") || '<li class="muted">لا شيء بعد</li>';
}

$("saveSite").onclick = async () => {
  let url;
  try {
    url = new URL($("site").value.trim());
  } catch {
    alert("رابط غير صالح");
    return;
  }
  const pattern = `${url.protocol}//${url.hostname}/*`;
  // Save first: Chrome may close this popup while the permission dialog is open.
  // The background registers the site bridge as soon as the permission is granted.
  await send({ type: "setSite", origin: url.origin });
  await chrome.permissions.request({ origins: [pattern] });
  refresh();
};
$("dry").onclick = async () => { await send({ type: "runNow", dry: true }); refresh(); };
$("run").onclick = async () => { await send({ type: "runNow", dry: false }); refresh(); };

refresh();
setInterval(refresh, 4000);
