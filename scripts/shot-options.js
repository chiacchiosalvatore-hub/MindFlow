/** Screenshot di controllo della pagina impostazioni con la guida
 *  «Sblocca Ollama» resa visibile (come farebbe revealUnlock() su 403). */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const src = path.join(__dirname, "..", "mindflow-extension", "options.html");
  let html = fs.readFileSync(src, "utf8");
  // Simula il revealUnlock(): la sezione appare come dopo un 403.
  html = html.replace('id="mf-unlock"', 'id="mf-unlock" data-shot="1"');
  html = html.replace(/class="card mf-hidden" id="mf-unlock"/, 'class="card" id="mf-unlock"');
  html = html.replace(/<section class="card" id="mf-unlock">/, '<section class="card" id="mf-unlock" style="border-color:#fbbf2466">');
  const tmp = "/tmp/mf-options-check.html";
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
  await page.goto("file://" + tmp);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/render/mf-options-top.png", clip: { x: 0, y: 0, width: 760, height: 620 } });
  const card = await page.$("#mf-unlock");
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: "/tmp/render/mf-options-unlock.png", clip: { x: 0, y: 0, width: 760, height: 900 } });
  await browser.close();
  console.log("screenshot ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
