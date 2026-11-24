/**
 * Test del flusso «Ollama blocca l'estensione» (v0.9.3).
 *
 * Simula Ollama in tre stati con un fetch mockato:
 *   BLOCCATO  -> GET /api/tags 200, POST /api/chat 403 (origine rifiutata)
 *   APERTO    -> GET /api/tags 200, POST /api/chat 404 (modello inesistente)
 *   SPENTO    -> fetch rifiutata (connessione)
 *
 * Verifica che:
 *   1. testEngine rilevi originBlocked SOLO nel caso bloccato (il GET passa);
 *   2. summarize esca subito con err.isOriginBlocked (niente secondi tentativi);
 *   3. il messaggio d'errore contenga la cura (OLLAMA_ORIGINS / Sblocca Ollama);
 *   4. i messaggi generici non abbiano la punteggiatura doppia («motore..»);
 *   5. il percorso aperto continui a funzionare (nessun falso positivo).
 */

const path = require("path");

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log("  OK  " + name);
  } else {
    failures++;
    console.log("FAIL  " + name + (extra ? "  -> " + extra : ""));
  }
}

function makeClient(statusMap) {
  const code = require("fs").readFileSync(
    path.join(__dirname, "..", "mindflow-extension", "engine-client.js"),
    "utf8"
  );
  const realFetch = global.fetch;
  global.fetch = function (url, opts) {
    const method = (opts && opts.method) || "GET";
    const key = method + " " + String(url);
    const hit = statusMap[key];
    if (hit === "NETERR") {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    return Promise.resolve({
      ok: hit === undefined || hit < 400,
      status: hit || 200,
      json: function () {
        return Promise.resolve(
          method === "GET" && String(url).indexOf("/api/tags") >= 0
            ? { models: [{ name: "gemma3:latest" }] }
            : {}
        );
      },
    });
  };
  globalThis.MindFlowEngineClient = undefined;
  // eslint-disable-next-line no-eval
  eval(code);
  const client = globalThis.MindFlowEngineClient;
  return {
    client: client,
    restore: function () {
      global.fetch = realFetch;
    },
  };
}

const ENGINE = { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "gemma3:latest" };
const TAGS = "GET http://127.0.0.1:11434/api/tags";
const CHAT = "POST http://127.0.0.1:11434/api/chat";

(async function run() {
  // ---------------------------------------------------------------- BLOCCATO
  console.log("\n[1] Ollama BLOCCATO (GET ok, POST 403)");
  let env = makeClient({ [TAGS]: 200, [CHAT]: 403 });
  try {
    const t = await env.client.testEngine(ENGINE);
    check("testEngine -> originBlocked", t.ok === false && t.originBlocked === true, JSON.stringify(t).slice(0, 120));
    check("testEngine elenco comunque i modelli", Array.isArray(t.models) && t.models[0] === "gemma3:latest");
    check("messaggio con la cura (OLLAMA_ORIGINS)", /OLLAMA_ORIGINS/.test(t.error || ""));
    check("messaggio con la guida (Sblocca Ollama)", /Sblocca Ollama/.test(t.error || ""));

    const started = Date.now();
    let err = null;
    try {
      await env.client.summarize(ENGINE, [{ role: "user", text: "ciao" }], "");
    } catch (e) {
      err = e;
    }
    check("summarize rifiuta con isOriginBlocked", !!(err && err.isOriginBlocked), String(err && err.message).slice(0, 120));
    check("esce subito (niente secondo tentativo da 1,2 s)", Date.now() - started < 1000, (Date.now() - started) + "ms");
    check("l'errore cita la guida", /Sblocca Ollama/.test((err && err.message) || ""));
  } finally {
    env.restore();
  }

  // ------------------------------------------------------------------- APERTO
  console.log("\n[2] Ollama APERTO alle estensioni (POST -> 404 modello inesistente)");
  env = makeClient({ [TAGS]: 200, [CHAT]: 404 });
  try {
    const t = await env.client.testEngine(ENGINE);
    check("testEngine -> ok (nessun falso positivo)", t.ok === true && !t.originBlocked, JSON.stringify(t).slice(0, 120));
    check("modelli letti", t.models && t.models[0] === "gemma3:latest");
  } finally {
    env.restore();
  }

  // ------------------------------------------------------------------ SPENTO
  console.log("\n[3] Ollama SPENTO (rete giù)");
  env = makeClient({ [TAGS]: "NETERR", [CHAT]: "NETERR" });
  try {
    const t = await env.client.testEngine(ENGINE);
    check("testEngine -> errore di RETE, non blocco", t.ok === false && !t.originBlocked && t.isNetwork === true, JSON.stringify(t).slice(0, 120));
  } finally {
    env.restore();
  }

  // ------------------------------------------- punteggiatura e errori generici
  console.log("\n[4] Messaggi generici (500 dal motore)");
  env = makeClient({ [TAGS]: 200, [CHAT]: 500 });
  try {
    let err = null;
    try {
      await env.client.summarize(ENGINE, [{ role: "user", text: "ciao" }], "");
    } catch (e) {
      err = e;
    }
    check("summarize fallisce (motore in errore)", !!err);
    check("niente punteggiatura doppia", !/\.\./.test(err.message), err.message.slice(0, 100));
    check("motore 500 NON scambiato per blocco origine", !err.isOriginBlocked);
  } finally {
    env.restore();
  }

  console.log("");
  if (failures) {
    console.log("ESITO: " + failures + " controllo/i FALLITI");
    process.exit(1);
  }
  console.log("ESITO: tutti i controlli OK");
})().catch(function (e) {
  console.error("Errore imprevisto del test:", e);
  process.exit(1);
});
