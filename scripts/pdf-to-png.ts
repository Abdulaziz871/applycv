/**
 * Rasterises PDFs with pdf.js inside headless Chrome so shaping / RTL order can be
 * checked by eye:  npx tsx scripts/pdf-to-png.ts tests/output/cv-ar.pdf [...]
 * Writes <name>-p1.png next to each PDF.
 */
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const pdfjsDir = path.join(process.cwd(), "node_modules", "pdfjs-dist", "build");

async function main() {
  const files = process.argv.slice(2);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? "/");
    if (url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><body style="margin:0;background:#888"><canvas id="c"></canvas>
<script type="module">
import * as pdfjs from "/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
window.renderPdf = async (u, pageNo) => {
  const doc = await pdfjs.getDocument({ url: u }).promise;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1.6 });
  const c = document.getElementById("c");
  c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp, canvas: c }).promise;
  return { pages: doc.numPages, w: vp.width, h: vp.height };
};
window.ready = true;
</script></body>`);
    } else if (url === "/pdf.mjs" || url === "/pdf.worker.mjs") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(readFileSync(path.join(pdfjsDir, url)));
    } else if (url.startsWith("/file/")) {
      res.setHeader("Content-Type", "application/pdf");
      res.end(readFileSync(path.resolve(url.slice(6))));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction("window.ready === true");
    for (const f of files) {
      const info = (await page.evaluate(
        `window.renderPdf("/file/${encodeURIComponent(f)}", 1)`,
      )) as { pages: number; w: number; h: number };
      await page.setViewport({ width: Math.ceil(info.w), height: Math.ceil(info.h) });
      const canvas = await page.$("#c");
      const png = await canvas!.screenshot({ type: "png" });
      const outFile = f.replace(/\.pdf$/, "-p1.png");
      writeFileSync(outFile, png);
      console.log(`${f}: ${info.pages} page(s) → ${outFile}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}
void main();
