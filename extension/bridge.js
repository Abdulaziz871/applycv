// Muqaddim — relays messages between the Muqaddim site page and the extension.
// Registered only for the site origin chosen in the popup; the background
// worker re-checks the sender origin on every message.
(() => {
  if (window.__muqBridge) return;
  window.__muqBridge = true;

  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.muq !== "page" || typeof m.id !== "string") return;
    let data;
    try {
      data = await chrome.runtime.sendMessage({ from: "bridge", type: m.type, payload: m.payload });
    } catch (err) {
      data = { error: String(err?.message || err) };
    }
    window.postMessage({ muq: "ext", id: m.id, data }, location.origin);
  });

  const hello = () => window.postMessage({ muq: "ext", type: "hello", version: chrome.runtime.getManifest().version }, location.origin);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hello);
  else hello();
})();
