/**
 * Test del parser di rete di net-capture.js con jsdom: verifica il protocollo
 * ChatGPT 2025/2026 a PATCH JSON (deltas con JSON Pointer), il protocollo
 * vecchio a messaggi completi, la continuation {"v":…}, le patch composite,
 * lo stato finished, e la chat GLM di prova (request body + delta SSE).
 * Esegue il file ESATTAMENTE come lo userebbe l'estensione.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/tmp/node_modules/jsdom");

const code = fs.readFileSync(
  path.join(__dirname, "../mindflow-extension/net-capture.js"),
  "utf8"
);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://chatgpt.com/",
  pretendToBeVisual: true,
  runScripts: "dangerously",
});
const { window } = dom;
window.eval(code);
const MF = window.MindFlowNetCapture;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

// --- Classificazione stream -------------------------------------------------
assert("streamKind: /backend-api/f/conversation -> chatgpt",
  MF.streamKind("https://chatgpt.com/backend-api/f/conversation?foo=1") === "chatgpt");
assert("streamKind: /backend-anon/f/conversation (chat ANONIMA) -> chatgpt",
  MF.streamKind("https://chatgpt.com/backend-anon/f/conversation") === "chatgpt",
  String(MF.streamKind("https://chatgpt.com/backend-anon/f/conversation")));
assert("streamKind: /backend-anon/f/conversation/prepare -> chatgpt (innocuo)",
  MF.streamKind("https://chatgpt.com/backend-anon/f/conversation/prepare") === "chatgpt");
assert("streamKind: /backend-api/conversation (vecchio) -> chatgpt",
  MF.streamKind("https://chat.openai.com/backend-api/conversation") === "chatgpt");
assert("streamKind: claude /completion", MF.streamKind("https://claude.ai/api/x/completion") === "claude");
assert("streamKind: chat GLM /api/mindflow/chat -> glmchat",
  MF.streamKind("https://preview-abc.space-z.ai/api/mindflow/chat") === "glmchat");
assert("streamKind: URL qualunque -> null", MF.streamKind("https://esempio.it/x") === null);

// --- Protocollo VECCHIO: messaggio completo ---------------------------------
const acc1 = MF.makeAcc("chatgpt", "u");
const ev1 = MF.handleDataLine(
  'data: {"message": {"id": "aa-1", "author": {"role": "user"}, "content": {"content_type": "text", "parts": ["Ciao, come stai?"]}, "status": "finished_successfully"}, "conversation_id": "conv-9"}',
  acc1
);
assert("vecchio protocollo: eco utente catturata",
  ev1 && ev1.role === "user" && ev1.text === "Ciao, come stai?" && ev1.final && ev1.id === "aa-1",
  JSON.stringify(ev1));
assert("vecchio protocollo: conversation_id salvato nell'accumulatore", acc1.convId === "conv-9");

// --- Protocollo NUOVO: messaggio completo avvolto in {"v": …} ----------------
const acc2 = MF.makeAcc("chatgpt", "u");
const ev2 = MF.handleDataLine(
  'data: {"v": {"message": {"id": "uu-1", "author": {"role": "user"}, "content": {"content_type": "text", "parts": ["Prima domanda."]}, "status": "finished_successfully"}, "conversation_id": "conv-77"}}',
  acc2
);
assert("nuovo protocollo: eco utente in v.message",
  ev2 && ev2.role === "user" && ev2.text === "Prima domanda." && ev2.id === "uu-1",
  JSON.stringify(ev2));

// --- Protocollo NUOVO: stream a patch dell'assistente ------------------------
// Sequenza reale: skeleton completo (senza testo) -> patch di contenuto ->
// continuation {"v":…} -> patch composita -> status finished.
const acc3 = MF.makeAcc("chatgpt", "u");

const sk = MF.handleDataLine(
  'data: {"v": {"message": {"id": "mm-1", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": [""]}, "status": "in_progress"}, "conversation_id": "conv-77"}}',
  acc3
);
assert("skeleton senza testo: nessun evento", sk === null, JSON.stringify(sk));

let ev = null;
ev = MF.handleDataLine('data: {"p": "/message/content/parts/0", "o": "append", "v": "Ciao! "}', acc3);
assert("patch: primo append con id ereditato dallo skeleton",
  ev && ev.role === "assistant" && ev.text === "Ciao! " && ev.id === "mm-1",
  JSON.stringify(ev));
ev = MF.handleDataLine('data: {"v": "Ecco la risposta."}', acc3);
assert("continuation {\"v\":…} senza p: testo cresce",
  ev && ev.text === "Ciao! Ecco la risposta.", JSON.stringify(ev));
ev = MF.handleDataLine(
  'data: {"o": "patch", "v": [{"p": "/message/content/parts/0", "o": "append", "v": " Ancora testo."}, {"p": "/message/metadata/fake", "o": "replace", "v": {"x": 1}}]}',
  acc3
);
assert("patch composita: append applicato, metadata ignorato",
  ev && ev.text === "Ciao! Ecco la risposta. Ancora testo.", JSON.stringify(ev));
ev = MF.handleDataLine('data: {"p": "/message/status", "o": "replace", "v": "finished_successfully"}', acc3);
assert("status finished: evento finale",
  ev && ev.final === true && ev.text === "Ciao! Ecco la risposta. Ancora testo.", JSON.stringify(ev));
assert("conversation_id da evento v.message", acc3.convId === "conv-77");

// --- Patch replace (snapshot completo della parte) ---------------------------
const acc4 = MF.makeAcc("chatgpt", "u");
MF.handleDataLine('data: {"v": {"message": {"id": "rr-1", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": [""]}, "status": "in_progress"}}}', acc4);
MF.handleDataLine('data: {"p": "/message/content/parts/0", "o": "append", "v": "par"}', acc4);
ev = MF.handleDataLine('data: {"p": "/message/content/parts/0", "o": "replace", "v": "testo completo sostituito"}', acc4);
assert("replace: testo sostituito (non concatenato)",
  ev && ev.text === "testo completo sostituito", JSON.stringify(ev));

// --- Patch su seconda parte (add /1) -----------------------------------------
ev = MF.handleDataLine('data: {"p": "/message/content/parts/1", "o": "add", "v": "seconda parte"}', acc4);
assert("add parte /1: nuova parte su nuova riga",
  ev && ev.text === "testo completo sostituito\nseconda parte", JSON.stringify(ev));

// --- Difesa: patch di metadata/value non testuali non inquinano ---------------
const acc5 = MF.makeAcc("chatgpt", "u");
MF.handleDataLine('data: {"v": {"message": {"id": "zz-1", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": [""]}, "status": "in_progress"}}}', acc5);
MF.handleDataLine('data: {"p": "/message/content/parts/0", "o": "append", "v": "testo vero"}', acc5);
ev = MF.handleDataLine('data: {"p": "/message/metadata/model_dil_v2/code", "o": "replace", "v": "DIL.render(...)"}', acc5);
assert("patch metadata: nessun emit superfluo", ev === null, JSON.stringify(ev));
// Continuation NON attribuibile dopo un metadata: viene SCARTATA (conservativo:
// meglio perdere un delta che inquinare il testo con stringhe di metadata).
ev = MF.handleDataLine('data: {"v": " che non si sa dove va"}', acc5);
assert("continuation dopo metadata: scartata, testo intatto", ev === null, JSON.stringify(ev));
// Un append esplicito riprende pulito dal testo vero.
ev = MF.handleDataLine('data: {"p": "/message/content/parts/0", "o": "append", "v": " e continua"}', acc5);
assert("dopo metadata: append esplicito riprende il testo pulito",
  ev && ev.text === "testo vero e continua", JSON.stringify(ev));
ev = MF.handleDataLine('data: {"v": {"arbitrary": "oggetto qualsiasi"}}', acc5);
assert("evento estraneo: nessun emit", ev === null, JSON.stringify(ev));

// --- Regressione Claude -------------------------------------------------------
const acc6 = MF.makeAcc("claude", "u");
ev = MF.handleDataLine('data: {"completion": "Ciao"}', acc6);
assert("claude: primo delta", ev && ev.text === "Ciao", JSON.stringify(ev));
ev = MF.handleDataLine('data: {"completion": "Ciao dall\\u2019assistente", "stop_reason": "end_turn"}', acc6);
assert("claude: cumulativo + final",
  ev && ev.text === "Ciao dall’assistente" && ev.final === true, JSON.stringify(ev));

// --- Chat GLM: request body + delta SSE --------------------------------------
const t1 = MF.lastGlmTurn('{"provider":"glm","systemPrompt":"…","messages":[{"role":"user","content":"prima"},{"role":"assistant","content":"risp"},{"role":"user","content":"seconda domanda"}]}');
assert("glm request: ultimo turno utente",
  t1 && t1.role === "user" && t1.text === "seconda domanda", JSON.stringify(t1));
assert("glm request: body vuoto -> null", MF.lastGlmTurn("") === null);
assert("glm request: body non JSON -> null", MF.lastGlmTurn("non json") === null);

const acc7 = MF.makeAcc("glmchat", "/api/mindflow/chat");
ev = MF.handleDataLine('data: {"type":"delta","v":"Risposta "}', acc7);
assert("glm delta: primo frammento con id stabile", ev && ev.role === "assistant" && ev.text === "Risposta " && ev.id, JSON.stringify(ev));
const glmId = ev.id;
ev = MF.handleDataLine('data: {"type":"delta","v":"in streaming"}', acc7);
assert("glm delta: accumulato e stesso id", ev && ev.text === "Risposta in streaming" && ev.id === glmId, JSON.stringify(ev));
ev = MF.handleDataLine('data: {"type":"done"}', acc7);
assert("glm done: evento finale", ev && ev.final === true, JSON.stringify(ev));

console.log("\nRisultato: " + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
