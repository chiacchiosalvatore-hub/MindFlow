/**
 * Test della MAPPA DEI CAPITOLI (v1.0.0) — il cuore della pipeline unica.
 *
 * Carica engine-client.js in VM con un motore finto (HTTP locale) e verifica:
 *   1. planChapters OK: la mappa grezza del modello viene NORMALIZZATA
 *      (clamp, scambio from/to, fusioni di sovrapposizioni, chiusura dei
 *      buchi, copertura continua 1..N);
 *   2. la chiamata planner verso Ollama porta format:"json" e num_ctx (la
 *      finestra esplicita serve a non troncare in silenzio);
 *   3. MULTI-MOTORE: con un server OpenAI-compatibile (LM Studio) la mappa
 *      funziona uguale, SENZA campi Ollama-specifici;
 *   4. output improprio per 3 tentativi -> errore DURE (il chiamante decide
 *      la riserva dichiarata: niente capitoli inventati);
 *   5. auto-riparazione del nome modello anche nel planner (gemma3 -> gemma3:latest);
 *   6. exchangeChapters: riserva per scambi, copertura completa, chiusa su
 *      assistente;
 *   7. normalizeChapters: casi limite puri (invertiti, fuori range, buchi, >10 capitoli);
 *   8. reducedTranscript: numerato 1..N, etichette di ruolo, cap sul testo lungo.
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

// ---------------------------------------------------------------------------
// Motori finti
//   ollama-map       -> mappa valida (con sovrapposizioni e buchi voluti)
//   ollama-garbage   -> prosa senza JSON (per sempre)
//   compat-map       -> server OpenAI-compatibile con mappa valida
// ---------------------------------------------------------------------------

const RAW_MAP = {
  chapters: [
    { title: "Impostazione del progetto", from: 1, to: 2 },
    { title: "Modello dei dati", from: 4, to: 5 },
    { title: "Chiusura", from: 5, to: 9 },
  ],
};

// Server finto che registra le meta (num_ctx, format, conteggio) in LAST.
const LAST = { numCtx: null, format: null, requests: 0 };

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
    Number,
    isFinite,
    isNaN,
    Boolean,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(SRC, "engine-client.js"), "utf8");
  vm.runInContext(code, ctx, { filename: "engine-client.js" });
  return ctx;
}

// Server finto che registra le meta (num_ctx, format, conteggio) in LAST.
function startRecordingFake(mode) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/api/tags" || req.url === "/v1/models")) {
      res.setHeader("Content-Type", "application/json");
      const body =
        req.url.indexOf("/api/tags") === 0
          ? { models: [{ name: "gemma3:latest" }, { name: "llama3.2:3b" }] }
          : { data: [{ id: "local-chat" }] };
      res.end(JSON.stringify(body));
      return;
    }
    if (req.method === "POST" && (req.url === "/api/chat" || req.url === "/v1/chat/completions")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch (_e) {
          /* corpo non JSON */
        }
        LAST.requests++;
        LAST.numCtx = parsed.options && parsed.options.num_ctx ? parsed.options.num_ctx : null;
        LAST.format = parsed.format || null;
        const isOllama = req.url === "/api/chat";
        if (isOllama && parsed.model !== "gemma3:latest") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: 'model "' + (parsed.model || "") + '" not found, try pulling it first' }));
          return;
        }
        const content =
          mode === "garbage"
            ? "Bellissimo! La conversazione parla di dati, insisto a dilungarmi senza mai produrre JSON."
            : JSON.stringify(RAW_MAP);
        res.setHeader("Content-Type", "application/json");
        if (isOllama) res.end(JSON.stringify({ message: { content } }));
        else res.end(JSON.stringify({ choices: [{ message: { content } }] }));
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

const MSGS = [];
const turns = [
  "Ciao, voglio costruire una dashboard delle spese in Python.",
  "Ottimo: parti da un modello dati minimale (data, categoria, importo, note) e da un caricamento CSV con pandas.",
  "Come normalizzo le date del CSV?",
  "Usa pd.to_datetime(df['data'], dayfirst=True) e crea df['mese'] con dt.to_period('M').",
  "Ora voglio stimare il budget del prossimo trimestre.",
  "Applica una media mobile trimestrale sulle somme mensili e correggi con le spese fisse note.",
  "Ultima cosa: come separo le categorie fisse dalle variabili?",
  "Una lista FISSE e una colonna derivata con apply: il report mostra due tabelle.",
  "Perfetto, grazie mille!",
];
turns.forEach((t, i) => MSGS.push({ role: i % 2 === 0 ? "user" : "assistant", text: t }));

async function main() {
  const MF = loadClient().MindFlowEngineClient;
  assert("engine-client.js caricato: planChapters esportato", typeof MF.planChapters === "function" && typeof MF.normalizeChapters === "function" && typeof MF.exchangeChapters === "function");

  // --- (1) planChapters OK con normalizzazione --------------------------------
  LAST.requests = 0;
  const srv1 = await startRecordingFake("map");
  let chapters = null;
  let err1 = null;
  try {
    chapters = await MF.planChapters({ kind: "ollama", baseUrl: "http://127.0.0.1:" + srv1.port, model: "gemma3:latest" }, MSGS);
  } catch (e) {
    err1 = e;
  }
  assert(
    "planChapters ok: capitoli normalizzati con copertura continua 1..N",
    !err1 && Array.isArray(chapters) && chapters.length === 2 && chapters[0].from === 1 && chapters[1].to === MSGS.length,
    err1 ? err1.message : JSON.stringify(chapters)
  );
  const contiguous = chapters.every((c, i) => c.from === (i === 0 ? 1 : chapters[i - 1].to + 1));
  assert("capitoli consecutivi senza buchi né sovrapposizioni", contiguous, JSON.stringify(chapters));
  assert(
    "chiamata planner Ollama con format:json e num_ctx adattivo (2048..12288, blocchi di 512)",
    LAST.requests === 1 && LAST.format === "json" && LAST.numCtx >= 2048 && LAST.numCtx <= 12288 && LAST.numCtx % 512 === 0,
    JSON.stringify(LAST)
  );
  srv1.close();

  // --- (2) MULTI-MOTORE: server OpenAI-compatibile ----------------------------
  LAST.requests = 0;
  const srv2 = await startRecordingFake("map");
  let chapters2 = null;
  let err2 = null;
  try {
    chapters2 = await MF.planChapters({ kind: "openai-compat", baseUrl: "http://127.0.0.1:" + srv2.port + "/v1", model: "local-chat" }, MSGS);
  } catch (e) {
    err2 = e;
  }
  assert(
    "planChapters con motore openai-compat: stessa mappa, senza campi Ollama",
    !err2 && Array.isArray(chapters2) && chapters2.length === 2 && LAST.requests === 1 && LAST.format === null && LAST.numCtx === null,
    err2 ? err2.message : JSON.stringify({ chapters2, LAST })
  );
  srv2.close();

  // --- (3) output improprio per 3 tentativi: errore DURE ----------------------
  LAST.requests = 0;
  const srv3 = await startRecordingFake("garbage");
  let err3 = null;
  try {
    await MF.planChapters({ kind: "ollama", baseUrl: "http://127.0.0.1:" + srv3.port, model: "gemma3:latest" }, MSGS);
  } catch (e) {
    err3 = e;
  }
  assert(
    "mappa impropria per 3 tentativi: errore vero, niente capitoli inventati",
    !!err3 && !err3.isNetwork && LAST.requests === 3,
    err3 ? err3.message + " requests=" + LAST.requests : "nessun errore"
  );
  srv3.close();

  // --- (4) auto-riparazione del modello anche nel planner ----------------------
  LAST.requests = 0;
  const srv4 = await startRecordingFake("map");
  let chapters4 = null;
  let err4 = null;
  try {
    chapters4 = await MF.planChapters({ kind: "ollama", baseUrl: "http://127.0.0.1:" + srv4.port, model: "gemma3" }, MSGS);
  } catch (e) {
    err4 = e;
  }
  assert(
    "planner con nome modello sbagliato: auto-riparazione gemma3 -> gemma3:latest",
    !err4 && Array.isArray(chapters4) && chapters4.length === 2 && LAST.requests === 2,
    err4 ? err4.message : "requests=" + LAST.requests
  );
  srv4.close();

  // --- (5) exchangeChapters: riserva per scambi --------------------------------
  const ex = MF.exchangeChapters(MSGS);
  let okEx = ex.length > 0 && ex[0].from === 1 && ex[ex.length - 1].to === MSGS.length;
  let contiguousEx = true;
  ex.forEach((c, i) => {
    if (i > 0 && c.from !== ex[i - 1].to + 1) contiguousEx = false;
  });
  const closedOnAsst = ex.every((c, i) => {
    // ogni capitolo si chiude su una risposta dell'assistente, TRANNE l'ultimo
    // quando la conversazione finisce con un turno utente senza risposta
    if (i === ex.length - 1 && c.to === MSGS.length) return true;
    return MSGS[c.to - 1] && MSGS[c.to - 1].role === "assistant";
  });
  assert(
    "exchangeChapters: copertura completa, consecutiva, chiusa su assistente (ultima coda tollerata)",
    okEx && contiguousEx && closedOnAsst,
    JSON.stringify(ex)
  );

  // --- (6) normalizeChapters: casi limite puri ---------------------------------
  const n1 = MF.normalizeChapters({ chapters: [{ title: "A", from: 3, to: 1 }] }, 5);
  assert("normalizeChapters: from/to invertiti e clamp", n1 && n1.length === 1 && n1[0].from === 1 && n1[0].to === 5, JSON.stringify(n1));
  const n2 = MF.normalizeChapters({ chapters: [{ title: "A", from: 1, to: 2 }, { title: "B", from: 4, to: 3 }] }, 5);
  assert("normalizeChapters: buco chiuso dal capitolo successivo", n2 && n2.length === 2 && n2[1].from === 3, JSON.stringify(n2));
  const many = [];
  for (let i = 0; i < 14; i++) many.push({ title: "C" + i, from: i + 1, to: i + 1 });
  const n3 = MF.normalizeChapters({ chapters: many }, 14);
  assert("normalizeChapters: oltre 10 capitoli fusi fino al limite", n3 && n3.length === 10, "n=" + (n3 ? n3.length : "null"));
  assert(
    "normalizeChapters: spazzatura -> null (mai capitoli inventati)",
    MF.normalizeChapters(null, 5) === null && MF.normalizeChapters({ chapters: [{ title: "x", from: "a", to: "b" }] }, 5) === null && MF.normalizeChapters({ chapters: [] }, 5) === null
  );

  // --- (7) reducedTranscript ----------------------------------------------------
  const longAsst = { role: "assistant", text: "R".repeat(3000) };
  const rt = MF.reducedTranscript([MSGS[0], longAsst, MSGS[1]]);
  const lines = rt.split("\n");
  assert(
    "reducedTranscript: numerato 1..N con etichette di ruolo e cap sul testo lungo",
    lines.length === 3 && lines[0].indexOf("1. [UTENTE]") === 0 && lines[1].indexOf("2. [ASSISTENTE]") === 0 && lines[1].length < 1700,
    "righe=" + lines.length + " len2=" + (lines[1] || "").length
  );

  console.log(fail === 0 ? "\nTUTTI PASSANO (" + pass + ")" : "\nFALLITI: " + fail + " su " + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERRORE TEST:", e);
  process.exit(1);
});
