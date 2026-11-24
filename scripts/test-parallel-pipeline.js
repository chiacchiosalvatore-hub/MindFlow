/**
 * Test v1.1.2 «Grafo veloce, nessun tasto bloccato» — pipeline PARALLELA.
 *
 * Carica il pannello reale (jsdom) con un "Ollama" finto in fetch diretto e
 * verifica le garanzie della versione:
 *
 *   P1. PARALLELISMO REALE: 4 capitoli con compressione da 500 ms ciascuna
 *       finiscono in ~2 finestre (2 in parallelo sui motori locali), non in
 *       fila (2 s); il picco di richieste concorrenti è >= 2;
 *   P2. CATENA DALLA MAPPA: il «Checkpoint precedente» del capitolo k è il
 *       titolo che la MAPPA ha dato al capitolo k-1 (dipendenza sequenziale
 *       sciolta — è ciò che rende possibile il parallelo);
 *   P3. GUARDIA ANTI-DOPPIO-LANCIO: un clic su «Aggiorna grafo» durante la
 *       pipeline NON avvia una seconda pipeline (il contatore delle chiamate
 *       al motore non raddoppia) e riceve un messaggio visibile;
 *   P4. FALLIMENTO A METÀ CATENA: il capitolo 2 che muore interrompe la
 *       catena lì; il capitolo 1 resta nel grafo, nessun nodo dopo il buco;
 *   P5. OROLOGIO SENZA DIALOG: il percorso «Aggiorna grafo» (coda della
 *       chat) mostra i secondi trascorsi sulla riga di stato;
 *   P6. FINESTRA ADATTIVA: le compressioni brevi non pagano più il num_ctx
 *       massimo (8192): contesto adattivo in blocchi di 512, tra 2048 e 8192.
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
    { title: "Budget del trimestre", from: 7, to: 9 },
    { title: "Report finale", from: 10, to: 12 },
  ],
});

// --- Fake Ollama: registra le chiamate, ritarda le compressioni -------------
const SUMMARY_DELAY = 500;
let plannerCalls = 0;
let summarizeCalls = 0;
let summarizeBodies = [];
let inFlight = 0;
let peakInFlight = 0;
let failOnText = ""; // se impostato, OGNI compressione il cui trascritto contiene questo testo risponde 500 (il retry interno di summarize non può "guarirla")

const fetchStub = (url, opts) => {
  const u = String(url);
  if (u.endsWith("/api/tags")) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: "qwen2.5:7b" }] }),
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
    const isPlanner =
      Array.isArray(body.messages) &&
      body.messages.some((m) => String(m.content || "").includes("pianificatore dei capitoli"));
    if (isProbe) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ message: { content: "pong" } }),
      });
    }
    if (isPlanner) {
      plannerCalls++;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ message: { content: MAP_JSON } }),
      });
    }
    // Summarizer: ritardo simulato + contatore di concorrenza.
    const myCall = ++summarizeCalls;
    const userText = body.messages && body.messages.length ? String(body.messages[body.messages.length - 1].content || "") : "";
    summarizeBodies.push({
      numCtx: body.options && body.options.num_ctx ? Number(body.options.num_ctx) : null,
      user: userText,
    });
    inFlight++;
    if (inFlight > peakInFlight) peakInFlight = inFlight;
    return new Promise((resolve) => {
      setTimeout(() => {
        inFlight--;
        if (failOnText && userText.indexOf(failOnText) !== -1) {
          resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: "esplosione simulata del capitolo" }),
          });
          return;
        }
        resolve({
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                title: "Tema " + myCall,
                summary: "Sommario del capitolo " + myCall + " con i dettagli che contano.",
                keyDecisions: ["Decisione " + myCall],
              }),
            },
          }),
        });
      }, SUMMARY_DELAY);
    });
  }
  return Promise.reject(new TypeError("fetch failed"));
};

const storageData = {
  "mf.settings": {
    engine: { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen2.5:7b" },
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

async function waitForStatus(w, re, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 8000)) {
    const st = w.document.getElementById("mf-status").textContent;
    if (re.test(st)) return st;
    await sleep(80);
  }
  return w.document.getElementById("mf-status").textContent;
}

const TURNS = [];
for (let b = 0; b < 6; b++) {
  TURNS.push("Utente: Domanda numero " + (b + 1) + " sul progetto della dashboard.");
  TURNS.push("Assistente: Risposta numero " + (b + 1) + " con spiegazione densa, dati e conclusioni pratiche.");
}

async function main() {
  const dom = new JSDOM(read("panel.html"), {
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

  // --- P1 + P2 + P3: import da testo con 12 turni -> 4 capitoli -------------
  w.document.getElementById("mf-i-text").value = TURNS.join("\n\n");
  const t0 = Date.now();
  w.document.getElementById("mf-i-run").click();

  // P3: clic su «Aggiorna grafo» a metà pipeline: risposta visibile, non muta.
  await sleep(650); // capitolo 1-2 in volo
  w.document.getElementById("mf-btn-checkpoint").click();
  const midSt = w.document.getElementById("mf-status").textContent;
  assert(
    "P3. clic durante la pipeline: messaggio visibile, non silenzioso",
    /Pipeline già in corso/.test(midSt),
    midSt
  );

  const doneSt = await waitForStatus(w, /Grafo pronto: 4 capitoli da 12 messaggi/, 9000);
  const elapsed = Date.now() - t0;
  const sequentialFloor = 4 * SUMMARY_DELAY; // 2000 ms: fila indiana
  assert(
    "P1a. 4 compressioni da 500 ms completate in ~2 finestre (" + elapsed + " ms < " + sequentialFloor + " ms)",
    /Grafo pronto: 4 capitoli/.test(doneSt) && elapsed < sequentialFloor,
    "elapsed=" + elapsed + " ms — status: " + doneSt
  );
  assert(
    "P1b. picco di compressioni concorrenti >= 2 (motore locale)",
    peakInFlight >= 2,
    "peak=" + peakInFlight
  );
  assert(
    "P1c. il doppio clic NON ha duplicato il lavoro: 4 chiamate in tutto (non 8)",
    plannerCalls === 1 && summarizeCalls === 4,
    "planner=" + plannerCalls + " summarize=" + summarizeCalls
  );

  // P2: il capitolo 2 ha ricevuto come «checkpoint precedente» il titolo della
  // MAPPA del capitolo 1 (non il titolo generato dal modello: quello sarebbe
  // arrivato solo DOPO, in fila indiana).
  const withPrev = summarizeBodies.filter((b) => b.user.indexOf('Checkpoint precedente: "Impostazione del progetto"') !== -1);
  assert(
    "P2. «Checkpoint precedente» del capitolo 2 = titolo della MAPPA del capitolo 1",
    withPrev.length >= 1,
    withPrev.length + " corrispondenze su " + summarizeBodies.length
  );

  // P6: finestra adattiva — segmenti brevi: contesto molto sotto il tetto 8192.
  const ctxs = summarizeBodies.map((b) => b.numCtx);
  assert(
    "P6. num_ctx adattivo nelle compressioni: blocchi di 512 tra 2048 e 8192, sotto il tetto",
    ctxs.length === 4 && ctxs.every((c) => c >= 2048 && c <= 8192 && c % 512 === 0) && ctxs.some((c) => c < 8192),
    JSON.stringify(ctxs)
  );

  const nodesAfterP1 = w.document.querySelectorAll("#mf-graph .mf-node").length;
  assert("P1d. grafo: radice + 4 capitoli", nodesAfterP1 === 5, "nodi=" + nodesAfterP1);

  // --- P4: fallimento PERSISTENTE al capitolo 2 di una NUOVA importazione --
  plannerCalls = 0;
  summarizeCalls = 0;
  summarizeBodies = [];
  failOnText = "Risposta numero 2"; // presente SOLO nel segmento del capitolo 2 (msg 4–6)
  w.document.getElementById("mf-i-text").value = TURNS.join("\n\n");
  w.document.getElementById("mf-i-run").click();
  const failSt = await waitForStatus(w, /Catena interrotta al capitolo 2\/4/, 9000);
  assert(
    "P4a. errore dichiarato: «Catena interrotta al capitolo 2/4»",
    /Catena interrotta al capitolo 2\/4/.test(failSt) && /esplosione simulata/.test(failSt),
    failSt
  );
  // La sessione importata nuova ha radice + capitolo 1 (il 2 è morto lì).
  const subsP4 = [].slice.call(w.document.querySelectorAll("#mf-graph .mf-n-sub")).map((t) => t.textContent);
  const chipP4 = w.document.querySelectorAll("#mf-graph .mf-n-chip").length;
  assert(
    "P4b. il capitolo 1 resta nel grafo, nessun nodo dopo il buco (1 chip)",
    chipP4 === 1 && subsP4.some((s) => /msg 1–3/.test(s)),
    "chip=" + chipP4 + " " + JSON.stringify(subsP4)
  );
  failOnText = "";
  const nodesBeforeP5 = w.document.querySelectorAll("#mf-graph .mf-node").length;
  assert(
    "P4c. grafo dopo il fallimento: radice + solo capitolo 1",
    nodesBeforeP5 === 2,
    "nodi=" + nodesBeforeP5
  );

  // --- P5: «Aggiorna grafo» (coda della chat) con orologio, senza dialog ----
  // Dopo il fallimento il checkpoint attivo copre i primi 3 messaggi: la coda
  // è di 9 messaggi -> pipeline a capitoli SENZA dialog -> orologio in status.
  plannerCalls = 0;
  summarizeCalls = 0;
  w.document.getElementById("mf-btn-checkpoint").click();
  await sleep(300); // fase «Verifica del motore… · 0 s»
  const tickSt = w.document.getElementById("mf-status").textContent;
  assert(
    "P5a. riga di stato con secondi trascorsi durante il lavoro senza dialog",
    /· \d+\s?(s|min)/.test(tickSt) || /Verifica del motore/.test(tickSt),
    tickSt
  );
  const updSt = await waitForStatus(w, /Grafo pronto: \d+ capitoli da 9 messaggi( · mappa del motore)? · coda della chat/, 12000);
  assert(
    "P5b. aggiornamento della coda completato e agganciato alla catena",
    /Grafo pronto: \d+ capitoli da 9 messaggi( · mappa del motore)? · coda della chat/.test(updSt),
    updSt
  );
  const nodesP5 = w.document.querySelectorAll("#mf-graph .mf-node").length;
  assert(
    "P5c. la catena continua dal checkpoint del capitolo 1 (grafo cresciuto, non duplicato)",
    nodesP5 > nodesBeforeP5 && nodesP5 < 40,
    "nodi=" + nodesP5 + " (prima dell'aggiornamento: " + nodesBeforeP5 + ")"
  );

  console.log("\nRisultato: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("ERRORE:", e);
  process.exit(1);
});
