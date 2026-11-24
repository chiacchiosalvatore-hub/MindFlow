/**
 * Screenshot del pannello MindFlow in modalità demo con grafo costruito.
 * Produce:
 *   /tmp/render/mf-graph-empty.png   -> stato vuoto (pulsante «Costruisci il grafo»)
 *   /tmp/render/mf-graph-boom.png    -> grafo costruito (chip capitolo, archi animati)
 *
 * Serve a check-graph-visuals.js e alla verifica visiva manuale delle migliorie.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  fs.mkdirSync("/tmp/render", { recursive: true });
  const SRC = path.join(__dirname, "..", "mindflow-extension");
  let html = fs.readFileSync(path.join(SRC, "panel.html"), "utf8");
  html = html.replace(/<head>/i, '<head><base href="file://' + SRC + '/">');
  const tmp = "/tmp/mf-panel-check.html";
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 860 } });

  // Stato demo pre-caricato: la conversazione fittizia del pannello, senza
  // checkpoint (così si vede lo stato vuoto con il pulsante unico).
  await page.addInitScript(() => {
    localStorage.setItem(
      "mf.demo.state",
      JSON.stringify({
        "mf.settings": { engine: { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "gemma3" }, panel: {} },
        "mf.sessions": {},
      })
    );
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/ERR_CONNECTION_REFUSED|Failed to load resource/i.test(m.text())) {
      errors.push("console: " + m.text());
    }
  });

  await page.goto("file://" + tmp);
  await page.waitForTimeout(900);

  // Il corpo del pannello vive nell'iframe? No: panel.html è la pagina stessa
  // in demo. Screenshot dell'intera finestra ritagliata sul pannello (colonna
  // destra: simuliamo il companion accanto alla chat con un riempimento).
  await page.evaluate(() => {
    document.documentElement.style.background = "#0a0e0d";
  });
  await page.screenshot({ path: "/tmp/render/mf-graph-empty.png", fullPage: false });

  // Costruzione del grafo in demo: clic sul pulsante unico dello stato vuoto.
  const buildBtn = page.locator("#mf-empty-build");
  if (await buildBtn.isVisible()) {
    await buildBtn.click();
    // La demo comprime un capitolo ogni ~340ms + 700ms iniziali: si aspetta
    // abbastanza per la catena completa.
    await page.waitForTimeout(4200);
  }
  await page.screenshot({ path: "/tmp/render/mf-graph-boom.png", fullPage: false });

  // Dettagli: clic sul primo checkpoint per il pannello dettagli con chip.
  // force: true — gli archi animati rendono il nodo "instabile" per playwright.
  const node = page.locator("#mf-graph .mf-node").nth(1);
  if (await node.count()) {
    await node.click({ force: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/render/mf-graph-details.png", fullPage: false });
  }

  await browser.close();
  if (errors.length) {
    console.log("ERRORI JS:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("screenshot ok: mf-graph-empty.png, mf-graph-boom.png" + (fs.existsSync("/tmp/render/mf-graph-details.png") ? ", mf-graph-details.png" : ""));
})().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
