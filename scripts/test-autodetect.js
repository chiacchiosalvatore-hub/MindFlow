/**
 * Test del rilevamento automatico di background.js senza browser:
 * carica il service worker in una VM con stub di chrome.runtime e fetch.
 * Scenario: Ollama attivo su 127.0.0.1:11434 con gemma3:4b e qwen2.5-coder:7b
 * (le altre porte chiuse), + scenario "nessun motore" + scenario LM Studio
 * (porta 1234 e, v1.2.2, porta 1235 — LM Studio sale di porta quando la
 * 1234 è occupata: il caso reale dell'utente).
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const code = fs.readFileSync(path.join(__dirname, "../mindflow-extension/background.js"), "utf8");

function makeSandbox({ ollamaUp, lmstudioUp, lmPort }) {
  const lm = lmPort || 1234;
  const listeners = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: async (url) => {
      const u = String(url);
      const refused = () => { const e = new Error("Failed to fetch"); throw e; };
      if (ollamaUp && /127\.0\.0\.1:11434\/api\/tags|localhost:11434\/api\/tags/.test(u)) {
        return {
          ok: true,
          json: async () => ({
            models: [
              { name: "gemma3:4b" },
              { name: "qwen2.5-coder:7b" },
            ],
          }),
        };
      }
      if (lmstudioUp && new RegExp("127\\.0\\.0\\.1:" + lm + "/v1/models|localhost:" + lm + "/v1/models").test(u)) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: "qwen2.5-7b-instruct" }] }),
        };
      }
      refused();
    },
    chrome: {
      runtime: {
        onMessage: { addListener: (fn) => listeners.push(fn) },
        openOptionsPage: () => {},
        sendMessage: () => {},
      },
      tabs: { create: () => {} },
      storage: { local: { get: () => {}, set: () => {} } },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "background.js" });
  return { listeners, sandbox };
}

function send(listeners, msg) {
  return new Promise((resolve) => {
    let responded = false;
    for (const fn of listeners) {
      const keepOpen = fn(msg, null, (resp) => {
        responded = true;
        resolve(resp);
      });
      if (keepOpen) return; // risposta asincrona
    }
    setImmediate(() => { if (!responded) resolve(undefined); });
  });
}

(async () => {
  // Scenario 1: Ollama attivo (il caso dell'utente)
  let { listeners } = makeSandbox({ ollamaUp: true, lmstudioUp: false });
  let r = await send(listeners, { type: "mindflow:autodetect" });
  console.log("[1] Ollama attivo ->", JSON.stringify(r));
  if (!r.ok) throw new Error("FAIL: atteso ok");
  if (r.best.kind !== "ollama" || r.best.baseUrl !== "http://127.0.0.1:11434") throw new Error("FAIL: engine errato");
  if (r.best.model !== "gemma3:4b") throw new Error("FAIL: modello predefinito errato: " + r.best.model);
  if (JSON.stringify(r.found.length) !== "1") throw new Error("FAIL: dedup mancante (127.0.0.1 vs localhost)");

  // engine-test con l'engine rilevato
  let t = await send(listeners, { type: "mindflow:engine-test", engine: { kind: r.best.kind, baseUrl: r.best.baseUrl, apiKey: "" } });
  console.log("[1b] engine-test ->", JSON.stringify(t));
  if (!t.ok || !t.models.includes("gemma3:4b")) throw new Error("FAIL: engine-test");

  // ping
  t = await send(listeners, { type: "mindflow:ping" });
  if (!t.ok || !t.version) throw new Error("FAIL: ping");

  // Scenario 2: nessun motore attivo
  ({ listeners } = makeSandbox({ ollamaUp: false, lmstudioUp: false }));
  r = await send(listeners, { type: "mindflow:autodetect" });
  console.log("[2] Nessun motore ->", r.ok, "|", (r.error || "").slice(0, 80) + "…");
  if (r.ok) throw new Error("FAIL: atteso ok=false");

  // Scenario 3: LM Studio attivo (nessun Ollama)
  ({ listeners } = makeSandbox({ ollamaUp: false, lmstudioUp: true }));
  r = await send(listeners, { type: "mindflow:autodetect" });
  console.log("[3] LM Studio attivo ->", JSON.stringify(r.best));
  if (!r.ok || r.best.kind !== "openai-compat" || r.best.baseUrl !== "http://127.0.0.1:1234") throw new Error("FAIL: LM Studio");
  if (r.best.model !== "qwen2.5-7b-instruct") throw new Error("FAIL: modello LM Studio");

  // Scenario 4 (v1.2.2): LM Studio attivo SOLO sulla 1235 — LM Studio parte
  // sulla 1234 ma se la trova occupata sceglie la successiva: il rilevamento
  // automatico deve vederlo lo stesso (il "bug" era solo la porta).
  ({ listeners } = makeSandbox({ ollamaUp: false, lmstudioUp: true, lmPort: 1235 }));
  r = await send(listeners, { type: "mindflow:autodetect" });
  console.log("[4] LM Studio su 1235 ->", JSON.stringify(r.best));
  if (!r.ok || r.best.kind !== "openai-compat" || r.best.baseUrl !== "http://127.0.0.1:1235") throw new Error("FAIL: LM Studio su 1235");
  if (r.best.model !== "qwen2.5-7b-instruct") throw new Error("FAIL: modello LM Studio 1235");
  if (!/LM Studio/.test(r.best.label)) throw new Error("FAIL: etichetta: " + r.best.label);

  console.log("\nTUTTI I TEST PASSANO ✔");
})().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
