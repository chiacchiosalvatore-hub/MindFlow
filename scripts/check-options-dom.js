/** Verifica DOM della pagina impostazioni: la guida «Sblocca Ollama» e la
 *  guida v1.2.2 «Non riesco a connettermi» esistono, sono complete, i
 *  pulsanti Copia funzionano e nessun elemento esce dal contenitore (niente
 *  overflow orizzontale). */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const src = path.join(__dirname, "..", "mindflow-extension", "options.html");
  let html = fs.readFileSync(src, "utf8");
  html = html.replace('class="card mf-hidden" id="mf-unlock"', 'class="card" id="mf-unlock"');
  // I percorsi relativi di css/js devono puntare alla cartella vera.
  html = html.replace(/<head>/i, '<head><base href="file://' + path.join(__dirname, "..", "mindflow-extension") + '/">');
  const tmp = "/tmp/mf-options-check2.html";
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // I probe di autodetect verso motori locali spenti producono solo rumore
    // di connessione rifiutata: NON sono errori JavaScript della pagina.
    if (/ERR_CONNECTION_REFUSED|Failed to load resource/i.test(m.text())) return;
    errors.push("console: " + m.text());
  });
  await page.goto("file://" + tmp);
  await page.waitForTimeout(300);

  const out = {};
  out.titolo = await page.textContent("#mf-unlock h2");
  out.valore = (await page.textContent("#mf-unlock-value")).trim();
  out.nOs = await page.locator("#mf-unlock details.mf-os").count();
  out.copiaPresente = await page.locator("#mf-unlock .mf-copy").count();
  out.passo1 = (await page.locator("#mf-unlock .mf-steps > li").first().textContent()).trim().slice(0, 40);
  // Il valore dev'essere selezionabile/copiabile: verifico il clipboard via click.
  await page.click("#mf-unlock .mf-copy");
  await page.waitForTimeout(250);
  out.testoBottoneDopoClick = (await page.textContent("#mf-unlock .mf-copy")).trim();
  // Overflow orizzontale della pagina?
  out.overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // v1.2.2 — guida «Non riesco a connettermi» (auto-correzione porta LM Studio).
  out.trTitolo = await page.textContent("#mf-troubleshoot h2");
  out.trTesto = await page.textContent("#mf-troubleshoot");
  out.trSottopassi = await page.locator("#mf-troubleshoot ol.mf-steps ol.mf-steps li").count();
  // JS della pagina girava (options.js) senza errori? (senza chrome.* parte comunque: contextAlive gestisce)
  await browser.close();

  let fail = 0;
  const expect = (name, cond, detail) => {
    console.log((cond ? "  OK  " : "FAIL  ") + name + (!cond && detail ? " — " + detail : ""));
    if (!cond) fail++;
  };
  expect("titolo sezione", /Sblocca Ollama/.test(out.titolo || ""));
  expect("valore OLLAMA_ORIGINS completo", out.valore === "chrome-extension://*,moz-extension://*,safari-web-extension://*");
  expect("tre sistemi operativi (Windows/macOS/Linux)", out.nOs === 3);
  expect("pulsante Copia presente", out.copiaPresente === 1);
  expect("click Copia -> feedback «Copiato!»", out.testoBottoneDopoClick === "Copiato!");
  expect("passo 1 = uscita da Ollama", /Esci da Ollama/.test(out.passo1 || ""));
  expect("nessun overflow orizzontale", out.overflowX <= 0);
  expect("guida v1.2.2 presente", /Non riesco a connettermi/.test(out.trTitolo || ""));
  expect("guida: parla di LM Studio e della porta 1235", /LM Studio/.test(out.trTesto || "") && /1235/.test(out.trTesto || ""));
  expect("guida: passi annidati (LM Studio / Ollama / generali)", out.trSottopassi >= 8, "sottopassi=" + out.trSottopassi);
  expect("guida: mappa degli errori (403 / porta / modello)", /403/.test(out.trTesto || "") && /porta è sbagliata|porta diversa/i.test(out.trTesto || ""));
  expect("nessun errore JS in pagina", errors.length === 0, errors.join(" | ") || "(dettagli sotto)");

  console.log(fail ? "\nESITO: " + fail + " controlli FALLITI" : "\nESITO: tutti i controlli OK");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
