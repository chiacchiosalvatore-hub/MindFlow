/**
 * Test END-TO-END della pipeline unica v1.0.0 nel PANNELLO REALE (jsdom).
 *
 * Carica panel.html + adapters.js + engine-client.js + panel.js con chrome.*
 * finto e un "Ollama" finto in fetch diretto, poi simula l'import da testo
 * incollato (pulsante «Crea il grafo»): deve partire la pipeline unica
 *   verifica motore -> MAPPA dei capitoli -> compressione per capitolo,
 * con nodi dotati di capitolo (chapterIndex/chapterFrom/chapterTo), grafo
 * disegnato con i chip dei capitoli, dialog chiuso all'esito e contesto
 * compilato che contiene la catena [CP 1..N].
 *
 * Il motore finto distingue le chiamate dal BODY: num_ctx=16384 -> planner
 * (mappa dei capitoli); altrimenti -> summarizer (memory node).
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

const MAP_JSON = JSON.stringify({
  chapters: [
    { title: "Impostazione del progetto", from: 1, to: 3 },
    { title: "Normalizzazione dei dati", from: 4, to: 6 },
    { title: "Budget e report", from: 7, to: 9 },
  ],
});

let plannerCalls = 0;
let summarizeCalls = 0;

const fetchStub = (url, opts) => {
  const u = String(url);
  if (u.endsWith("/api/tags")) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: "gemma3:latest" }] }),
    });
  }
  if (u.endsWith("/api/chat")) {
    let body = {};
    try {
      body = JSON.parse((opts && opts.body) || "{}");
    } catch (_e) {
      body = {};
    }
    const isProbe = body.model === "mindflow-sonda-collegamento";
    // v1.1.2: il planner si riconosce dal PROMPT (num_ctx ora è adattivo).
    const isPlanner =
      Array.isArray(body.messages) &&
      body.messages.some((m) => String(m.content || "").includes("pianificatore dei capitoli"));
    const content = isProbe
      ? JSON.stringify({ message: { content: "pong" } })
      : isPlanner
        ? (plannerCalls++, MAP_JSON)
        : (summarizeCalls++, JSON.stringify({
            title: "Tema " + summarizeCalls,
            summary: "Sommario del capitolo " + summarizeCalls + " con dettagli tecnici conservati.",
            keyDecisions: ["Decisione " + summarizeCalls],
          }));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ message: { content } }),
    });
  }
  return Promise.reject(new TypeError("fetch failed"));
};

const storageData = {
  "mf.settings": {
    engine: { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "gemma3:latest" },
    panel: { widthMode: "narrow" },
  },
  "mf.sessions": {},
};

const chromeStub = {
  runtime: {
    id: "bbbbccccdddd1111eeee",
    sendMessage: (_msg, cb) => {
      if (cb) setTimeout(() => cb(undefined), 0);
    },
  },
  storage: {
    local: {
      get: (keys, cb) => setTimeout(() => cb(JSON.parse(JSON.stringify(storageData))), 0),
      set: (_obj, cb) => {
        if (cb) setTimeout(cb, 0);
      },
    },
    onChanged: { addListener: () => {} },
  },
};

async function main() {
  const html = read("panel.html");
  const dom = new JSDOM(html, {
    url: "chrome-extension://test/panel.html",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.fetch = fetchStub;
  w.chrome = chromeStub;
  w.eval(read("adapters.js"));
  w.eval(read("engine-client.js"));
  w.eval(read("panel.js"));
  await sleep(1200); // avvio + verifica motore

  assert("F0. pannello avviato in modalità estensione (motore verificato)", w.document.getElementById("mf-engine-label").classList.contains("mf-ok"), w.document.getElementById("mf-engine-label").textContent);

  // Testo incollato: 9 turni con etichette italiane riconosciute dal parser.
  const turns = [
    "Utente: Ciao, voglio costruire una dashboard delle spese in Python.",
    "Assistente: Parti da un modello dati minimale e dal caricamento CSV con pandas.",
    "Utente: Come normalizzo le date del CSV?",
    "Assistente: Usa pd.to_datetime con dayfirst=True e crea la colonna mese.",
    "Utente: Ora voglio stimare il budget del prossimo trimestre.",
    "Assistente: Applica una media mobile trimestrale e correggi con le spese fisse.",
    "Utente: Come separo le categorie fisse dalle variabili?",
    "Assistente: Una lista FISSE e una colonna derivata con apply: due tabelle.",
    "Utente: Perfetto, grazie!",
  ];
  w.document.getElementById("mf-i-text").value = turns.join("\n\n");
  w.document.getElementById("mf-i-run").click();

  // La pipeline gira: planner + 3 summarizer (nessuna sleep nel percorso felice).
  await sleep(2500);

  const status = w.document.getElementById("mf-status").textContent;
  assert(
    "F1. esito finale: «Grafo pronto: 3 capitoli da 9 messaggi · mappa del motore»",
    /Grafo pronto: 3 capitoli da 9 messaggi · mappa del motore/.test(status),
    status
  );
  assert(
    "F2. planner chiamato UNA volta, summarizer UNA per capitolo",
    plannerCalls === 1 && summarizeCalls === 3,
    "planner=" + plannerCalls + " summarizer=" + summarizeCalls
  );

  // Stato della sessione: i nodi hanno i campi capitolo — già dimostrato dal
  // grafico (chip F4 e intervalli F5 esistono SOLO con chapterIndex).
  const nodes = w.document.querySelectorAll("#mf-graph .mf-node");
  assert("F3. grafo disegnato: radice + 3 capitoli", nodes.length === 4, "nodi=" + nodes.length);
  const chips = w.document.querySelectorAll("#mf-graph .mf-n-chip");
  assert("F4. chip del capitolo su tutti i checkpoint", chips.length === 3, "chip=" + chips.length);
  const subs = [].slice.call(w.document.querySelectorAll("#mf-graph .mf-n-sub")).map((t) => t.textContent);
  assert(
    "F5. sottotitoli con intervallo messaggi (msg 1–3, 4–6, 7–9)",
    subs.some((s) => /msg 1–3/.test(s)) && subs.some((s) => /msg 4–6/.test(s)) && subs.some((s) => /msg 7–9/.test(s)),
    JSON.stringify(subs)
  );
  assert(
    "F6. dialog import chiuso all'esito",
    w.document.getElementById("mf-import").classList.contains("mf-hidden")
  );

  // Contesto compilato: catena [CP 1..3] con i titoli del motore.
  w.document.getElementById("mf-btn-compile").click();
  const payload = w.document.getElementById("mf-payload").textContent;
  assert(
    "F7. contesto compilato: catena [CP 1..3] con i titoli del motore",
    payload.indexOf("[CP 1] Tema 1") !== -1 && payload.indexOf("[CP 3] Tema 3") !== -1,
    payload.slice(0, 220)
  );

  // Stato salvato: i chip ESISTONO solo se i nodi hanno chapterIndex — già
  // verificato sopra dal grafico.
  assert(
    "F8. pulsante unico ora dice «Aggiorna grafo» (grafo esistente)",
    w.document.querySelector("#mf-btn-checkpoint span").textContent === "Aggiorna grafo",
    w.document.querySelector("#mf-btn-checkpoint span").textContent
  );

  console.log("\nRisultato: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("ERRORE:", e);
  process.exit(1);
});
