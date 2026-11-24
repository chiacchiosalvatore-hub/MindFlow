/**
 * Test del flusso LAVORI di riassunto — percorso di RISERVA via service
 * worker (v0.9.2: il pannello usa il fetch diretto di engine-client.js,
 * questo canale resta come riserva e ora AUTO-RIPRENDE i lavori interrotti).
 *
 * Carica background.js in una VM Node con chrome.* finto e un "Ollama" finto
 * (server HTTP locale) e verifica:
 *   1. mindflow:summarize risponde IMMEDIATAMENTE con {ok, jobId} (ACK),
 *      anche se il motore impiega secondi (il canale non resta sospeso);
 *   2. mindflow:job-status legge lo stato finché il lavoro non è done e
 *     porta il risultato {title, summary, keyDecisions};
 *   3. auto-riparazione del modello (gemma3 -> gemma3:latest) via /api/tags;
 *   4. motore SPENTO: il lavoro finisce in error con il messaggio di rete vero;
 *   5. riavvio del service worker a metà lavoro: il lavoro RIPARTE da solo
 *      (auto-ripresa con parametri persistiti) e completa invece di lasciare
 *      il chiamante in pausa;
 *   6. regressioni UI: panel.js non marca più «aggiornato» su "message port
 *      closed" / "Receiving end does not exist"; il banner nasce SOLO dal
 *      contesto invalidato vero; riassunto e verifica motore via client
 *      DIRETTO; options.js diretto-first con riserva worker.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const vm = require("vm");

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
const manifestVersion = require("../mindflow-extension/manifest.json").version;

// ---------------------------------------------------------------------------
// "Ollama" finto
// ---------------------------------------------------------------------------

/** mode: "ok" | "slow" | "tags-only" | "dead" */
function startFakeOllama(mode) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/tags") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ models: [{ name: "gemma3:latest" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/chat") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        // Come Ollama vero: modello senza tag o inesistente -> 404 con error.
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch (_e) {
          /* corpo non JSON: trattato come modello sbagliato */
        }
        if (parsed.model !== "gemma3:latest") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: 'model "' + (parsed.model || "") + '" not found, try pulling it first' }));
          return;
        }
        const delay = mode === "slow" ? 1500 : 60;
        setTimeout(() => {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              message: {
                content: JSON.stringify({
                  title: "Dashboard spese",
                  summary: "Tre pilastri: modello dati, caricamento CSV con pandas, vista aggregata per mese.",
                  keyDecisions: ["La UI resta separata dalla logica"],
                }),
              },
            })
          );
        }, delay);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  // mode "dead": nessun server in ascolto (porta qualsiasi) — il chiamante
  // usa una porta chiusa per simulare il motore spento.
  if (mode === "dead") return { port: 59999, close: () => {} };
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

// ---------------------------------------------------------------------------
// chrome.* finto + VM del service worker
// ---------------------------------------------------------------------------

const listeners = [];
const sessionStore = {}; // storage.session: sopravvive ai "riavvii" della VM
const localStore = {}; // storage.local

function makeChrome() {
  return {
    runtime: {
      lastError: undefined,
      onMessage: {
        addListener: (fn) => listeners.push(fn),
      },
      getPlatformInfo: (cb) => setTimeout(() => cb({ os: "test" }), 0),
      getManifest: () => ({ version: require("../mindflow-extension/manifest.json").version }),
    },
    storage: {
      session: {
        get: (keys, cb) => setTimeout(() => cb({ [keys]: sessionStore[keys] }), 0),
        set: (obj, cb) => {
          Object.assign(sessionStore, obj);
          if (cb) setTimeout(cb, 0);
        },
      },
      local: {
        get: (keys, cb) =>
          setTimeout(() => cb({ [keys]: localStore[keys] }), 0),
        set: (obj, cb) => {
          Object.assign(localStore, obj);
          if (cb) setTimeout(cb, 0);
        },
      },
    },
    tabs: { create: () => {} },
  };
}

/** Crea una VM "service worker" fresca: mappa dei lavori vuota (come dopo un
 *  riavvio), storage.session condiviso (come nel browser vero). */
function spawnWorker() {
  const ctx = {
    chrome: makeChrome(),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: globalThis.fetch,
    AbortController,
    URL,
    Date,
    Math,
    JSON,
    Promise,
    Map,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  vm.runInContext(code, ctx, { filename: "background.js" });
  return ctx;
}

/** Invia un messaggio al listener del service worker e raccoglie la risposta. */

// Il listener è registrato dentro la VM: lo ritroviamo nell'elenco globale.
function callListener(ctx, msg) {
  return new Promise((resolve) => {
    let responded = false;
    const sendResponse = (resp) => {
      responded = true;
      resolve({ resp, sync: true });
    };
    const lst = ctx.__mfListener;
    if (!lst) throw new Error("listener non trovato");
    const keepOpen = lst(msg, null, sendResponse);
    if (keepOpen !== true && !responded) {
      // Il listener non ha risposto in modo sincrono e non terrà aperto il
      // canale: in Chrome questo È l'errore "message port closed".
      resolve({ resp: undefined, sync: false });
    }
  });
}

async function main() {
  // --- VM 1: service worker fresco ------------------------------------------
  const ctx = spawnWorker();
  ctx.__mfListener = listeners[listeners.length - 1];
  assert("background.js caricato: listener registrato", typeof ctx.__mfListener === "function");

  // ping
  const ping = await callListener(ctx, { type: "mindflow:ping" });
  assert("ping risponde {ok, version} in modo SINCRONO", ping.sync && ping.resp && ping.resp.ok && ping.resp.version === manifestVersion,
    JSON.stringify(ping.resp || {}));

  // --- (1) ACK immediato con motore LENTO (1,5 s): la risposta arriva subito --
  const ollama = await startFakeOllama("slow");
  const engine = { kind: "ollama", baseUrl: "http://127.0.0.1:" + ollama.port, model: "gemma3:latest" };
  const t0 = Date.now();
  const ack = await callListener(ctx, {
    type: "mindflow:summarize",
    engine,
    segment: [
      { role: "user", text: "Progettiamo una dashboard delle spese mensili in Python. Da dove parto?" },
      { role: "assistant", text: "Parti da tre pilastri: modello dati, caricamento CSV, vista aggregata per mese. Deciso: la UI resta separata dalla logica." },
    ],
    prevTitle: "",
  });
  const ackMs = Date.now() - t0;
  assert(
    "summarize risponde in ACK immediato (<400 ms) anche con motore lento",
    ack.resp && ack.resp.ok === true && typeof ack.resp.jobId === "string" && ackMs < 400,
    "ackMs=" + ackMs + " resp=" + JSON.stringify(ack.resp || {})
  );

  // --- (2) polling fino a done ------------------------------------------------
  let st = null;
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const r = await callListener(ctx, { type: "mindflow:job-status", jobId: ack.resp.jobId });
    st = r.resp;
    if (st && st.ok && st.done) break;
  }
  assert("job-status: lavoro done con risultato completo", !!st && st.ok && st.done && st.status === "done" &&
    st.result && st.result.title === "Dashboard spese" && Array.isArray(st.result.keyDecisions),
    JSON.stringify(st || {}));

  // keep-alive: mentre il lavoro girava il timer è partito; a lavoro finito è spento
  const kaCleared = vm.runInContext("keepAliveTimer === null && keepAliveRefs === 0", ctx);
  assert("keep-alive rilasciato dopo il lavoro", kaCleared === true);

  // --- (3) auto-riparazione del modello ---------------------------------------
  const ack2 = await callListener(ctx, {
    type: "mindflow:summarize",
    engine: { kind: "ollama", baseUrl: engine.baseUrl, model: "gemma3" }, // nome senza tag
    segment: [{ role: "user", text: "test" }, { role: "assistant", text: "risposta di prova" }],
    prevTitle: "",
  });
  let st2 = null;
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const r = await callListener(ctx, { type: "mindflow:job-status", jobId: ack2.resp.jobId });
    st2 = r.resp;
    if (st2 && st2.ok && st2.done) break;
  }
  assert("modello riparato da solo (gemma3 -> gemma3:latest) e salvato", !!st2 && st2.ok && st2.done &&
    st2.status === "done" && st2.result.recoveredModel === "gemma3:latest" &&
    localStore["mf.settings"] && localStore["mf.settings"].engine.model === "gemma3:latest",
    JSON.stringify(st2 || {}));

  // --- (4) motore SPENTO: errore chiaro, niente attesa infinita ----------------
  const dead = await startFakeOllama("dead");
  const ack3 = await callListener(ctx, {
    type: "mindflow:summarize",
    engine: { kind: "ollama", baseUrl: "http://127.0.0.1:" + dead.port, model: "gemma3:latest" },
    segment: [{ role: "user", text: "test" }, { role: "assistant", text: "risposta" }],
    prevTitle: "",
  });
  let st3 = null;
  for (let i = 0; i < 120; i++) {
    await sleep(150);
    const r = await callListener(ctx, { type: "mindflow:job-status", jobId: ack3.resp.jobId });
    st3 = r.resp;
    if (st3 && st3.ok && st3.done) break;
  }
  assert("motore spento: job in error con messaggio di rete vero", !!st3 && st3.ok && st3.done && st3.status === "error" &&
    /raggiungibile|ollama serve/i.test(st3.error || ""),
    JSON.stringify(st3 || {}));

  ollama.close();

  // --- (5) RIAVVIO del service worker a metà lavoro: AUTO-RIPRESA -----------
  const ollama2 = await startFakeOllama("slow");
  const ack4 = await callListener(ctx, {
    type: "mindflow:summarize",
    engine: { kind: "ollama", baseUrl: "http://127.0.0.1:" + ollama2.port, model: "gemma3:latest" },
    segment: [{ role: "user", text: "test" }, { role: "assistant", text: "risposta" }],
    prevTitle: "",
  });
  await sleep(120); // il lavoro parte; NON aspettiamo la fine
  // Nuova VM = service worker riavviato (mappa vuota, storage.session condiviso):
  // il lavoro «running» deve RIPARTIRE da solo (parametri persistiti) e
  // arrivare a done: niente più checkpoint lasciati in pausa per un falso
  // «lavoro interrotto».
  const ctx2 = spawnWorker();
  ctx2.__mfListener = listeners[listeners.length - 1];
  let st4 = null;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    const r = await callListener(ctx2, { type: "mindflow:job-status", jobId: ack4.resp.jobId });
    st4 = r.resp;
    if (st4 && st4.ok && st4.done) break;
  }
  assert(
    "worker riavviato a metà lavoro: il lavoro RIPARTE da solo e completa",
    st4 && st4.ok && st4.done === true && st4.status === "done" &&
      st4.result && st4.result.title === "Dashboard spese",
    JSON.stringify(st4 || {})
  );
  const stUnknown = await callListener(ctx2, { type: "mindflow:job-status", jobId: "job-inesistente" });
  assert(
    "job-status di lavoro sconosciuto: errore chiaro «riprova»",
    stUnknown.resp && stUnknown.resp.ok === false && /riprova|perduto|scaduto/i.test(stUnknown.resp.error || ""),
    JSON.stringify(stUnknown.resp || {})
  );
  ollama2.close();

  // --- (6) regressioni UI a livello di sorgente --------------------------------
  const panelSrc = fs.readFileSync(path.join(SRC, "panel.js"), "utf8");
  const optsSrc = fs.readFileSync(path.join(SRC, "options.js"), "utf8");
  const bgSrc = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  const contentSrc = fs.readFileSync(path.join(SRC, "content.js"), "utf8");

  // chromeSend di panel.js: la regex che marca il banner NON contiene più
  // "message port closed" né "Receiving end does not exist". Si tolgono i
  // commenti prima del confronto: la spiegazione li cita apposta.
  const chromeSendRaw = panelSrc.match(/function chromeSend\(msg\) \{[\s\S]*?\n  \}/)[0];
  const chromeSendBody = chromeSendRaw
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  assert(
    "panel.js: «message port closed» NON marca più il banner aggiornato",
    /context invalidated\|extension context/i.test(chromeSendBody) &&
      !/message port closed/i.test(chromeSendBody) &&
      !/Receiving end does not exist/i.test(chromeSendBody)
  );
  assert(
    "panel.js: runSummarizeJob interroga mindflow:job-status con tolleranza alle mancate",
    /runSummarizeJob[\s\S]*mindflow:job-status[\s\S]*misses/.test(panelSrc)
  );
  assert(
    "panel.js: il fallimento del riassunto NON chiama più markRuntimeBroken",
    !/Checkpoint non creato[\s\S]{0,400}markRuntimeBroken/.test(panelSrc)
  );
  assert(
    "options.js: prova riassunto DIRETTA (engine-client) + riserva service worker",
    /MF\.summarize/.test(optsSrc) && /mindflow:job-status/.test(optsSrc) && /runViaServiceWorker/.test(optsSrc)
  );
  assert(
    "background.js: keep-alive interno presente",
    /keepAliveAcquire|getPlatformInfo/.test(bgSrc)
  );

  // v0.9.2: il banner «ricarica la pagina» nasce SOLO dal contesto invalidato
  // VERO. Prima markRuntimeBroken veniva chiamata anche dal ping-3-volte e dal
  // test motore, e il banner tornava pure dopo il ricaricamento (il difetto
  // che l'utente ha segnalato). Devono restare solo definizione + le 2
  // chiamate dentro chromeSend.
  const brokenCalls = (panelSrc.match(/markRuntimeBroken\(/g) || []).length;
  assert(
    "panel.js: markRuntimeBroken presente SOLO in chromeSend (1 definizione + 2 chiamate)",
    brokenCalls === 3,
    "occorrenze=" + brokenCalls
  );
  assert(
    "panel.js: niente più ping-3-volte (avvio e verifica motore senza service worker)",
    !/dopo tre tentativi|tries < 2/.test(panelSrc)
  );
  assert(
    "panel.js: riassunto e verifica motore via client DIRETTO (MF.*)",
    /MF\.summarize/.test(panelSrc) && /MF\.testEngine/.test(panelSrc) && /runSummarizeFlow/.test(panelSrc)
  );
  const panelHtml = fs.readFileSync(path.join(SRC, "panel.html"), "utf8");
  const optsHtml = fs.readFileSync(path.join(SRC, "options.html"), "utf8");
  assert(
    "panel.html carica engine-client.js PRIMA di panel.js",
    panelHtml.indexOf("engine-client.js") !== -1 &&
      panelHtml.indexOf("engine-client.js") < panelHtml.indexOf("panel.js")
  );
  assert(
    "options.html carica engine-client.js PRIMA di options.js",
    optsHtml.indexOf("engine-client.js") !== -1 &&
      optsHtml.indexOf("engine-client.js") < optsHtml.indexOf("options.js")
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  assert("manifest.json: versione presente e coerente", typeof manifest.version === "string" && /^\d+\.\d+\.\d+$/.test(manifest.version));
  assert(
    "content.js: rilevamento contesto orfano con ricarica dal launcher",
    /mf-stale/.test(contentSrc) && /contextBroken/.test(contentSrc)
  );

  console.log("\nRisultato: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("ERRORE:", e);
  process.exit(1);
});
