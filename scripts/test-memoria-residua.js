/**
 * Test di regressione: MEMORIA RESIDUA nelle conversazioni lunghe (v1.2.2).
 *
 * Roadmap item 3: verificare che la memoria di una chat non «sbuchi» dove
 * non deve. Scenari (pannello reale caricato in jsdom, chrome finto con
 * storage CHE RICORDA i dati come chrome.storage.local vero):
 *
 *   A. CONVERSAZIONE LUNGA (6 poll, 12 messaggi nella stessa sessione):
 *      una sola sessione, solo la radice (nessun nodo fantasma dal poll),
 *      payload ancora non compilato.
 *   B. CHIUSURA + RIAPERTURA del pannello a metà conversazione:
 *      il grafo torna dallo storage identico (root + 3 checkpoint), un nuovo
 *      poll con messaggi in più NON duplica nodi né crea sessioni gemelle;
 *      «Compila» copre SOLO i messaggi dopo l'ultimo checkpoint.
 *   C. CAMBIO SCHEDA / navigazione (cambio convKey) a sessione aperta:
 *      il payload della chat precedente NON si trascina nella nuova, le due
 *      sessioni restano separate nello storage, e tornando indietro il grafo
 *      di partida è integro (nessuna contaminazione incrociata).
 *   D. CAMBIO ENDPOINT/MODELLO a metà sessione (storage.onChanged):
 *      la verifica motore riparte verso il NUOVO endpoint, ma la memoria di
 *      sessione (nodi, checkpoint attivo, payload) resta IDENTICA.
 *   E. RESET / azzera memoria (doppio clic di conferma):
 *      la sessione torna alla sola radice, NESSUN titolo o id vecchio resta
 *      nello storage, l'altre chat non viene toccata, e i nuovi messaggi non
 *      riportano in vita lo storico vecchio.
 *
 * Stile e harness di test-panel-boot.js (adapters + engine-client + panel
 * nello stesso ordine di panel.html; service worker morto, fetch diretto).
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

/** Storage finto CHE RICORDA: get restituisce lo stato corrente (copia),
 *  set ci scrive dentro. Condiviso tra pannello «chiuso» e «riaperto». */
function makeFakeStorage(storeData) {
  const writes = [];
  let onChangedListener = null;
  return {
    writes,
    fireOnChanged(changes) {
      if (onChangedListener) onChangedListener(changes, "local");
    },
    chrome: {
      runtime: {
        id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sendMessage: (_msg, cb) => {
          if (cb) setTimeout(() => cb(undefined), 0); // service worker MORTO
        },
      },
      storage: {
        local: {
          get: (keys, cb) =>
            setTimeout(() => {
              const out = {};
              (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
                if (storeData[k] !== undefined) {
                  out[k] = JSON.parse(JSON.stringify(storeData[k]));
                }
              });
              cb(out);
            }, 0),
          set: (obj, cb) => {
            writes.push(JSON.parse(JSON.stringify(obj)));
            Object.keys(obj).forEach((k) => {
              storeData[k] = JSON.parse(JSON.stringify(obj[k]));
            });
            if (cb) setTimeout(cb, 0);
          },
        },
        onChanged: {
          addListener: (fn) => {
            onChangedListener = fn;
          },
        },
      },
    },
  };
}

/** Costruisce il DOM del pannello con gli script caricati in ordine. */
function buildPanelDom(fake, fetchLog) {
  const html = read("panel.html");
  const dom = new JSDOM(html, {
    url: "chrome-extension://test/panel.html",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.fetch = (url, opts) => {
    fetchLog.push(String(url));
    if (String(url).endsWith("/api/tags")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: "gemma3:latest" }] }),
      });
    }
    return Promise.reject(new TypeError("fetch failed"));
  };
  w.chrome = fake.chrome;
  // Ordine di caricamento IDENTICO a panel.html: adapters, engine-client, panel.
  w.eval(read("adapters.js"));
  w.eval(read("engine-client.js"));
  w.eval(read("panel.js"));
  return w;
}

/** Un poll del content script: mindflow:messages con info + messaggi. */
function poll(w, info, messages) {
  w.postMessage({ type: "mindflow:messages", info, messages, stats: { dom: messages.length } }, "*");
}

function mkMsg(role, text) {
  return { role, text };
}

/** Sessione «già costruita» con checkpoint (come dopo «Costruisci il grafo»). */
function seedSession(host, convKey, title, cps) {
  const now = Date.now();
  const nodes = [
    {
      id: "root",
      parentId: null,
      createdAt: now,
      title: "Inizio conversazione",
      summary: "",
      keyDecisions: [],
      msgIndex: 0,
    },
  ];
  let prev = "root";
  cps.forEach((cp, i) => {
    const id = "cp-seed-" + i + "-" + Math.random().toString(36).slice(2, 7);
    nodes.push({
      id,
      parentId: prev,
      createdAt: now,
      title: cp.title,
      summary: cp.summary,
      keyDecisions: cp.keyDecisions || [],
      msgIndex: cp.msgIndex,
    });
    prev = id;
  });
  return {
    key: host + "::" + convKey,
    host,
    title,
    createdAt: now,
    updatedAt: now,
    nodes,
    activeNodeId: prev,
  };
}

async function main() {
  // ---------------------------------------------------------------------------
  // Impostazioni memorizzate (auto-checkpoint SPENTO: i conteggi dei nodi
  // devono dipendere solo dallo scenario, non dal motore).
  // ---------------------------------------------------------------------------
  const storedSettings = {
    engine: { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "gemma3" },
    autoCheckpoint: { enabled: false, assistantThreshold: 4 },
    panel: { widthMode: "narrow", autoOpen: true },
  };

  // ---------------------------------------------------------------------------
  // A. CONVERSAZIONE LUNGA: molti poll nella STESSA sessione
  // ---------------------------------------------------------------------------
  console.log("\n[A] Conversazione lunga: 6 poll, 12 messaggi, stessa sessione");

  const storeA = { "mf.settings": JSON.parse(JSON.stringify(storedSettings)), "mf.sessions": {} };
  const fakeA = makeFakeStorage(storeA);
  const fetchLogA = [];
  const w1 = buildPanelDom(fakeA, fetchLogA);
  await sleep(1400); // avvio + verifica motore (600 ms) + fetch

  const infoLunga = { host: "chatgpt", convKey: "conv-lunga", title: "Analisi trimestrale Q1" };
  const msgs = [];
  msgs.push(mkMsg("user", "PRIMO-messaggio-pre-checkpoint: partiamo dai dati di vendita."));
  msgs.push(mkMsg("assistant", "Ok, il modello dati ha tre tabelle: vendite, clienti, prodotti."));
  poll(w1, infoLunga, msgs.slice());
  await sleep(120);

  // Poll 2..6: la conversazione cresce fino a 12 messaggi (turni veri).
  const extraTexts = [
    ["user", "Come aggrego per mese?"],
    ["assistant", "Con groupby su una colonna mese derivata dalla data."],
    ["user", "E per le stagionalità?"],
    ["assistant", "Confronta gli stessi mesi dell'anno precedente."],
    ["user", "Aggiungiamo una previsione?"],
    ["assistant", "Sì, media mobile semplice a 3 mesi come baseline."],
    ["user", "Servono grafici?"],
    ["assistant", "Un line chart mensile e una tabella pivot bastano."],
    ["user", "ULTIMO-messaggio-post-checkpoint: prepara il report finale."],
    ["assistant", "Report pronto: estratto conto trimestrale con delta %."],
  ];
  for (const [role, text] of extraTexts) {
    msgs.push(mkMsg(role, text));
    poll(w1, infoLunga, msgs.slice());
    await sleep(80);
  }
  await sleep(450); // attesa del salvataggio (debounce 250 ms)

  const sessA = storeA["mf.sessions"];
  const keysA = Object.keys(sessA);
  assert("A1. una SOLA sessione creata dai poll", keysA.length === 1 && keysA[0] === "chatgpt::conv-lunga", JSON.stringify(keysA));
  assert(
    "A2. la sessione ha SOLO la radice: il poll non crea nodi fantasma",
    sessA["chatgpt::conv-lunga"] && sessA["chatgpt::conv-lunga"].nodes.length === 1,
    "nodi=" + (sessA["chatgpt::conv-lunga"] ? sessA["chatgpt::conv-lunga"].nodes.length : "assente")
  );
  assert(
    "A3. titolo sessione = titolo chat (aggancio giusto)",
    (sessA["chatgpt::conv-lunga"].title || "").indexOf("Analisi trimestrale") !== -1,
    sessA["chatgpt::conv-lunga"].title
  );
  assert(
    "A4. nessun payload compilato prima che l'utente lo chieda",
    w1.document.getElementById("mf-payload").textContent === "",
    JSON.stringify(w1.document.getElementById("mf-payload").textContent.slice(0, 60))
  );
  assert(
    "A5. motore verificato in fetch diretto all'avvio (etichetta verde)",
    w1.document.getElementById("mf-engine-label").textContent === "Ollama · gemma3:latest",
    w1.document.getElementById("mf-engine-label").textContent
  );

  // ---------------------------------------------------------------------------
  // B. CHIUSURA + RIAPERTURA a metà conversazione
  // ---------------------------------------------------------------------------
  console.log("\n[B] Chiusura e riapertura del pannello a metà conversazione");

  // Tra chiusura e riapertura il grafo è stato costruito (root + 3 cp) e una
  // seconda chat esiste già: lo storage «si ricorda» come chrome.storage.local.
  const seedLunga = seedSession("chatgpt", "conv-lunga", "Analisi trimestrale Q1", [
    { title: "Capitolo A — Riepilogo dati", summary: "Tre tabelle: vendite, clienti, prodotti.", keyDecisions: ["Modello dati a 3 tabelle"], msgIndex: 2 },
    { title: "Capitolo B — Analisi spese", summary: "Aggregazione mensile con groupby.", keyDecisions: ["Groupby mensile"], msgIndex: 4 },
    { title: "Capitolo C — Budget trimestre", summary: "Media mobile a 3 mesi come baseline.", keyDecisions: ["Baseline = media mobile"], msgIndex: 6 },
  ]);
  const seedB = seedSession("chatgpt", "conv-B", "Progetto B", [
    { title: "Progetto B — Kickoff", summary: "Obiettivi e milestone del progetto B.", keyDecisions: ["Milestone mensili"], msgIndex: 2 },
    { title: "Progetto B — Decisioni", summary: "Scelto lo stack Node.", keyDecisions: ["Stack Node"], msgIndex: 4 },
  ]);
  storeA["mf.sessions"] = {
    "chatgpt::conv-lunga": seedLunga,
    "chatgpt::conv-B": seedB,
  };

  const storeB = storeA; // stesso storage: la riapertura legge l'ultimo stato
  const fakeB = makeFakeStorage(storeB);
  const fetchLogB = [];
  const w2 = buildPanelDom(fakeB, fetchLogB);
  await sleep(1400);

  poll(w2, infoLunga, msgs.slice().concat([mkMsg("user", "Due turni arrivati da pannello chiuso: uno."), mkMsg("assistant", "E due: la chat è andata avanti mentre il pannello era chiuso.")]));
  await sleep(450); // 14 messaggi ora

  assert(
    "B1. riapertura: il titolo della chat collegata torna dallo storage",
    w2.document.getElementById("mf-session-title").textContent.indexOf("Analisi trimestrale") !== -1,
    w2.document.getElementById("mf-session-title").textContent
  );
  assert(
    "B2. riapertura: il grafo è COMPLETO (root + 3 checkpoint), nessuna perdita",
    storeB["mf.sessions"]["chatgpt::conv-lunga"].nodes.length === 4,
    "nodi=" + storeB["mf.sessions"]["chatgpt::conv-lunga"].nodes.length
  );
  assert(
    "B3. riapertura + nuovo poll: NESSUN nodo duplicato né sessione gemella",
    Object.keys(storeB["mf.sessions"]).length === 2 &&
      storeB["mf.sessions"]["chatgpt::conv-lunga"].nodes.length === 4 &&
      storeB["mf.sessions"]["chatgpt::conv-lunga"].nodes[0].id === "root",
    JSON.stringify(Object.keys(storeB["mf.sessions"]))
  );

  w2.document.getElementById("mf-btn-compile").click();
  await sleep(120);
  const payloadB = w2.document.getElementById("mf-payload").textContent;
  assert(
    "B4. «Compila»: la memoria compressa contiene i checkpoint del percorso attivo",
    payloadB.indexOf("[CP 1]") !== -1 && payloadB.indexOf("Riepilogo dati") !== -1 && payloadB.indexOf("Budget trimestre") !== -1,
    payloadB.slice(0, 120)
  );
  assert(
    "B5. «Compila»: copre SOLO i messaggi DOPO l'ultimo checkpoint (8 di 14)",
    payloadB.indexOf("Messaggi dopo l'ultimo checkpoint (8)") !== -1,
    payloadB.slice(-300)
  );
  assert(
    "B6. «Compila»: il primo messaggio (già compresso) NON riappare nel payload",
    payloadB.indexOf("PRIMO-messaggio-pre-checkpoint") === -1 && payloadB.indexOf("ULTIMO-messaggio-post-checkpoint") !== -1
  );

  // ---------------------------------------------------------------------------
  // C. CAMBIO SCHEDA / navigazione durante la conversazione (cambio convKey)
  // ---------------------------------------------------------------------------
  console.log("\n[C] Cambio scheda: conv-lunga → conv-B → conv-lunga");

  const infoB = { host: "chatgpt", convKey: "conv-B", title: "Progetto B" };
  poll(w2, infoB, [mkMsg("user", "Nuovo contesto del progetto B."), mkMsg("assistant", "Ok, riprendo dal kickoff."), mkMsg("user", "Ricordi le milestone?"), mkMsg("assistant", "Sì, quelle mensili.")]);
  await sleep(200);

  assert(
    "C1. cambio conv: il payload vecchio NON si trascina (il box si svuota)",
    w2.document.getElementById("mf-payload").textContent === "",
    JSON.stringify(w2.document.getElementById("mf-payload").textContent.slice(0, 60))
  );

  w2.document.getElementById("mf-btn-compile").click();
  await sleep(120);
  const payloadC = w2.document.getElementById("mf-payload").textContent;
  assert(
    "C2. payload di conv-B: contiene SOLO la memoria del progetto B",
    payloadC.indexOf("Progetto B — Kickoff") !== -1 && payloadC.indexOf("Riepilogo dati") === -1 && payloadC.indexOf("Analisi trimestrale") === -1,
    payloadC.slice(0, 160)
  );

  // Torno alla chat di partida: la memoria di conv-lunga deve essere integra.
  poll(w2, infoLunga, msgs.slice().concat([mkMsg("user", "Due turni arrivati da pannello chiuso: uno."), mkMsg("assistant", "E due: la chat è andata avanti mentre il pannello era chiuso.")]));
  await sleep(200);
  w2.document.getElementById("mf-btn-compile").click();
  await sleep(120);
  const payloadC2 = w2.document.getElementById("mf-payload").textContent;
  assert(
    "C3. ritorno su conv-lunga: grafo integro e payload giusto (nessuna contaminazione)",
    payloadC2.indexOf("Riepilogo dati") !== -1 && payloadC2.indexOf("Progetto B") === -1 && payloadC2.indexOf("Messaggi dopo l'ultimo checkpoint (8)") !== -1,
    payloadC2.slice(0, 160)
  );
  const sessC = storeB["mf.sessions"];
  assert(
    "C4. le due sessioni restano SEPARATE e complete nello storage",
    sessC["chatgpt::conv-lunga"].nodes.length === 4 &&
      sessC["chatgpt::conv-B"].nodes.length === 3 &&
      (sessC["chatgpt::conv-B"].title || "").indexOf("Progetto B") !== -1,
    JSON.stringify({ lunga: sessC["chatgpt::conv-lunga"].nodes.length, b: sessC["chatgpt::conv-B"].nodes.length })
  );

  // ---------------------------------------------------------------------------
  // D. CAMBIO ENDPOINT/MODELLO a metà sessione
  // ---------------------------------------------------------------------------
  console.log("\n[D] Cambio endpoint/modello a metà sessione (storage.onChanged)");

  const snapshotD = JSON.stringify(storeB["mf.sessions"]);
  const fetchCountBefore = fetchLogB.length;
  const newSettings = JSON.parse(JSON.stringify(storedSettings));
  newSettings.engine = { kind: "ollama", baseUrl: "http://127.0.0.1:1236", model: "qwen3.5:9b" };
  fakeB.fireOnChanged({ "mf.settings": { oldValue: storedSettings, newValue: newSettings } });
  await sleep(1100); // engineChanged → scheduleEngineCheck(500) → fetch

  assert(
    "D1. la verifica motore riparte verso il NUOVO endpoint (1236), mai prima del cambio",
    fetchLogB.slice(fetchCountBefore).some((u) => u.indexOf("127.0.0.1:1236") !== -1) &&
      fetchLogB.slice(0, fetchCountBefore).every((u) => u.indexOf("127.0.0.1:1236") === -1),
    JSON.stringify(fetchLogB)
  );
  assert(
    "D2. la memoria di sessione resta IDENTICA byte per byte dopo il cambio motore",
    JSON.stringify(storeB["mf.sessions"]) === snapshotD
  );
  assert(
    "D3. il payload compilato sopravvive al cambio motore (nessun'azzeramento residuo)",
    w2.document.getElementById("mf-payload").textContent.indexOf("Riepilogo dati") !== -1,
    w2.document.getElementById("mf-payload").textContent.slice(0, 80)
  );

  // ---------------------------------------------------------------------------
  // E. RESET / azzera memoria (doppio clic di conferma)
  // ---------------------------------------------------------------------------
  console.log("\n[E] Reset: lo storico non deve comparire nella sessione nuova");

  const snapshotB = JSON.stringify(storeB["mf.sessions"]["chatgpt::conv-B"]);
  w2.document.getElementById("mf-btn-reset").click(); // primo clic: arming
  await sleep(80);
  w2.document.getElementById("mf-btn-reset").click(); // secondo clic: conferma
  await sleep(450); // debounce salvataggio 250 ms

  assert(
    "E1. il pannello dichiara l'azzeramento",
    w2.document.getElementById("mf-status").textContent.indexOf("azzerata") !== -1,
    w2.document.getElementById("mf-status").textContent
  );
  const sessE = storeB["mf.sessions"]["chatgpt::conv-lunga"];
  const sessEJson = JSON.stringify(sessE);
  assert(
    "E2. la sessione è tornata alla sola radice (1 nodo, attivo=root)",
    sessE && sessE.nodes.length === 1 && sessE.nodes[0].id === "root" && sessE.activeNodeId === "root",
    "nodi=" + (sessE ? sessE.nodes.length : "assente")
  );
  assert(
    "E3. NESSUN residuo nel storage: né titoli né id vecchi",
    sessEJson.indexOf("Riepilogo dati") === -1 && sessEJson.indexOf("cp-seed-") === -1 && sessEJson.indexOf("Budget trimestre") === -1,
    sessEJson.slice(0, 200)
  );
  assert(
    "E4. il payload si è svuotato e ricompilato PULITO (nessun checkpoint)",
    w2.document.getElementById("mf-payload").textContent === "" ||
      w2.document.getElementById("mf-payload").textContent.indexOf("nessun checkpoint") !== -1
  );
  assert(
    "E5. L'ALTRA chat non è stata toccata dal reset (sessione conv-B identica)",
    JSON.stringify(storeB["mf.sessions"]["chatgpt::conv-B"]) === snapshotB
  );

  // La storia NON torna: nuovi messaggi sulla stessa chat → sessione pulita.
  poll(w2, infoLunga, [mkMsg("user", "dopo-reset: ripartiamo?"), mkMsg("assistant", "Certo, memoria pulita.")]);
  await sleep(300);
  w2.document.getElementById("mf-btn-compile").click();
  await sleep(120);
  const payloadE = w2.document.getElementById("mf-payload").textContent;
  assert(
    "E6. i nuovi messaggi NON riportano in vita lo storico vecchio",
    storeB["mf.sessions"]["chatgpt::conv-lunga"].nodes.length === 1 &&
      payloadE.indexOf("Riepilogo dati") === -1 &&
      payloadE.indexOf("nessun checkpoint") !== -1 &&
      payloadE.indexOf("dopo-reset") !== -1,
    payloadE.slice(0, 160)
  );

  console.log("\nRisultato: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("ERRORE:", e);
  process.exit(1);
});
