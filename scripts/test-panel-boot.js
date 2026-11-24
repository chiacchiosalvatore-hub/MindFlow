/**
 * Test di AVVIO del pannello (v0.9.2) — la verifica architetturale chiave.
 *
 * Carica panel.html + adapters.js + engine-client.js + panel.js in jsdom:
 *
 *   A. MODALITÀ ESTENSIONE (chrome finto, service worker MORTO: sendMessage
 *      non risponde mai): il pannello deve comunque
 *        - verificare il motore in fetch DIRETTO (fetch finto verso Ollama),
 *        - auto-correggere "gemma3" -> "gemma3:latest" e salvarlo,
 *        - mostrare l'etichetta verde "Ollama · gemma3:latest",
 *        - NON mostrare alcun banner «ricarica la pagina»
 *          (il vecchio ping-3-volte lo avrebbe mostrato col worker morto);
 *   B. MODALITÀ DEMO (senza chrome): il pannello parte con la conversazione
 *      dimostrativa e nessun errore.
 *
 * È la dimostrazione che il percorso principale non dipende più dal service
 * worker: era il difetto segnalato («aggiorna per riattivare pannello» che
 * tornava pure dopo il ricaricamento).
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/tmp/node_modules/jsdom");

const SRC = path.join(__dirname, "../mindflow-extension");
let pass = 0;
let fail = 0;
function assert(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (detail ? " — " + detail : ""));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function read(f) {
  return fs.readFileSync(path.join(SRC, f), "utf8");
}

/** Costruisce il DOM del pannello con gli script caricati in ordine. */
function buildPanelDom({ chromeStub, fetchStub, url }) {
  const html = read("panel.html");
  const dom = new JSDOM(html, {
    // La demo reale gira su http(s): localStorage esiste. In estensione il
    // pannello vive su chrome-extension:// ma usa chrome.storage, non localStorage.
    url: url || "chrome-extension://test/panel.html",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const w = dom.window;
  if (fetchStub) w.fetch = fetchStub;
  if (chromeStub) w.chrome = chromeStub;
  // Ordine di caricamento IDENTICO a panel.html: adapters, engine-client, panel.
  w.eval(read("adapters.js"));
  w.eval(read("engine-client.js"));
  w.eval(read("panel.js"));
  return w;
}

async function main() {
  // ---------------------------------------------------------------------------
  // A. Modalità ESTENSIONE: worker morto, fetch diretto vivo
  // ---------------------------------------------------------------------------
  const storedSettings = {
    engine: { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "gemma3" },
    autoCheckpoint: { enabled: true, assistantThreshold: 4 },
    panel: { widthMode: "narrow", autoOpen: true },
  };
  const storageWrites = [];
  let swMessages = 0;
  const chromeStub = {
    runtime: {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      // Service worker IRRAGGIUNGIUNGIBILE: non risponde mai. Il pannello
      // NON deve accorgersene (il suo percorso è diretto).
      sendMessage: (_msg, cb) => {
        swMessages++;
        if (cb) setTimeout(() => cb(undefined), 0);
      },
    },
    storage: {
      local: {
        get: (keys, cb) =>
          setTimeout(
            () =>
              cb({
                "mf.settings": JSON.parse(JSON.stringify(storedSettings)),
                "mf.sessions": {},
              }),
            0
          ),
        set: (obj, cb) => {
          storageWrites.push(obj);
          if (cb) setTimeout(cb, 0);
        },
      },
      onChanged: { addListener: () => {} },
    },
  };
  const fetchStub = (url, opts) => {
    // "Ollama" finto, in fetch diretto dal pannello.
    if (String(url).endsWith("/api/tags")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: "gemma3:latest" }] }),
      });
    }
    if (String(url).endsWith("/api/chat")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            content: JSON.stringify({
              title: "Dashboard spese",
              summary: "Tre pilastri: modello dati, caricamento CSV, vista aggregata.",
              keyDecisions: ["La UI resta separata dalla logica"],
            }),
          },
        }),
      });
    }
    return Promise.reject(new TypeError("fetch failed"));
  };

  const w = buildPanelDom({ chromeStub, fetchStub });
  await sleep(1800); // avvio + verifica motore (600 ms) + fetch

  const label = w.document.getElementById("mf-engine-label");
  const dot = w.document.getElementById("mf-engine-dot");
  assert(
    "A1. etichetta motore VERDE con modello vero letto dal motore (fetch diretto)",
    label.textContent === "Ollama · gemma3:latest" && label.classList.contains("mf-ok"),
    "testo=" + JSON.stringify(label.textContent) + " classi=" + label.className
  );
  assert(
    "A2. modello auto-corretto e SALVATO nelle impostazioni",
    storageWrites.some((o) => o && o["mf.settings"] && o["mf.settings"].engine && o["mf.settings"].engine.model === "gemma3:latest"),
    JSON.stringify(storageWrites.map((o) => o && o["mf.settings"] && o["mf.settings"].engine && o["mf.settings"].engine.model))
  );
  assert(
    "A3. NESSUN banner «ricarica la pagina» (il vecchio ping-3-volte lo avrebbe mostrato)",
    !w.document.querySelector(".mf-reload-banner")
  );
  assert(
    "A4. il service worker NON è stato tempestato (il percorso è diretto)",
    swMessages <= 1,
    "messaggi al worker=" + swMessages
  );
  assert(
    "A5. nessuna eccezione: client motore e pannello caricati insieme",
    !!w.MindFlowEngineClient && typeof w.MindFlowEngineClient.summarize === "function"
  );

  // ---------------------------------------------------------------------------
  // B. Modalità DEMO (nessun chrome): avvio pulito con conversazione fittizia
  // ---------------------------------------------------------------------------
  const w2 = buildPanelDom({ url: "http://localhost/panel.html" });
  await sleep(900);
  assert(
    "B1. demo: titolo sessione della conversazione fittizia",
    w2.document.getElementById("mf-session-title").textContent.indexOf("Dashboard spese") !== -1,
    w2.document.getElementById("mf-session-title").textContent
  );
  assert(
    "B2. demo: badge DEMO visivo",
    !w2.document.getElementById("mf-mode-badge").classList.contains("mf-hidden")
  );
  assert(
    "B3. demo: NESSUN banner di ricaricamento",
    !w2.document.querySelector(".mf-reload-banner")
  );

  console.log("\nRisultato: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("ERRORE:", e);
  process.exit(1);
});
