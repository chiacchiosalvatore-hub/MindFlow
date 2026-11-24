/**
 * MindFlow Companion — Cattura di rete (MAIN world).
 *
 * Questo file viene iniettato nella PAGINA (non nel content script isolato)
 * come <script src="chrome-extension://.../net-capture.js">: entra nel mondo
 * JavaScript del sito e osserva gli stream SSE con cui ChatGPT, Claude e la
 * chat GLM di prova consegnano i messaggi. È un canale di cattura INDIPENDENTE
 * dal DOM: anche se il sito rinnova il proprio markup, gli stream contengono
 * i messaggi completi con autore e testo, nel vero ordine della conversazione.
 *
 * Cosa osserva:
 *   ChatGPT  URL che contiene "/backend-api/" e "/conversation"
 *            -> protocollo VECCHIO: eventi {"message": {author.role,
 *               content.parts, status}, conversation_id}
 *            -> protocollo NUOVO (2025/2026): patch JSON stile JSON Pointer,
 *               es. {"p": "/message/content/parts/0", "o": "append", "v": "delta"},
 *               continuation {"v": "delta"}, composite {"o": "patch", "v": [...]}
 *               e messaggi completi avvolti {"v": {"message": …, "conversation_id": …}}.
 *            Il parser gestisce ENTRAMBI: è questo il motivo per cui la cattura
 *            funziona anche mentre OpenAI rinnova il trasporto.
 *   Claude   URL che contiene "/completion"
 *            -> eventi {"completion": "testo (cumulativo)"}
 *   GLM chat URL che contiene "/api/mindflow/chat" (banco di prova MindFlow)
 *            -> richiesta POST con la cronologia nel body (ultima voce = nuovo
 *               turno utente) e risposta SSE {"type":"delta","v":"…"}.
 *
 * Non intercetta nulla d'altro, non modifica richieste né risposte (la pagina
 * legge il suo stream originale: qui si legge solo una copia) e non invia
 * nulla fuori dalla pagina: i messaggi passano al content script via
 * window.postMessage con sorgente "mindflow-net".
 *
 * I parser sono esposti su globalThis.MindFlowNetCapture anche senza window,
 * così la pagina di test li verifica con gli stessi dati del mondo reale.
 */

(function () {
  "use strict";

  if (globalThis.__mindflowNetCapture) return;
  globalThis.__mindflowNetCapture = true;

  // Segnale di vita: il content script aspetta questo messaggio per sapere se
  // l'iniezione è partita davvero. Se il CSP della pagina (chatgpt.com è
  // molto severo) ha bloccato il <script src> DOM, non arriva mai e il
  // content script chiede al service worker l'iniezione via chrome.scripting
  // (world MAIN, immune al CSP). Doppia iniezione innocua: il guard sopra.
  try {
    window.postMessage({ source: "mindflow-net", kind: "alive" }, "*");
  } catch (_e0) {
    /* pagina in chiusura */
  }

  var MAX_TEXT = 24000; // diametro di sicurezza per un singolo messaggio

  // ---------------------------------------------------------------------------
  // Parser puri (verificati dai test jsdom)
  // ---------------------------------------------------------------------------

  function safeJson(line) {
    try {
      return JSON.parse(line);
    } catch (_e) {
      return null;
    }
  }

  /** Evento SSE ChatGPT (messaggio COMPLETO) -> {id, role, text, final, convId} | null.
   *  Considera solo messaggi utente/assistente testuali: gli eventi "tool"
   *  (ricerca web, esecuzioni) e i blocchi di reasoning non fanno parte
   *  della conversazione visibile. */
  function gptEvent(obj) {
    if (!obj || typeof obj !== "object") return null;
    var m = obj.message;
    if (!m || typeof m !== "object") return null;
    var role = m.author && m.author.role;
    if (role !== "user" && role !== "assistant") return null;
    var c = m.content;
    if (!c || c.content_type !== "text" || !Array.isArray(c.parts)) return null;
    var text = c.parts
      .filter(function (p) {
        return typeof p === "string";
      })
      .join("");
    if (!text) return null;
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
    return {
      id: typeof m.id === "string" ? m.id : null,
      role: role,
      text: text,
      final: m.status === "finished_successfully",
      convId: typeof obj.conversation_id === "string" ? obj.conversation_id : null,
    };
  }

  /** Puntatori di contenuto testuale nel nuovo protocollo a patch.
   *  "/message/content/parts" o "/message/content/parts/0", "/1", … */
  var CONTENT_PTR = /^\/message\/content\/parts(?:\/(\d+))?$/;

  function newPatchMsg(acc) {
    acc.patchCount = (acc.patchCount || 0) + 1;
    return {
      key: "gptp-" + (acc.rand || "s") + "-" + acc.patchCount,
      // L'id VERO visto nell'ultimo messaggio completo (skeleton) prevale sul
      // sintetico, così il content script aggiorna SEMPRE la stessa voce
      // invece di duplicarla. Solo per l'assistente: le patch non riguardano
      // l'eco dell'utente.
      id: acc.msgRole === "assistant" && acc.msgId ? acc.msgId : null,
      role: "assistant",
      text: "",
      final: false,
    };
  }

  /** Applica UNA patch {p, o, v} all'accumulatore dello stream corrente.
   *  Restituisce l'evento da emettere (o null). Solo i puntatori di contenuto
   *  testuale producono testo: metadata, reasoning, tool e DIL vengono ignorati
   *  (non fanno parte della conversazione visibile). */
  function applyGptPatch(patch, acc) {
    if (!patch || typeof patch !== "object") return null;
    var p = typeof patch.p === "string" ? patch.p : "";
    var op = typeof patch.o === "string" ? patch.o : "";
    var v = patch.v;
    if (p && CONTENT_PTR.test(p)) {
      acc.lastPtr = p; // i puntatori di contenuto sono i soli "continuabili"
    } else if (p) {
      acc.lastPtr = null;
    }

    if (p === "/conversation_id" && typeof v === "string" && v) {
      acc.convId = v;
      return null;
    }
    if (CONTENT_PTR.test(p)) {
      if (typeof v !== "string" || !v) return null; // parti non testuali: ignora
      if (!acc.patch) acc.patch = newPatchMsg(acc);
      // Se il messaggio corrente è già finito e arriva altro contenuto, è un
      // messaggio nuovo nello stesso stream: riparti pulito.
      if (acc.patch.final && acc.patch.text && v.indexOf(acc.patch.text) !== 0 && acc.patch.text.indexOf(v) !== 0) {
        acc.patch = newPatchMsg(acc);
      }
      var idx = (p.match(CONTENT_PTR) || [null, null])[1];
      if (op === "replace") {
        acc.patch.text = v;
      } else if (op === "add" && idx && idx !== "0") {
        acc.patch.text += "\n" + v; // parte aggiuntiva (es. secondo blocco)
      } else {
        // append (e add sulla parte 0): il testo cresce
        acc.patch.text += v;
      }
      if (acc.patch.text.length > MAX_TEXT) acc.patch.text = acc.patch.text.slice(0, MAX_TEXT);
      return patchEvent(acc);
    }
    if (p === "/message/status" && typeof v === "string") {
      if (!acc.patch) acc.patch = newPatchMsg(acc);
      acc.patch.final = /^finished/.test(v) || v === "success" || v === "complete";
      return patchEvent(acc);
    }
    if (p === "/message/author/role" && typeof v === "string") {
      if (acc.patch) acc.patch.role = v === "user" ? "user" : "assistant";
      return null;
    }
    if (p === "/message/id" && typeof v === "string" && v) {
      if (acc.patch) acc.patch.id = v;
      return null;
    }
    // Tutto il resto (metadata, recipient, model, DIL, …): nessun testo.
    return null;
  }

  /** Evento pronto per il content script dallo stato patch corrente. */
  function patchEvent(acc) {
    var pm = acc.patch;
    if (!pm || !pm.text) return null;
    var text = pm.text.length > MAX_TEXT ? pm.text.slice(0, MAX_TEXT) : pm.text;
    return {
      id: pm.id || pm.key,
      role: pm.role,
      text: text,
      final: !!pm.final,
      convId: acc.convId || null,
    };
  }

  /** Evento SSE ChatGPT nel protocollo corrente (full o patch) -> evento | null.
   *  Gestisce:
   *    {message: {...}, conversation_id}               full (vecchio)
   *    {v: {message: {...}, conversation_id}}          full (nuovo, avvolto)
   *    {o: "patch", v: [ {p,o,v}, … ]}                 composite
   *    {p: "/message/…", o: "append|replace|add", v: …} patch singola
   *    {v: "delta"}                                    continuation dell'ultimo ptr
   */
  function gptUpdate(obj, acc) {
    if (!obj || typeof obj !== "object") return null;

    // 1) Messaggio completo (diretto o dentro v)
    var full = obj.message
      ? obj
      : obj.v && typeof obj.v === "object" && !Array.isArray(obj.v) && obj.v.message
        ? obj.v
        : null;
    if (full && full.message) {
      if (typeof full.conversation_id === "string" && full.conversation_id) acc.convId = full.conversation_id;
      var m = full.message;
      // L'id/ruolo del messaggio pieno diventa il default dello stream che
      // segue: le patch di contenuto erediteranno l'id vero invece di uno
      // sintetico (e SOLO se è l'assistente: le patch non riguardano l'utente).
      if (m && typeof m.id === "string" && m.id) {
        acc.msgId = m.id;
        acc.msgRole = (m.author && m.author.role) || "assistant";
      } else {
        acc.msgId = null;
        acc.msgRole = (m && m.author && m.author.role) || "assistant";
      }
      if (acc.msgRole !== "assistant") {
        acc.lastPtr = null;
        acc.patch = null; // l'eco dell'utente chiude lo stream corrente
      }
      var ev = gptEvent(full);
      return ev || null; // skeleton senza testo: niente emit, ma i default restano
    }

    // 2) Composite: {"o": "patch", "v": [sotto-patch…]}
    if (obj.o === "patch" && Array.isArray(obj.v)) {
      var out = null;
      for (var i = 0; i < obj.v.length; i++) {
        var sub = gptUpdate(obj.v[i], acc);
        if (sub) out = sub; // l'ultima vince: il testo cresce in ordine
      }
      return out;
    }

    // 3) Patch singola {p, o, v}
    if (typeof obj.p === "string") {
      return applyGptPatch(obj, acc);
    }

    // 4) Continuation {"v": …}: continua l'ultimo puntatore di contenuto
    if (obj.v !== undefined && obj.p === undefined && obj.o === undefined) {
      if (typeof obj.v === "string") {
        if (acc.lastPtr && CONTENT_PTR.test(acc.lastPtr)) {
          return applyGptPatch({ p: acc.lastPtr, o: "append", v: obj.v }, acc);
        }
        return null;
      }
      if (typeof obj.v === "object" && obj.v) {
        return gptUpdate(obj.v, acc); // avvolto di nuovo (raro ma visto)
      }
      return null;
    }

    return null;
  }

  /** Evento SSE Claude -> aggiorna l'accumulatore dello stream corrente e
   *  restituisce {role:"assistant", text, final} | null. Il campo
   *  "completion" arriva in genere cumulativo ( testo che cresce ): se una
   *  riga non inizia con il testo già visto lo consideriamo un delta e lo
   *  concateniamo, così entrambe le varianti funzionano. */
  function claudeEvent(obj, acc) {
    if (!obj || typeof obj !== "object") return null;
    var t = obj.completion;
    if (typeof t !== "string" || !t) return null;
    if (acc.text && t.indexOf(acc.text) === 0) {
      acc.text = t; // cumulativo
    } else if (!acc.text || t !== acc.text) {
      acc.text = (acc.text || "") + t; // delta
    }
    if (acc.text.length > MAX_TEXT) acc.text = acc.text.slice(0, MAX_TEXT);
    return {
      id: acc.key || null,
      role: "assistant",
      text: acc.text,
      final: !!(obj.stop_reason || obj.stop || obj.messageStop),
    };
  }

  /** Evento SSE della chat GLM (banco di prova MindFlow).
   *  {"type":"delta","v":"…"} -> testo in crescita; "done"/"error" -> final. */
  function glmEvent(obj, acc) {
    if (!obj || typeof obj !== "object") return null;
    if (obj.type === "delta" && typeof obj.v === "string" && obj.v) {
      acc.text = (acc.text || "") + obj.v;
      if (acc.text.length > MAX_TEXT) acc.text = acc.text.slice(0, MAX_TEXT);
      if (!acc.key) acc.key = "glml-" + (acc.rand || Math.random().toString(36).slice(2, 10));
      return { id: acc.key, role: "assistant", text: acc.text, final: false, convId: null };
    }
    if ((obj.type === "done" || obj.type === "error") && acc.text) {
      return { id: acc.key, role: "assistant", text: acc.text, final: true, convId: null };
    }
    return null;
  }

  /** Body JSON della richiesta /api/mindflow/chat -> ultimo turno utente.
   *  La cronologia c'è tutta, ma i turni precedenti sono già nel registro:
   *  l'ultima voce è l'UNICA informazione nuova della richiesta. */
  function lastGlmTurn(rawBody) {
    if (typeof rawBody !== "string" || !rawBody) return null;
    var parsed = safeJson(rawBody);
    if (!parsed || !Array.isArray(parsed.messages) || !parsed.messages.length) return null;
    var last = parsed.messages[parsed.messages.length - 1];
    if (!last || (last.role !== "user" && last.role !== "assistant")) return null;
    var text = typeof last.content === "string" ? last.content : "";
    if (!text) return null;
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
    return { role: last.role, text: text };
  }

  /** Classifica un URL di stream: "chatgpt" | "claude" | "glmchat" | null.
   *  ChatGPT usa DUE percorsi secondo l'account:
   *    - /backend-api/f/conversation   (utente autenticato)
   *    - /backend-anon/f/conversation  (chat ANONIMA senza login: era il caso
   *      dell'utente, prima la cattura di rete qui non si attivava mai) */
  function streamKind(url) {
    var u = String(url || "");
    if (
      (u.indexOf("/backend-api/") !== -1 || u.indexOf("/backend-anon/") !== -1) &&
      u.indexOf("/conversation") !== -1
    ) {
      return "chatgpt";
    }
    if (u.indexOf("/completion") !== -1) return "claude";
    if (u.indexOf("/api/mindflow/chat") !== -1) return "glmchat";
    return null;
  }

  var MF = {
    gptEvent: gptEvent,
    gptUpdate: gptUpdate,
    applyGptPatch: applyGptPatch,
    claudeEvent: claudeEvent,
    glmEvent: glmEvent,
    lastGlmTurn: lastGlmTurn,
    streamKind: streamKind,
    safeJson: safeJson,
  };
  globalThis.MindFlowNetCapture = MF;

  // ---------------------------------------------------------------------------
  // Buffer di righe per stream fetch (lettura in parallelo alla pagina)
  // ---------------------------------------------------------------------------

  function makeAcc(kind, url) {
    return {
      kind: kind,
      url: url,
      text: "",
      key: null,
      seq: 0,
      rand: Math.random().toString(36).slice(2, 10),
      // Stato del protocollo ChatGPT a patch:
      patch: null, // messaggio corrente costruito a patch
      patchCount: 0,
      lastPtr: null, // ultimo puntatore di contenuto (per le continuation {"v":…})
      convId: null,
      msgId: null, // id/ruolo visti nell'ultimo messaggio completo
      msgRole: null,
    };
  }

  /** Processa UNA riga "data: ..." e aggiorna l'accumulatore.
   *  Restituisce l'evento pronto (o null). */
  function handleDataLine(line, acc) {
    var payload = line.replace(/^data:\s?/, "").trim();
    if (!payload || payload === "[DONE]") return null;
    var obj = safeJson(payload);
    if (!obj) return null;
    if (acc.kind === "chatgpt") {
      var ev = gptUpdate(obj, acc);
      if (ev) acc.seq++;
      return ev;
    }
    if (acc.kind === "claude") {
      if (!acc.key) acc.key = "claude-" + acc.rand;
      var evC = claudeEvent(obj, acc);
      if (evC) acc.seq++;
      return evC;
    }
    if (acc.kind === "glmchat") {
      var evG = glmEvent(obj, acc);
      if (evG) acc.seq++;
      return evG;
    }
    return null;
  }

  // Parser puri esportati PRIMA del guard ambientale: i test (jsdom non ha
  // fetch) e il debug li usano anche fuori dalla pagina.
  MF.makeAcc = makeAcc;
  MF.handleDataLine = handleDataLine;

  // Solo dentro una pagina con fetch: da qui in poi solo hook di rete.
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  // ---------------------------------------------------------------------------
  // Invio al content script (throttled: un postMessage ogni 350 ms)
  // ---------------------------------------------------------------------------

  var pending = {};
  var lastConvId = null;
  var flushTimer = null;

  function emit(ev, acc) {
    var key = (ev.id || acc.key || "s" + acc.seq) + "|" + ev.role;
    pending[key] = { id: ev.id, role: ev.role, text: ev.text, final: !!ev.final, kind: acc.kind };
    if (ev.convId) lastConvId = ev.convId;
    if (!flushTimer) {
      flushTimer = setTimeout(flush, 350);
    }
  }

  function flush() {
    flushTimer = null;
    var msgs = [];
    for (var k in pending) {
      if (Object.prototype.hasOwnProperty.call(pending, k)) msgs.push(pending[k]);
    }
    pending = {};
    if (!msgs.length) return;
    try {
      window.postMessage(
        { source: "mindflow-net", kind: "capture", convId: lastConvId, messages: msgs },
        "*"
      );
    } catch (_e) {
      /* pagina in chiusura */
    }
  }

  /** Estrae l'ultimo turno dal body della richiesta GLM e lo emette. */
  function emitGlmRequest(init) {
    try {
      var body = init && typeof init.body === "string" ? init.body : "";
      var turn = lastGlmTurn(body);
      if (!turn) return;
      emit(
        { id: "glmu-" + Math.random().toString(36).slice(2, 10), role: turn.role, text: turn.text, final: true },
        { kind: "glmchat", key: null, seq: 0 }
      );
    } catch (_e) {
      /* corpo non leggibile: resta la cattura DOM */
    }
  }

  // ---------------------------------------------------------------------------
  // Hook fetch: legge una CLONE della risposta, la pagina usa l'originale
  // ---------------------------------------------------------------------------

  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = "";
    try {
      url = typeof input === "string" ? input : (input && input.url) || "";
    } catch (_e) {
      url = "";
    }
    var kind = streamKind(url);
    var p = origFetch.apply(this, arguments);
    if (!kind) return p;
    // La chat GLM porta il nuovo turno utente nel BODY della richiesta.
    if (kind === "glmchat") emitGlmRequest(init);
    // Mai in modo bloccante: la risposta della pagina non viene toccata.
    p.then(function (res) {
      try {
        var copy = res.clone();
        if (!copy.body || typeof copy.body.getReader !== "function") return;
        var reader = copy.body.getReader();
        var dec = new TextDecoder();
        var acc = makeAcc(kind, url);
        var buf = "";
        var pump = function () {
          reader
            .read()
            .then(function (r) {
              if (r.done) return;
              buf += dec.decode(r.value, { stream: true });
              var idx;
              while ((idx = buf.indexOf("\n")) >= 0) {
                var line = buf.slice(0, idx).replace(/\r$/, "");
                buf = buf.slice(idx + 1);
                if (/^data:/.test(line)) {
                  try {
                    var ev = handleDataLine(line, acc);
                    if (ev) emit(ev, acc);
                  } catch (_e2) {
                    /* riga malformata: la prossima riparte pulita */
                  }
                }
              }
              pump();
            })
            .catch(function () {
              /* stream interrotto dalla pagina: fine */
            });
        };
        pump();
      } catch (_e3) {
        /* niente body leggibile: resta la cattura DOM */
      }
    }).catch(function () {
      /* errore di rete della pagina: nessuna azione */
    });
    return p;
  };

  // ---------------------------------------------------------------------------
  // Hook XHR (alcuni client usano XHR per gli stream)
  // ---------------------------------------------------------------------------

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__mfUrl = String(url || "");
      this.__mfKind = streamKind(this.__mfUrl);
      this.__mfPos = 0;
    } catch (_e) {
      this.__mfKind = null;
    }
    return origOpen.apply(this, arguments);
  };

  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (xhr.__mfKind) {
      xhr.addEventListener("progress", function () {
        try {
          var full = xhr.responseText || "";
          if (full.length <= xhr.__mfPos) return;
          var chunk = full.slice(xhr.__mfPos);
          xhr.__mfPos = full.length;
          if (!xhr.__mfAcc) xhr.__mfAcc = makeAcc(xhr.__mfKind, xhr.__mfUrl);
          var lines = chunk.split("\n");
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/\r$/, "");
            if (/^data:/.test(line)) {
              var ev = handleDataLine(line, xhr.__mfAcc);
              if (ev) emit(ev, xhr.__mfAcc);
            }
          }
        } catch (_e) {
          /* risposta non testuale */
        }
      });
    }
    return origSend.apply(this, arguments);
  };
})();
