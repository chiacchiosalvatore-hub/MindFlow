/**
 * Test DOM reale di adapters.js con jsdom: replica gli scenari chiave della
 * pagina self-test e — da v0.8.0 — le forme REALI del DOM chatgpt.com 2025/2026
 * (verificate sul codice di un'estensione companion mantenuta attivamente).
 * Esegue il file ESATTAMENTE come lo userebbe l'estensione.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/tmp/node_modules/jsdom");

const code = fs.readFileSync(
  path.join(__dirname, "../mindflow-extension/adapters.js"),
  "utf8"
);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://chatgpt.com/",
  pretendToBeVisual: true,
  runScripts: "dangerously",
});
const { window } = dom;

// Esegue adapters.js NELLA pagina (globalThis = window di jsdom)
window.eval(code);
const A = window.MindFlowAdapters;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

function build(rootHtml) {
  const host = window.document.createElement("div");
  host.innerHTML = rootHtml;
  window.document.body.appendChild(host);
  return host;
}

// ===========================================================================
// CHATGPT — DOM reale 2026 "shell": ogni scambio è [data-turn-key] e contiene
// DENTRO la bolla utente E la risposta (niente data-message-author-role).
// È la forma che generava il bug "rileva solo la mia prima frase".
// ===========================================================================
const gptShell = build(
  '<div data-app-shell-main-surface="true">' +
    '<div data-thread-find-target="conversation">' +
      '<div data-turn-key="11111111-aaaa">' +
        '<div data-content-search-unit-key="unit-1:user">' +
          '<div data-user-message-bubble="true">' +
            '<div class="whitespace-pre-wrap">parlami della storia d\u2019Italia in poche righe</div>' +
          "</div>" +
        "</div>" +
        '<div data-content-search-unit-key="unit-1:assistant">' +
          '<div data-chatgpt-agent-turn-start="true"></div>' +
          '<div class="markdown prose"><p>La Storia d\u2019Italia è un percorso lungo.</p><p>Si divide in grandi fasi: Italia antica, medioevo, unità.</p></div>' +
          '<div class="action-bar"><button>Copia</button><button>Mostra altro</button><span data-testid="feedback-buttons">Buona risposta</span></div>' +
        "</div>" +
      "</div>" +
      '<div data-turn-key="22222222-bbbb">' +
        '<div data-content-search-unit-key="unit-2:user">' +
          '<div data-user-message-bubble="true">' +
            '<div class="whitespace-pre-wrap">approfondisci il Rinascimento</div>' +
          "</div>" +
        "</div>" +
        '<div data-content-search-unit-key="unit-2:assistant">' +
          '<div class="markdown prose"><p>Il Rinascimento nasce a Firenze nel Quattrocento.</p></div>' +
        "</div>" +
      "</div>" +
    "</div>" +
  "</div>" +
  '<form><div id="prompt-textarea" contenteditable="true" role="textbox"></div></form>'
);
const mShell = A.extractMessages("chatgpt", gptShell);
assert("chatgpt shell 2026: 4 messaggi (u,a,u,a)", mShell.length === 4,
  "trovati " + mShell.length + " -> " + JSON.stringify(mShell.map(m => m.role)));
assert("chatgpt shell 2026: ruoli uaua", mShell.map(m => m.role[0]).join("") === "uaua",
  JSON.stringify(mShell.map(m => m.role)));
assert("chatgpt shell 2026: prima domanda presente",
  mShell[0] && mShell[0].text.indexOf("parlami della storia") === 0,
  mShell[0] && mShell[0].text.slice(0, 50));
assert("chatgpt shell 2026: risposta presente (il bug era qui)",
  mShell.some(m => m.role === "assistant" && m.text.indexOf("La Storia") === 0),
  JSON.stringify(mShell.map(m => m.role + ":" + m.text.slice(0, 24))));
assert("chatgpt shell 2026: seconda risposta presente",
  mShell.some(m => m.role === "assistant" && m.text.indexOf("Il Rinascimento") === 0));
assert("chatgpt shell 2026: nessun pulsante nel testo",
  mShell.every(m => !/Copia|Mostra altro|Buona risposta/.test(m.text)),
  JSON.stringify(mShell.map(m => m.text.slice(0, 80))));
assert("chatgpt shell 2026: paragrafi separati da a capo",
  mShell.some(m => m.role === "assistant" && /\n/.test(m.text)));

// ===========================================================================
// CHATGPT — DOM legacy: holder con data-message-author-role dentro le sezioni
// ===========================================================================
const gpt = build(
  "<main>" +
    '<section data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="m1"><div class="whitespace-pre-wrap">Prima domanda.</div></div></section>' +
    '<section data-testid="conversation-turn-2"><div data-message-author-role="assistant" data-message-id="m2"><div class="markdown"><p>Prima risposta.</p></div></div></section>' +
  "</main>"
);
const mGpt = A.extractMessages("chatgpt", gpt);
assert("chatgpt legacy: 2 messaggi", mGpt.length === 2, "trovati " + mGpt.length);
assert("chatgpt legacy: ruoli u,a", mGpt.map(m => m.role[0]).join("") === "ua");

// --- ChatGPT: NESSUNA fusione di turni consecutivi dello stesso ruolo ------
const gptNoMerge = build(
  "<main>" +
    '<div data-message-author-role="user">Prima frase scritta.</div>' +
    '<div data-message-author-role="user">Seconda frase scritta subito dopo.</div>' +
    '<div data-message-author-role="user">Terza frase.</div>' +
  "</main>"
);
const mGptNM = A.extractMessages("chatgpt", gptNoMerge);
assert("chatgpt: 3 messaggi utente restano separati", mGptNM.length === 3, "trovati " + mGptNM.length);
assert("chatgpt: seconda frase presente", mGptNM.some(m => m.text.indexOf("Seconda frase") === 0));

// --- ChatGPT: dedup per PREFISSO (stessa bolla vista a due granularità) -----
const gptDup = build(
  "<main>" +
    '<div data-user-message-bubble="true"><div class="whitespace-pre-wrap">parlami della storia d\u2019Italia in poche righe e poi approfondiamo passo passo</div></div>' +
    '<div class="markdown">La storia d\u2019Italia in breve: peninsola al centro del Mediterraneo.</div>' +
  "</main>"
);
// Il messaggio utente compare DUE volte nel registro simulato: il secondo
// elemento ha lo stesso testo (la fusione per prefisso deve tenerne uno solo).
const firstDup = A.extractMessages("chatgpt", gptDup);
assert("chatgpt dedup: 2 messaggi da fixture singola", firstDup.length === 2,
  "trovati " + firstDup.length);

// Caso diretto: due messaggi stesso ruolo in rapporto di prefisso vengono fusi
const weaved = (function () {
  // usa il weaver interno passando dalla pagina di test? Non esposto: qui
  // verifichiamo il comportamento di messageElements con slot duplicati.
  const host = build(
    "<main>" +
      '<div data-turn-key="dup-1">' +
        '<div data-user-message-bubble="true"><div class="whitespace-pre-wrap">domanda ripetuta dal sito con testo lungo e distinguibile</div></div>' +
        '<div data-content-search-unit-key="d1:user"><div data-user-message-bubble2="x"><div class="whitespace-pre-wrap">domanda ripetuta dal sito con testo lungo e distinguibile</div></div></div>' +
        '<div class="markdown"><p>Risposta completa del modello.</p></div>' +
      "</div>" +
    "</main>"
  );
  const m = A.extractMessages("chatgpt", host);
  return m;
})();
assert("chatgpt dedup: bolla ripetuta collassata a 1 messaggio utente",
  weaved.filter(m => m.role === "user").length === 1,
  JSON.stringify(weaved.map(m => m.role + ":" + m.text.slice(0, 30))));

// --- ChatGPT: variante ANONIMA — scambio senza slot marcati, solo prosa -----
const gptAnon = build(
  '<div data-app-shell-main-surface="true">' +
    '<div data-thread-find-target="conversation">' +
      '<div data-turn-key="anon-1">' +
        '<div data-user-message-bubble="true"><div class="whitespace-pre-wrap">parlami dello staria d\u2019italia passo passo</div></div>' +
        '<div><div class="markdown">La Storia d\u2019Italia è il lungo percorso storico che ha portato all\u2019Italia che conosciamo oggi.</div></div>' +
      "</div>" +
    "</div>" +
  "</div>"
);
const mAnon = A.extractMessages("chatgpt", gptAnon);
assert("chatgpt anonimo: 2 messaggi", mAnon.length === 2, "trovati " + mAnon.length + " " + JSON.stringify(mAnon.map(m => m.role)));
assert("chatgpt anonimo: ruoli u,a", mAnon.map(m => m.role[0]).join("") === "ua",
  JSON.stringify(mAnon.map(m => m.role)));
assert("chatgpt anonimo: risposta NON collassata nel turno",
  mAnon.some(m => m.role === "assistant" && m.text.indexOf("La Storia") === 0));

// --- ChatGPT: inferenza strutturale su article senza attributi --------------
const gptTurns = build(
  "<main>" +
    '<article data-testid="conversation-turn-1"><div class="whitespace-pre-wrap">Domanda senza attributi noti.</div></article>' +
    '<article data-testid="conversation-turn-2"><div class="markdown">Risposta senza attributi noti.</div></article>' +
  "</main>"
);
const mGptT = A.extractMessages("chatgpt", gptTurns);
assert("chatgpt: inferenza ruoli su article (2 messaggi)", mGptT.length === 2, "trovati " + mGptT.length);
assert("chatgpt: ruoli inferiti u,a", mGptT.map(m => m.role[0]).join("") === "ua",
  JSON.stringify(mGptT.map(m => m.role)));

// --- ChatGPT: bolle utente senza risposta marcata (regressione) -------------
const gptBubbles = build(
  "<main>" +
    '<div data-user-message-bubble="true">Prima domanda della serie.</div>' +
    '<div data-user-message-bubble="true">Seconda domanda della serie.</div>' +
  "</main>"
);
const mGptB = A.extractMessages("chatgpt", gptBubbles);
assert("chatgpt: bolle utente separate (2 messaggi)", mGptB.length === 2, "trovati " + mGptB.length);

// --- ChatGPT: varianti data-conversation-role (riserva conservata) ----------
const gptConvRole = build(
  "<main>" +
    '<div data-turn-key="t1"><div data-conversation-role="user"><div class="whitespace-pre-wrap">Domanda con conversation-role.</div></div></div>' +
    '<div data-turn-key="t2"><div data-conversation-role="assistant"><div data-markdown-text-style="assistant-message">Risposta con conversation-role.</div></div></div>' +
  "</main>"
);
const mGptCR = A.extractMessages("chatgpt", gptConvRole);
assert("chatgpt conversation-role: 2 messaggi (niente collasso del turno)",
  mGptCR.length === 2 && mGptCR[0].role === "user" && mGptCR[1].role === "assistant",
  "trovati " + mGptCR.length + " " + JSON.stringify(mGptCR.map(m => m.role)));

// --- ChatGPT: scambio MAI accettato come messaggio unico --------------------
// Regressione diretta del bug d'origine: il contenitore [data-turn-key] non
// deve MAI diventare un messaggio "user" con dentro utente+risposta.
const dShell = A.diagnose("chatgpt", gptShell);
const turnExch = dShell.strategies.find(s => s.name === "turn-exchange");
assert("diagnose chatgpt shell: turn-exchange emette solo slot (4)",
  turnExch && turnExch.usable === 4,
  JSON.stringify(turnExch));
assert("diagnose chatgpt shell: sonde nuove presenti",
  dShell.probes["turn-key"] === 2 && dShell.probes["content-unit-user"] === 2 &&
  dShell.probes["agent-turn-start"] === 1,
  JSON.stringify({ tk: dShell.probes["turn-key"], cu: dShell.probes["content-unit-user"], ats: dShell.probes["agent-turn-start"] }));

// --- Streaming in corso: la prosa parziale dell'assistente è già leggibile --
const gptStream = build(
  '<div data-app-shell-main-surface="true"><div data-thread-find-target="conversation">' +
    '<div data-turn-key="st-1">' +
      '<div data-user-message-bubble="true"><div class="whitespace-pre-wrap">domanda durante lo streaming</div></div>' +
      '<div><div class="markdown">risposta in cors</div></div>' +
    "</div>" +
  "</div></div>"
);
const mStream = A.extractMessages("chatgpt", gptStream);
assert("chatgpt streaming: prosa parziale catturata",
  mStream.some(m => m.role === "assistant" && m.text.indexOf("risposta in cors") === 0),
  JSON.stringify(mStream.map(m => m.role + ":" + m.text.slice(0, 24))));

// --- Conversation key: /c/, /u/ e la variante ANONIMA /uc/ ------------------
assert("chiave chatgpt su /u/<id>",
  A.conversationKey("chatgpt", { pathname: "/u/6af9ffcb-133c-83ea-8c85-9028175631a5", search: "" }) ===
  "c-6af9ffcb-133c-83ea-8c85-9028175631a5");
assert("chiave chatgpt su /uc/<id> (chat anonima, URL dello screenshot)",
  A.conversationKey("chatgpt", { pathname: "/uc/6afa1128-c0f0-83ea-998c-a2d3128fd289", search: "" }) ===
  "c-6afa1128-c0f0-83ea-998c-a2d3128fd289",
  A.conversationKey("chatgpt", { pathname: "/uc/6afa1128-c0f0-83ea-998c-a2d3128fd289", search: "" }));
assert("chiave chatgpt su /c/<id> invariata",
  A.conversationKey("chatgpt", { pathname: "/c/abc12345-2222", search: "" }) === "c-abc12345-2222");
assert("chiave chatgpt stabile",
  A.conversationKey("chatgpt", { pathname: "/uc/abc12345-2222", search: "?x=1" }) ===
  A.conversationKey("chatgpt", { pathname: "/uc/abc12345-2222", search: "" }));

// --- ChatGPT: titolo generico della nuova UI --------------------------------
assert("titolo generico riconosciuto",
  A.conversationTitle("chatgpt", { title: "ChatGPT - Chat, Work, Create & Code with AI" }) === "ChatGPT");
assert("titolo anonimo “Chat · ChatGPT” ripulito",
  A.conversationTitle("chatgpt", { title: "Chat · ChatGPT" }) === "Chat",
  A.conversationTitle("chatgpt", { title: "Chat · ChatGPT" }));
assert("titolo reale di conversazione conservato",
  A.conversationTitle("chatgpt", { title: "Storia italiana - ChatGPT" }) === "Storia italiana");

// ===========================================================================
// CLAUDE / GEMINI / GLM — regressioni invariate
// ===========================================================================
const claude = build(
  "<main>" +
    '<div data-testid="user-message"><div class="grid-cols-1">Scrivi una funzione Python.</div></div>' +
    '<div data-testid="assistant-message"><div class="font-claude-message">Ecco la funzione.</div></div>' +
    '<div data-testid="user-message">Aggiungi la media mobile.</div>' +
    '<div data-testid="assistant-message"><div class="font-claude-message">rolling(3).mean().</div></div>' +
  "</main>" +
  '<fieldset><div class="ProseMirror" contenteditable="true" role="textbox"></div></fieldset>'
);
const mClaude = A.extractMessages("claude", claude);
assert("claude attuale: 4 messaggi (dedup annidati)", mClaude.length === 4, "trovati " + mClaude.length);
assert("claude attuale: ruoli uaua", mClaude.map(m => m.role[0]).join("") === "uaua");

const claudeStruct = build(
  '<main class="chat-thread">' +
    "<div class=\"turn\">Prima domanda senza nessun marcatore noto nel markup.</div>" +
    "<div class=\"turn\">Prima risposta dell'assistente, testo abbastanza lungo per la soglia.</div>" +
    "<div class=\"turn\">Seconda domanda dell'utente, ancora completamente senza marcatori.</div>" +
    "<div class=\"turn\">Seconda risposta dell'assistente, anche questa oltre la soglia minima.</div>" +
    '<footer><div class="ProseMirror" contenteditable="true" role="textbox"></div></footer>' +
  "</main>"
);
const mCs = A.extractMessages("claude", claudeStruct);
assert("claude strutturale: 4 messaggi", mCs.length === 4, "trovati " + mCs.length);
assert("claude strutturale: ruoli uaua", mCs.map(m => m.role[0]).join("") === "uaua",
  JSON.stringify(mCs.map(m => m.role[0])));

const claudeNoise = build(
  '<main class="chat-thread">' +
    "<div>Menu</div>" +
    "<div>Prima domanda abbastanza lunga per la soglia minima di sicurezza.</div>" +
    "<div>Risposta abbastanza lunga anch'essa per la soglia di sicurezza.</div>" +
    '<footer><div class="ProseMirror" contenteditable="true" role="textbox"></div></footer>' +
  "</main>"
);
const mCn = A.extractMessages("claude", claudeNoise);
assert("claude strutturale: blocco corto blocca la riserva (0 messaggi)", mCn.length === 0,
  "trovati " + mCn.length);

const gemini = build(
  "<main>" +
    "<user-query><div class=\"query-text\">Qual è la capitale del Friuli?</div></user-query>" +
    '<model-response><response-container><div class="response-container-content"><markdown>Trieste.</markdown></div></response-container></model-response>' +
  "</main>" +
  '<rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"></div></rich-textarea>'
);
const mGem = A.extractMessages("gemini", gemini);
assert("gemini attuale: 2 messaggi (classi interne deduplicate)", mGem.length === 2, "trovati " + mGem.length);
assert("gemini attuale: ruoli u,a", mGem[0].role === "user" && mGem[1].role === "assistant");

const glm = build(
  '<main id="mf-glm-chat">' +
    '<div data-mf-role="user"><div data-mf-text>Progettiamo una dashboard spese in Python.</div></div>' +
    '<div data-mf-role="assistant"><p>GLM</p><div data-mf-text>Parti da un modello dati minimale con pandas.</div></div>' +
    '<div data-mf-role="assistant"><div data-mf-text></div><span class="cursor">▍</span></div>' +
    '<div data-mf-role="user"><div data-mf-text>Come normalizzo le date?</div></div>' +
  "</main>" +
  '<textarea data-mf-input rows="1"></textarea>'
);
const mGlm = A.extractMessages("glmchat", glm);
assert("glmchat: 3 messaggi (streaming vuoto saltato)", mGlm.length === 3, "trovati " + mGlm.length);
assert("glmchat: ruoli uau", mGlm.map(m => m.role[0]).join("") === "uau");

// --- Diagnose: altre strategie riportate ------------------------------------
assert("diagnose chatgpt shell: strategie chiave riportate",
  dShell.strategies.some(s => s.name === "author-role") &&
  dShell.strategies.some(s => s.name === "turn-exchange") &&
  dShell.strategies.some(s => s.name === "turn-section"));
assert("diagnose chatgpt shell: la nuova strategia primaria è riportata",
  dShell.strategies.some(s => s.name === "turn-slots"));
const dCs = A.diagnose("claude", claudeStruct);
assert("diagnose claude strutturale: turn-blocks usable=4",
  dCs.strategies.find(s => s.name === "turn-blocks").usable === 4);

// ===========================================================================
// CHATGPT — v0.9.0: rete di sicurezza ASSOLUTA. Il sito rinnova di nuovo il
// markup: niente data-message-author-role, niente .markdown, niente chiavi
// search-unit. Restano SOLO article/turn-containers con bolla utente
// (.whitespace-pre-wrap) e paragrafi di prosa. La strategia "turn-slots"
// (contenitore -> slot utente + blocchi di testo) deve comunque leggere
// TUTTO: è la garanzia contro il ritorno del bug "solo la prima frase".
// ===========================================================================
const gptRenewed = build(
  "<main>" +
    "<article>" +
      '<div class="bubble"><div class="whitespace-pre-wrap">prima domanda del test di rinnovo totale</div></div>' +
      '<div class="answer"><p>Prima risposta completa del modello.</p><p>Secondo paragrafo della risposta.</p></div>' +
    "</article>" +
    "<article>" +
      '<div class="bubble"><div class="whitespace-pre-wrap">seconda domanda utente</div></div>' +
      '<div class="answer"><p>Risposta breve ma presente.</p></div>' +
    "</article>" +
  "</main>" +
  '<form><div id="prompt-textarea" contenteditable="true" role="textbox"></div></form>'
);
const mRen = A.extractMessages("chatgpt", gptRenewed);
assert("chatgpt rinnovo totale: 4 messaggi (u,a,u,a)", mRen.length === 4,
  "trovati " + mRen.length + " -> " + JSON.stringify(mRen.map(m => m.role)));
assert("chatgpt rinnovo totale: ruoli uaua", mRen.map(m => m.role[0]).join("") === "uaua",
  JSON.stringify(mRen.map(m => m.role + ":" + m.text.slice(0, 20))));
assert("chatgpt rinnovo totale: seconda risposta presente",
  mRen.some(m => m.role === "assistant" && m.text.indexOf("Risposta breve") === 0));
assert("chatgpt rinnovo totale: paragrafi uniti con a capo",
  mRen.some(m => m.role === "assistant" && /modello\.\n/.test(m.text)),
  JSON.stringify(mRen.map(m => m.text.slice(0, 40))));

// --- Prosа con classe rinominata (solo [class*="markdown" i]) ---------------
const gptMarkdownRenamed = build(
  "<main>" +
    '<article data-turn-key="k1">' +
      '<div class="whitespace-pre-wrap">domanda con prosa rinominata</div>' +
      '<div class="MarkdownRoot_xyz"><p>Risposta con wrapper Markdown rinominato.</p></div>' +
    "</article>" +
  "</main>" +
  '<form><div id="prompt-textarea" contenteditable="true" role="textbox"></div></form>'
);
const mMd = A.extractMessages("chatgpt", gptMarkdownRenamed);
assert("chatgpt prosa rinominata: 2 messaggi", mMd.length === 2,
  "trovati " + mMd.length + " -> " + JSON.stringify(mMd.map(m => m.role)));
assert("chatgpt prosa rinominata: testo risposta presente",
  mMd.some(m => m.role === "assistant" && m.text.indexOf("Risposta con wrapper") === 0));

// --- Contenitori annidati (article che avvolge [data-turn-key]) -------------
const gptNestedTurn = build(
  "<main>" +
    "<article>" +
      '<div data-turn-key="nested-1">' +
        '<div class="whitespace-pre-wrap">domanda in contenitore annidato</div>' +
        '<div class="markdown"><p>Risposta dal contenitore annidato.</p></div>' +
      "</div>" +
    "</article>" +
  "</main>" +
  '<form><div id="prompt-textarea" contenteditable="true" role="textbox"></div></form>'
);
const mNt = A.extractMessages("chatgpt", gptNestedTurn);
assert("chatgpt turn annidato: 2 messaggi (niente doppioni)", mNt.length === 2,
  "trovati " + mNt.length + " -> " + JSON.stringify(mNt.map(m => m.role + ":" + m.text.slice(0, 24))));
assert("chatgpt turn annidato: ruoli u,a", mNt.map(m => m.role[0]).join("") === "ua");

// --- Fuori da <main> non ci sono messaggi (landing, cookie banner) -----------
const gptOutsideMain = build(
  '<aside class="promo"><article><p>Testo marketing fuori dalla chat: NON è un messaggio e non deve apparire nel registro.</p></article></aside>' +
  "<main><article>" +
    '<div class="whitespace-pre-wrap">messaggio utente dentro main</div>' +
    '<div class="markdown"><p>Risposta dentro main.</p></div>' +
  "</article></main>" +
  '<form><div id="prompt-textarea" contenteditable="true" role="textbox"></div></form>'
);
const mOut = A.extractMessages("chatgpt", gptOutsideMain);
assert("chatgpt fuori main: solo i messaggi della chat (2)", mOut.length === 2,
  "trovati " + mOut.length + " -> " + JSON.stringify(mOut.map(m => m.role + ":" + m.text.slice(0, 30))));
assert("chatgpt fuori main: nessun testo marketing",
  mOut.every(m => !/marketing/.test(m.text)));

// ===========================================================================
// CHATGPT — v1.1.1: markup NUOVO TOTALE (bug "solo i miei messaggi" 2026).
// Niente article, niente data-turn-key, niente .markdown, nessun holder
// "assistant": restano SOLO le bolle utente con data-message-author-role e
// i paragrafi della risposta. La strategia "prose-between-users" deve
// ricostruire le risposte per intervalli tra una domanda e la successiva.
// ===========================================================================
const gptUnknown2026 = build(
  "<main>" +
    '<div class="gpt2026-row" data-message-author-role="user"><div class="q-text">Che cos\u2019è la Dorsale di Okinawa?</div></div>' +
    '<div class="gpt2026-row reply" data-msg-kind="ai"><div class="brand-new-wrap"><p>La Dorsale di Okinawa è una struttura oceanica.</p><p>Si estende per circa 1.200 km.</p></div></div>' +
    '<div class="gpt2026-row" data-message-author-role="user"><div class="q-text">Dove si trova esattamente?</div></div>' +
    '<div class="gpt2026-row reply" data-msg-kind="ai"><div class="brand-new-wrap"><p>Tra le isole Ryukyu e il Giappone meridionale.</p></div></div>' +
  "</main>" +
  '<form><div id="prompt-textarea" contenteditable="true" role="textbox"></div></form>'
);
const mUnk = A.extractMessages("chatgpt", gptUnknown2026);
assert("chatgpt markup 2026 sconosciuto: 4 messaggi (u,a,u,a)", mUnk.length === 4,
  "trovati " + mUnk.length + " -> " + JSON.stringify(mUnk.map(m => m.role)));
assert("chatgpt markup 2026 sconosciuto: ruoli uaua",
  mUnk.map(m => m.role[0]).join("") === "uaua",
  JSON.stringify(mUnk.map(m => m.role + ":" + m.text.slice(0, 24))));
assert("chatgpt markup 2026 sconosciuto: entrambe le risposte presenti",
  mUnk.some(m => m.role === "assistant" && /Dorsale di Okinawa è una struttura/.test(m.text)) &&
  mUnk.some(m => m.role === "assistant" && /isole Ryukyu/.test(m.text)));
assert("chatgpt markup 2026 sconosciuto: paragrafi della stessa risposta uniti",
  mUnk.filter(m => m.role === "assistant").every(m => !/oceanica\.$/.test(m.text) || /1\.200/.test(m.text)));

// --- Suggerimenti UI (bottoni) dopo l'ultima risposta: non nel testo ---------
const gptUnknownSuggestions = build(
  "<main>" +
    '<div data-message-author-role="user"><div>Raccontami la lanterna di Okinawa</div></div>' +
    '<div class="reply-unknown"><p>La lanterna di Okinawa è un oggetto tradizionale delle feste.</p></div>' +
    '<div class="suggestions" aria-hidden="false">' +
      '<button role="button">Approfondisci le feste</button>' +
      '<button role="button">Altro sulle tradizioni</button>' +
    "</div>" +
  "</main>" +
  '<form><div id="prompt-textarea" contenteditable="true" role="textbox"></div></form>'
);
const mSug = A.extractMessages("chatgpt", gptUnknownSuggestions);
assert("chatgpt markup 2026 + suggerimenti: 2 messaggi", mSug.length === 2,
  "trovati " + mSug.length + " -> " + JSON.stringify(mSug.map(m => m.role + ":" + m.text.slice(0, 20))));
assert("chatgpt markup 2026 + suggerimenti: risposta completa",
  mSug.some(m => m.role === "assistant" && /lanterna di Okinawa/.test(m.text)));
assert("chatgpt markup 2026 + suggerimenti: NESSUN testo di bottoni UI",
  mSug.every(m => !/Approfondisci|Altro sulle tradizioni/.test(m.text)),
  JSON.stringify(mSug.map(m => m.text.slice(0, 60))));

// ===========================================================================
// PAGINE GENERICHE (v1.1.0) — extractPageDocument: Wikipedia-like, documento
// senza titoli, pagina quasi senza testo (home di un motore di ricerca).
// DOM FRESH: le fixture chatgpt sopra restano nel body del primo window, qui
// serve una pagina pulita (il reader lavora sul documento INTERO).
// ===========================================================================

const dom2 = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://it.wikipedia.org/wiki/Guglielmo_Marconi",
  pretendToBeVisual: true,
  runScripts: "dangerously",
});
const win2 = dom2.window;
win2.eval(code);
const A2 = win2.MindFlowAdapters;

function build2(rootHtml) {
  const host = win2.document.createElement("div");
  host.innerHTML = rootHtml;
  win2.document.body.appendChild(host);
  return host;
}

// --- Voce wiki: contenuto principale + sezioni da h2 + nav/riferimenti buttati
build2(
  "<header id='mw-head'><nav><ul><li><a>Portale</a></li><li>Menu di navigazione con testo lungo abbastanza per essere un blocco</li></ul></nav></header>" +
    "<h1>Guglielmo Marconi</h1>" +
    "<main id='mw-content-text'>" +
      "<div class='mw-content-ltr'>" +
        "<p>Guglielmo Marconi è stato un inventore e imprenditore italiano, pioniere delle telecomunicazioni radio elettriche.</p>" +
        "<p>Nel 1909 ricevette il premio Nobel per la fisica insieme a Karl Ferdinand Braun.</p>" +
        "<h2 id='Primi_esperimenti'>Primi esperimenti</h2>" +
        "<p>A partire dal 1894 Marconi sviluppò la telegrafia senza fili nella proprieta di famiglia a Pontecchio.</p>" +
        "<p>L'esperimento decisivo arrivò nell'estate del 1895, con l'antenna verticale e la massa a terra.</p>" +
        "<div class='infobox'><p>Infobox: dati sintetici su Marconi che NON devono finire nel testo estratto.</p></div>" +
        "<h2 id='Trasatlantica'>Trasmissione transatlantica</h2>" +
        "<p>Il 12 dicembre 1901 Marconi ricevette a San Giovanni di Terranova il segnale trasmesso da Poldhu in Cornovaglia.</p>" +
        "<div class='reflist'><p>Riferimenti bibliografici che NON devono finire nel testo estratto.</p></div>" +
      "</div>" +
    "</main>" +
    "<footer id='footer'><p>Piede di pagina del sito: NON contenuto.</p></footer>"
);
const wDoc = A2.extractPageDocument(win2.document);
assert("pagina wiki: titolo dall'h1", wDoc.title === "Guglielmo Marconi",
  'title="' + wDoc.title + '"');
assert("pagina wiki: 3 sezioni (intro + 2 h2)", wDoc.sections.length === 3,
  "trovate " + wDoc.sections.length + " -> " + JSON.stringify(wDoc.sections.map(s => s.heading || "(intro)")));
assert("pagina wiki: heading corretti",
  wDoc.sections[1].heading === "Primi esperimenti" && wDoc.sections[2].heading === "Trasmissione transatlantica",
  JSON.stringify(wDoc.sections.map(s => s.heading)));
assert("pagina wiki: testo intro presente",
  wDoc.sections[0].text.indexOf("pioniere delle telecomunicazioni") !== -1);
assert("pagina wiki: nav/footer/infobox/reflist ESCLUSI",
  wDoc.sections.every(s => !/Infobox: dati|Riferimenti bibliografici|Menu di navigazione|Piede di pagina/.test(s.heading + s.text)));
assert("pagina wiki: corpo della sezione 2 presente",
  wDoc.sections[1].text.indexOf("telegrafia senza fili") !== -1);

// --- Pagina nuova (pulizia del body): documento senza titoli ----------------
win2.document.body.textContent = "";
let noHead = "<article>";
for (let p = 0; p < 40; p++) {
  noHead += "<p>Paragrafo " + p + " del documento lungo senza intestazioni: " +
    "testo tecnico ripetuto per arrivare oltre i duemila caratteri totali. ".repeat(8) + "</p>";
}
noHead += "</article>";
build2(noHead);
win2.document.title = "Documentazione tecnica di prova - Esempio";
const nDoc = A2.extractPageDocument(win2.document);
assert("pagina senza titoli: più sezioni sintetiche", nDoc.sections.length >= 2,
  "trovate " + nDoc.sections.length);
assert("pagina senza titoli: titolo dal <title> senza suffisso sito", nDoc.title === "Documentazione tecnica di prova",
  'title="' + nDoc.title + '"');
assert("pagina senza titoli: nessuna sezione minuscola",
  nDoc.sections.every(s => s.text.length >= 60));

// --- Pagina nuova (pulizia): quasi senza testo (home motore di ricerca) -----
win2.document.body.textContent = "";
build2(
  "<header><div class='menu'><p>Impostazioni</p></div></header>" +
    "<main><form><p>Cerca con Google</p></form></main>" +
    "<footer><ul><li>Privacy</li><li>Termini</li></ul></footer>"
);
win2.document.title = "Google";
const gDoc = A2.extractPageDocument(win2.document);
assert("home motore di ricerca: 0 sezioni (niente testo da mappare)", gDoc.sections.length === 0,
  "trovate " + gDoc.sections.length);

// --- hostId resta null per i siti non-chat (la modalità PAGINA parte lì) ----
assert("hostId(wikipedia.org) è null", A.hostId("it.wikipedia.org") === null);
assert("hostId(google.com) è null", A.hostId("www.google.com") === null);

console.log("\nRisultato: " + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
