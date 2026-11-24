/**
 * Test del client motore condiviso (engine-client.js, v1.2.1).
 *
 * È il percorso PRINCIPALE del riassunto (fetch DIRETTO dal pannello e dalla
 * pagina impostazioni): deve funzionare senza service worker. Verifica in VM
 * con un "Ollama" finto (server HTTP locale):
 *   1. summarize OK -> {title, summary, keyDecisions} via fetch diretto;
 *   2. auto-riparazione del nome modello (gemma3 -> gemma3:latest) con
 *      recoveredModel nel risultato;
 *   3. motore SPENTO: errore marcato isNetwork (il chiamante sa che può
 *      ripiegare sul lavoro nel service worker);
 *   4. output NON JSON dal motore: errore VERO del motore, NON di rete
 *      (niente fallback euristico, niente falso errore di connessione);
 *   5. testEngine: ok con lista modelli; motore spento -> {ok:false, isNetwork};
 *   6. suggestModel: preferenza per il prefisso uguale, poi modelli noti.
 * Con un "LM Studio" finto (OpenAI-compat su /v1, v1.2.1):
 *   8. chiave normale + match fuzzy dei nomi modello (nome utente corto
 *      -> chiave lunga «editore/Repo-GGUF»);
 *   9. testEngine ok con lista modelli e sonda POST passante;
 *  10. auto-riparazione del nome anche su openai-compat (summarize);
 *  11. planChapters su LM Studio con auto-riparazione del nome;
 *  12. CORS spento: chat -> isCompatBlocked con la cura; testEngine ->
 *      {ok:false, compatBlocked} (endpoint OK, POST rifiutato);
 *  13. modello «thinking» (Qwen3): 1° tentativo vuoto nel ragionamento,
 *      2° con più token -> checkpoint creato.
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

// ---------------------------------------------------------------------------
// "Ollama" finto — mode: "ok" | "slow" | "garbage" | "dead"
// ---------------------------------------------------------------------------

function startFakeOllama(mode) {
  if (mode === "dead") return { port: 59998, close: () => {} };
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/tags") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ models: [{ name: "gemma3:latest" }, { name: "llama3.2:3b" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/chat") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch (_e) {
          /* corpo non JSON */
        }
        if (parsed.model !== "gemma3:latest") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: 'model "' + (parsed.model || "") + '" not found, try pulling it first' }));
          return;
        }
        const delay = mode === "slow" ? 400 : 30;
        setTimeout(() => {
          res.setHeader("Content-Type", "application/json");
          let content;
          let meta = {};
          if (mode === "garbage") {
            content = "Certo! Ecco una bella risposta discorsiva senza alcun JSON dentro.";
          } else if (mode === "empty") {
            // Modalità "modello muto": le vere richieste di riassunto tornano
            // 200 OK ma VUOTE (con i metadati reali di un modello che carica
            // dal disco e non scrive nulla); il PING di controllo (12 token)
            // invece risponde — così il test copre il percorso completo:
            // diagnosi dai metadati + ping riuscito nel messaggio finale.
            if (parsed.options && parsed.options.num_predict && parsed.options.num_predict <= 16) {
              content = "OK";
            } else {
              content = "";
              meta = { eval_count: 0, load_duration: 3200000000, total_duration: 4000000000, done_reason: "stop" };
            }
          } else {
            content = JSON.stringify({
              title: "Dashboard spese",
              summary: "Tre pilastri: modello dati, caricamento CSV con pandas, vista aggregata per mese.",
              keyDecisions: ["La UI resta separata dalla logica"],
            });
          }
          res.end(JSON.stringify({ message: { content }, ...meta }));
        }, delay);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

// ---------------------------------------------------------------------------
// "LM Studio" finto — server OpenAI-compat su /v1 — mode: "ok" | "cors" | "thinking"
// Il modello caricato ha la chiave LUNGA con maiuscole, come le mostra LM
// Studio: è il caso reale del bug «endpoint riconosciuto ma modello morto».
// ---------------------------------------------------------------------------

const LM_MODEL = "lmstudio-community/Qwen3.5-9B-abliterated-GGUF";

function startFakeLMStudio(mode) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: LM_MODEL }, { id: "llama-3.2-3b-instruct" }],
        })
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      if (mode === "cors") {
        // CORS spento: il GET passa, il POST dell'estensione muore con 403.
        res.writeHead(403);
        res.end();
        return;
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch (_e) {
          /* corpo non JSON */
        }
        if (parsed.model !== LM_MODEL) {
          // Come LM Studio: 400 con {error:{message:"model ... not found"}}.
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: { message: 'model "' + (parsed.model || "") + '" not found' } })
          );
          return;
        }
        const maxTokens = parsed.max_tokens || 0;
        let choice;
        if (mode === "thinking" && maxTokens <= 420) {
          // Modello "thinking": brucia TUTTO il budget nel ragionamento,
          // content vuoto, stop per lunghezza.
          choice = {
            message: {
              content: "",
              reasoning_content:
                "Devo pensare a lungo prima di rispondere… il segmento parla di una dashboard… quindi…",
            },
            finish_reason: "length",
          };
        } else if (
          parsed.messages &&
          parsed.messages[0] &&
          /pianificatore|capitoli/i.test(parsed.messages[0].content || "")
        ) {
          choice = {
            message: {
              content: JSON.stringify({
                chapters: [{ title: "Dashboard delle spese", from: 1, to: 2 }],
              }),
            },
            finish_reason: "stop",
          };
        } else {
          choice = {
            message: {
              content: JSON.stringify({
                title: "Dashboard spese",
                summary:
                  "Tre pilastri: modello dati, caricamento CSV con pandas, vista aggregata per mese.",
                keyDecisions: ["La UI resta separata dalla logica"],
              }),
            },
            finish_reason: "stop",
          };
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [choice] }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

// ---------------------------------------------------------------------------
// VM del client (nessun chrome.*: è il punto del test)
// ---------------------------------------------------------------------------

function loadClient() {
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    fetch: globalThis.fetch,
    AbortController,
    URL,
    Date,
    Math,
    JSON,
    Promise,
    Object,
    Array,
    Error,
    String,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(SRC, "engine-client.js"), "utf8");
  vm.runInContext(code, ctx, { filename: "engine-client.js" });
  return ctx;
}

async function main() {
  const ctx = loadClient();
  const MF = ctx.MindFlowEngineClient;
  assert("engine-client.js caricato: MindFlowEngineClient esportato", !!MF && typeof MF.summarize === "function");

  const SEGMENT = [
    { role: "user", text: "Progettiamo una dashboard delle spese mensili in Python. Da dove parto?" },
    { role: "assistant", text: "Parti da tre pilastri: modello dati, caricamento CSV con pandas, vista aggregata per mese con groupby." },
  ];

  // --- (1) summarize OK in fetch DIRETTO --------------------------------------
  const ok1 = await startFakeOllama("ok");
  let mem = null;
  let err1 = null;
  try {
    mem = await MF.summarize({ kind: "ollama", baseUrl: "http://127.0.0.1:" + ok1.port, model: "gemma3:latest" }, SEGMENT, "");
  } catch (e) {
    err1 = e;
  }
  assert(
    "summarize DIRETTO ok: memory node completa",
    !err1 && mem && mem.title === "Dashboard spese" && !!mem.summary && Array.isArray(mem.keyDecisions),
    err1 ? err1.message : JSON.stringify(mem || {})
  );
  ok1.close();

  // --- (2) auto-riparazione del nome modello ----------------------------------
  const ok2 = await startFakeOllama("ok");
  let mem2 = null;
  let err2 = null;
  try {
    mem2 = await MF.summarize({ kind: "ollama", baseUrl: "http://127.0.0.1:" + ok2.port, model: "gemma3" }, SEGMENT, "");
  } catch (e) {
    err2 = e;
  }
  assert(
    "auto-riparazione gemma3 -> gemma3:latest con recoveredModel",
    !err2 && mem2 && mem2.title === "Dashboard spese" && mem2.recoveredModel === "gemma3:latest",
    err2 ? err2.message : JSON.stringify(mem2 || {})
  );
  ok2.close();

  // --- (3) motore SPENTO: errore isNetwork -------------------------------------
  const dead = await startFakeOllama("dead");
  let err3 = null;
  try {
    await MF.summarize({ kind: "ollama", baseUrl: "http://127.0.0.1:" + dead.port, model: "gemma3:latest" }, SEGMENT, "");
  } catch (e) {
    err3 = e;
  }
  assert(
    "motore spento: errore marcato isNetwork con messaggio di rete umano",
    !!err3 && err3.isNetwork === true && /raggiungibile|ollama serve/i.test(err3.message || ""),
    err3 ? err3.message + " isNetwork=" + err3.isNetwork : "nessun errore"
  );

  // --- (4) output NON JSON: errore VERO del motore, non di rete ---------------
  const garbage = await startFakeOllama("garbage");
  let err4 = null;
  try {
    await MF.summarize({ kind: "ollama", baseUrl: "http://127.0.0.1:" + garbage.port, model: "gemma3:latest" }, SEGMENT, "");
  } catch (e) {
    err4 = e;
  }
  assert(
    "output non JSON: errore del MOTORE (non di rete, niente fallback)",
    !!err4 && !err4.isNetwork && /Checkpoint non creato|interpretabile/i.test(err4.message || ""),
    err4 ? err4.message + " isNetwork=" + err4.isNetwork : "nessun errore"
  );
  garbage.close();

  // --- (4b) risposta VUOTA del modello: diagnosi dai metadati + ping ---------
  // Il server in modalità "empty" torna 200 OK con contenuto vuoto e i
  // metadati veri di Ollama (0 token generati, modello caricato in 3,2 s);
  // il ping di controllo (12 token) invece risponde "OK". Attesi: messaggio
  // con la diagnosi E il verdetto del ping (riuscito → riprovare subito).
  const empty = await startFakeOllama("empty");
  let err4b = null;
  try {
    await MF.summarize({ kind: "ollama", baseUrl: "http://127.0.0.1:" + empty.port, model: "gemma3:latest" }, SEGMENT, "");
  } catch (e) {
    err4b = e;
  }
  assert(
    "risposta vuota: diagnosi dai metadati (0 token, caricamento dal disco)",
    !!err4b && !err4b.isNetwork && /0 token generati/.test(err4b.message || "") && /caricato in 3,2 s/.test(err4b.message || ""),
    err4b ? err4b.message + " isNetwork=" + err4b.isNetwork : "nessun errore"
  );
  assert(
    "risposta vuota: ping di controllo eseguito e riuscito nel messaggio finale",
    !!err4b && /Ping di controllo riuscito/.test(err4b.message || ""),
    err4b ? err4b.message : "nessun errore"
  );
  empty.close();

  // --- (5) testEngine -----------------------------------------------------------
  const ok5 = await startFakeOllama("ok");
  const t1 = await MF.testEngine({ kind: "ollama", baseUrl: "http://127.0.0.1:" + ok5.port, model: "gemma3:latest" });
  assert(
    "testEngine ok: elenco modelli dal motore",
    t1 && t1.ok === true && Array.isArray(t1.models) && t1.models.indexOf("gemma3:latest") !== -1,
    JSON.stringify(t1 || {})
  );
  ok5.close();
  const t2 = await MF.testEngine({ kind: "ollama", baseUrl: "http://127.0.0.1:" + dead.port, model: "gemma3:latest" });
  assert(
    "testEngine con motore spento: {ok:false, isNetwork}",
    t2 && t2.ok === false && t2.isNetwork === true,
    JSON.stringify(t2 || {})
  );

  // --- (6) suggestModel ----------------------------------------------------------
  assert(
    "suggestModel: prefisso uguale vince; poi preferenza per modelli noti",
    MF.suggestModel(["llama3.2:3b", "gemma3:latest"], "gemma3") === "gemma3:latest" &&
      MF.suggestModel(["llama3.2:3b", "qwen2.5:7b"], "gemma3") === "llama3.2:3b" &&
      MF.suggestModel([], "gemma3") === ""
  );

  // --- (7) panel.js e options.js usano il client, non copie locali -------------
  const panelSrc = fs.readFileSync(path.join(SRC, "panel.js"), "utf8");
  const optsSrc = fs.readFileSync(path.join(SRC, "options.js"), "utf8");
  assert(
    "panel.js: client diretto usato per riassunto (MF.summarize) e verifica (MF.testEngine)",
    /MF\.summarize\(/.test(panelSrc) && /MF\.testEngine\(/.test(panelSrc)
  );
  assert(
    "options.js: prova riassunto DIRETTA con riserva service worker",
    /MF\.summarize\(/.test(optsSrc) && /runViaServiceWorker/.test(optsSrc)
  );

  // --- (8) chiavi modello: normalizzazione e match fuzzy (LM Studio) --------
  assert(
    "normalizeModelKey: chiave lunga LM Studio e nome utente → stessa chiave normale",
    MF.normalizeModelKey("lmstudio-community/Qwen3.5-9B-abliterated-GGUF") === "qwen359babliterated" &&
      MF.normalizeModelKey("qwen3.5 9b abliterated") === "qwen359babliterated" &&
      MF.normalizeModelKey("gemma3:latest") === "gemma3"
  );
  assert(
    "fuzzyFindModel: «qwen3.5 9b abliterated» trova la chiave lunga di LM Studio",
    MF.fuzzyFindModel(["llama-3.2-3b-instruct", LM_MODEL], "qwen3.5 9b abliterated") === LM_MODEL &&
      MF.fuzzyFindModel(["llama-3.2-3b-instruct", LM_MODEL], "Qwen3.5-9B-abliterated") === LM_MODEL &&
      MF.fuzzyFindModel([LM_MODEL], "gemma3") === ""
  );

  // --- (9) testEngine su LM Studio OK (lista modelli + sonda POST passante) --
  const lms1 = await startFakeLMStudio("ok");
  const t3 = await MF.testEngine({
    kind: "openai-compat",
    baseUrl: "http://127.0.0.1:" + lms1.port,
    model: LM_MODEL,
  });
  assert(
    "testEngine LM Studio: ok con le chiavi modello della lista",
    t3 && t3.ok === true && Array.isArray(t3.models) && t3.models.indexOf(LM_MODEL) !== -1,
    JSON.stringify(t3 || {})
  );

  // --- (10) auto-riparazione del nome su LM Studio (nome corto → chiave lunga)
  let mem5 = null;
  let err5 = null;
  try {
    mem5 = await MF.summarize(
      { kind: "openai-compat", baseUrl: "http://127.0.0.1:" + lms1.port, model: "qwen3.5 9b abliterated" },
      SEGMENT,
      ""
    );
  } catch (e) {
    err5 = e;
  }
  assert(
    "auto-riparazione LM Studio: «qwen3.5 9b abliterated» → chiave lunga, checkpoint creato",
    !err5 && mem5 && mem5.title === "Dashboard spese" && mem5.recoveredModel === LM_MODEL,
    err5 ? err5.message : JSON.stringify(mem5 || {})
  );

  // --- (11) mappa capitoli via LM Studio con auto-riparazione del nome --------
  let chapters5 = null;
  let err5b = null;
  try {
    chapters5 = await MF.planChapters(
      { kind: "openai-compat", baseUrl: "http://127.0.0.1:" + lms1.port, model: "qwen3.5-9b-abliterated" },
      SEGMENT
    );
  } catch (e) {
    err5b = e;
  }
  assert(
    "planChapters LM Studio: auto-riparazione del nome e capitoli validi",
    !err5b &&
      chapters5 &&
      chapters5.length === 1 &&
      chapters5[0].title === "Dashboard delle spese" &&
      chapters5[0].from === 1 &&
      chapters5[0].to === 2,
    err5b ? err5b.message : JSON.stringify(chapters5 || {})
  );
  lms1.close();

  // --- (12) LM Studio col CORS spento: chat e testEngine -----------------------
  const lms2 = await startFakeLMStudio("cors");
  let err6 = null;
  try {
    await MF.chat(
      { kind: "openai-compat", baseUrl: "http://127.0.0.1:" + lms2.port, model: LM_MODEL },
      { user: "ciao", maxTokens: 24 }
    );
  } catch (e) {
    err6 = e;
  }
  assert(
    "chat LM Studio col CORS spento: errore isCompatBlocked con la cura (Enable CORS)",
    !!err6 && err6.isCompatBlocked === true && /CORS/.test(err6.message || "") && /LM Studio/.test(err6.message || ""),
    err6 ? err6.message : "nessun errore"
  );
  const t4 = await MF.testEngine({
    kind: "openai-compat",
    baseUrl: "http://127.0.0.1:" + lms2.port,
    model: LM_MODEL,
  });
  assert(
    "testEngine LM Studio col CORS spento: {ok:false, compatBlocked} (endpoint OK, POST rifiutato)",
    t4 && t4.ok === false && t4.compatBlocked === true,
    JSON.stringify(t4 || {})
  );
  lms2.close();

  // --- (13) modello «thinking» (Qwen3): riprova con più token -----------------
  const lms3 = await startFakeLMStudio("thinking");
  let mem7 = null;
  let err7 = null;
  try {
    mem7 = await MF.summarize(
      { kind: "openai-compat", baseUrl: "http://127.0.0.1:" + lms3.port, model: LM_MODEL },
      SEGMENT,
      ""
    );
  } catch (e) {
    err7 = e;
  }
  assert(
    "modello thinking (Qwen3): 1° tentativo vuoto (ragionamento), 2° con più token → checkpoint creato",
    !err7 && mem7 && mem7.title === "Dashboard spese",
    err7 ? err7.message : JSON.stringify(mem7 || {})
  );
  lms3.close();

  console.log("\nRisultato: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("ERRORE:", e);
  process.exit(1);
});
