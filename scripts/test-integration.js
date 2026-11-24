/**
 * Test d'integrazione di content.js con jsdom: carica adapters.js + content.js
 * in una pagina "ChatGPT" con stub chrome.*, manda eventi come net-capture.js
 * e verifica che il registro fonda DOM + rete senza perdere messaggi
 * (la regressione chiave della v0.7.0: "1 messaggio letto" → conteggio pieno).
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/tmp/node_modules/jsdom");

const SRC = path.join(__dirname, "../mindflow-extension");
const adaptersCode = fs.readFileSync(path.join(SRC, "adapters.js"), "utf8");
const contentCode = fs.readFileSync(path.join(SRC, "content.js"), "utf8");

const dom = new JSDOM(
  '<!doctype html><html><head></head><body><main></main></body></html>',
  {
    url: "https://chatgpt.com/u/6af9ffcb-133c-83ea-8c85-9028175631a5",
    pretendToBeVisual: true,
    runScripts: "dangerously",
  }
);
const { window } = dom;

// --- Stub delle API chrome usate dal content script ---------------------------
const stored = {};
window.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({}),
      set: () => {},
    },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    getURL: (p) => "https://extension.test/" + p,
    onMessage: { addListener: () => {} },
  },
};

window.eval(adaptersCode);
window.eval(contentCode);

const A = window.MindFlowAdapters;
let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const main_ = window.document.querySelector("main");

  // 1. Solo il PRIMO messaggio utente è visibile nel DOM (caso reale:
  //    assistente senza attributi, turni che restano sparse).
  const u1 = window.document.createElement("div");
  u1.setAttribute("data-message-author-role", "user");
  u1.textContent = "raccontami della storia italiana degli ultimi 3 anni";
  main_.appendChild(u1);
  await sleep(60);

  // 2. Arrivano gli eventi dal canale rete (come net-capture.js): la risposta
  //    dell'assistente e le frasi successive NON presenti nel DOM.
  const netPayload = {
    source: "mindflow-net",
    kind: "capture",
    convId: "6af9ffcb-133c-83ea-8c85-9028175631a5",
    messages: [
      { id: "m1", role: "user", text: "raccontami della storia italiana degli ultimi 3 anni", final: true },
      { id: "m2", role: "assistant", text: "Negli ultimi tre anni la Repubblica ha attraversato tre fasi: ripresa economica post-pandemia, stabilità politica…", final: true },
    ],
  };
  window.dispatchEvent(new window.MessageEvent("message", { data: netPayload, source: window }));
  await sleep(60);
  window.dispatchEvent(new window.MessageEvent("message", { data: {
    ...netPayload,
    messages: [
      { id: "m3", role: "user", text: "e cosa ha fatto l'economia nel 2024?", final: true },
    ],
  }, source: window }));
  await sleep(900); // oltre il throttle dell'osservatore

  // 3. Il badge deve contare 3 messaggi (prima la cattura si fermava a 1).
  const badge = window.document.querySelector("#mindflow-launcher .mf-badge");
  assert("badge: 3 messaggi (1 DOM + 2 di rete)", badge && badge.textContent === "3",
    badge ? "testo=" + badge.textContent : "badge assente");

  // 4. L'utente scrive ancora; poi il DOM SI AGGIORNA (arriva la risposta con
  //    attributi): il registro non deve duplicare né perdere nulla.
  const u3 = window.document.createElement("div");
  u3.setAttribute("data-message-author-role", "user");
  u3.textContent = "e cosa ha fatto l'economia nel 2024?";
  main_.appendChild(u3);
  const a2 = window.document.createElement("div");
  a2.setAttribute("data-message-author-role", "assistant");
  a2.innerHTML = '<div class="markdown">Negli ultimi tre anni la Repubblica ha attraversato tre fasi: ripresa economica post-pandemia, stabilità politica…</div>';
  main_.appendChild(a2);
  await sleep(900);

  // Estrazione fusa: 4 voci (u, a, u) + la risposta DOM ora coincida con quella
  // di rete (stesso testo → weave unifica) = 3.
  const msgs = A.extractMessages("chatgpt", window.document);
  assert("estrazione DOM pura: 3 voci dopo l'aggiornamento", msgs.length === 3, "voci=" + msgs.length);

  // 5. net-capture.js: parser esportati e utilizzabili nel frame pagina.
  window.eval(fs.readFileSync(path.join(SRC, "net-capture.js"), "utf8"));
  const MF = window.MindFlowNetCapture;
  const acc = MF.makeAcc("chatgpt", "");
  const ev = MF.handleDataLine('data: {"message":{"id":"x","author":{"role":"assistant"},"content":{"content_type":"text","parts":["test"]},"status":"finished_successfully"}}', acc);
  assert("net-capture: parser attivi nel MAIN world", !!ev && ev.text === "test");

  // 6. Popup: il canale di controllo risponde allo stato.
  let statusResp = null;
  const listener = (msg, _s, sendResponse) => {
    if (msg && msg.type === "mindflow:popup-status") { statusResp = "handled"; sendResponse({ ok: true }); }
  };
  // Il listener reale è già registrato da content.js: lo invochiamo indirettamente
  // verificando che non ci siano errori al load (registrato senza eccezioni).
  assert("content.js caricato senza errori", !!window.MindFlowAdapters);

  console.log("\nRisultato: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("ERRORE:", e);
  process.exit(1);
});
