/**
 * MindFlow Companion — Content script.
 *
 * Non altera la chat: aggiunge solo
 *   1. una pillola discreta sul bordo destro (launcher),
 *   2. un pannello laterale in iframe (pagina dell'estensione) apribile,
 *   3. la lettura passiva dei messaggi su DUE canali:
 *        a) DOM (MutationObserver + poll SPA + adattatori),
 *        b) rete: gli stream SSE osservati da net-capture.js nel MAIN world,
 *           indipendenti dal markup del sito (ChatGPT e Claude);
 *      i due canali si fondono in un registro accumulato della sessione,
 *      immune alla virtualizzazione dei turni lunghi,
 *   4. l'iniezione del contesto compilato nel prompt del sito,
 *   5. un piccolo canale di controllo per il popup della barra strumenti.
 *
 * La pagina host non riceve nulla; l'iframe non vede il DOM del sito:
 * tutta la lettura avviene qui e i messaggi passano via postMessage.
 */

(function () {
  "use strict";

  var A = globalThis.MindFlowAdapters;
  if (!A) return;
  // v1.1.0: su un host NON-chat il content script entra in MODALITÀ PAGINA:
  // legge il documento principale (reader generico in adapters.js) e lo
  // consegna alla stessa pipeline del pannello. Le chat restano su adapter.
  var host = A.hostId(location.host);
  var genericMode = false;
  if (!host) {
    genericMode = true;
    host = "page";
  }
  if (window.top !== window.self) return; // solo nel frame principale

  var PANEL_WIDTH = 384;
  var STUDIO_WIDTH = "min(62vw, 820px)";
  var REGISTRY_CAP = 400;
  var frame = null;
  var iframe = null;
  var launcher = null;
  var badge = null;
  var isOpen = false;
  var lastSig = null;
  var lastEls = [];
  var started = false;
  var lastBadgeCount = -1;
  var collecting = false;
  var collectCanceled = false; // v1.1.4: «Annulla» dal pannello ferma lo scorrimento
  var lastStats = { dom: 0, net: 0, total: 0 };

  // ---------------------------------------------------------------------------
  // Registro della sessione (DOM + rete)
  // ---------------------------------------------------------------------------

  /** Stream vivo osservato dalla rete: ordine vero di arrivo, testi che
   *  crescono durante lo streaming. Gli id del sito tengono insieme i turni. */
  var net = { convId: null, stream: [], ids: {} };

  /** Accumulo della sessione: la fusione DOM+rete del momento, storicizzata.
   *  Se il sito virtualizza i turni (restano nel DOM solo quelli visibili),
   *  le voci già viste restano qui invece di sparire. */
  var registry = [];
  var registryKey = null; // convKey del registro (reset al cambio chat)

  function normKey(role, text) {
    var t = String(text || "").replace(/\s+/g, " ").trim().slice(0, 120);
    return (role === "user" ? "u" : "a") + ":" + t.toLowerCase();
  }

  /** Trova in list (da index in poi) la prima voce che corrisponde alla chiave
   *  (prefisso normalizzato, nei due versi per testi che crescono). */
  function findMatch(list, from, role, text) {
    var k = normKey(role, text);
    for (var i = from; i < list.length; i++) {
      var kk = normKey(list[i].role, list[i].text);
      if (kk === k) return i;
      var short = k.length < kk.length ? k : kk;
      var long = short === k ? kk : k;
      if (long.indexOf(short) === 0 && short.length >= 24) return i;
    }
    return -1;
  }

  /**
   * Fonde due liste ordinate (entrambe sottosequenze della conversazione vera)
   * in un'unione che conserva l'ordine: doppio puntatore con sguardo in avanti.
   * A parità di voce vince il testo più lungo (lo streaming cresce).
   */
  function weave(a, b) {
    if (!a.length) return b.slice();
    if (!b.length) return a.slice();
    var out = [];
    var i = 0;
    var j = 0;
    while (i < a.length && j < b.length) {
      var ka = normKey(a[i].role, a[i].text);
      var kb = normKey(b[j].role, b[j].text);
      if (ka === kb) {
        out.push(a[i].text.length >= b[j].text.length ? a[i] : b[j]);
        i++;
        j++;
        continue;
      }
      var aInB = findMatch(b, j + 1, a[i].role, a[i].text);
      var bInA = findMatch(a, i + 1, b[j].role, b[j].text);
      if (bInA !== -1 && (aInB === -1 || bInA - i <= aInB - j)) {
        // b[j] viene prima nell'ordine vero: è assente in a o più avanti lì.
        out.push(b[j]);
        j++;
      } else {
        out.push(a[i]);
        i++;
      }
    }
    while (i < a.length) out.push(a[i++]);
    while (j < b.length) out.push(b[j++]);
    return out;
  }

  /** Eventi dal MAIN world (net-capture.js): aggiorna lo stream vivo.
   *  "alive" è il segnale di vita dell'iniezione (vedi injectNetCapture). */
  function onNetMessage(d) {
    if (!d || d.source !== "mindflow-net") return;
    if (d.kind === "alive") {
      netAlive = true;
      return;
    }
    if (!Array.isArray(d.messages)) return;
    if (typeof d.convId === "string" && d.convId) net.convId = d.convId;
    d.messages.forEach(function (m) {
      if (!m || (m.role !== "user" && m.role !== "assistant")) return;
      var text = String(m.text || "");
      if (!text) return;
      if (m.id && net.ids[m.id] !== undefined) {
        var cur = net.stream[net.ids[m.id]];
        if (text.length >= cur.text.length) cur.text = text;
        cur.final = !!m.final || cur.final;
        return;
      }
      if (m.id) {
        net.ids[m.id] = net.stream.length;
        net.stream.push({ id: m.id, role: m.role, text: text, final: !!m.final });
        return;
      }
      // Senza id (stream Claude): aggiorna l'ultima voce assistente se è
      // lo stesso testo cresciuto, altrimenti è un nuovo turno.
      for (var i = net.stream.length - 1; i >= 0 && i >= net.stream.length - 3; i--) {
        var prev = net.stream[i];
        if (prev.role !== "assistant" || prev.id) continue;
        if (text.indexOf(prev.text) === 0) {
          prev.text = text;
          prev.final = !!m.final || prev.final;
          return;
        }
      }
      net.stream.push({ id: null, role: m.role, text: text, final: !!m.final });
    });
    if (net.stream.length > REGISTRY_CAP) {
      net.stream = net.stream.slice(-REGISTRY_CAP);
      net.ids = {};
      net.stream.forEach(function (e, idx) {
        if (e.id) net.ids[e.id] = idx;
      });
    }
  }

  function resetSessionData() {
    net.convId = null;
    net.stream = [];
    net.ids = {};
    registry = [];
  }

  // --- Modalità PAGINA (host non-chat: Wikipedia, articoli, documentazione) ---

  /** Estrazione della pagina, con cache: ricalcola solo se cambia URL o titolo
   *  (o quando la raccolta la chiede espressamente). Su una pagina normale il
   *  poll ogni 2,5 s non costa nulla. */
  var pageInfo = { title: "", sections: [], chars: 0, extractedAt: 0 };
  var pageSig = null;
  function ensurePageInfo(force) {
    var sig = location.href.split("#")[0] + "|" + document.title;
    if (!force && sig === pageSig && Date.now() - pageInfo.extractedAt < 30000) return;
    pageSig = sig;
    try {
      var d = A.extractPageDocument(document);
      pageInfo.title = d.title;
      pageInfo.sections = Array.isArray(d.sections) ? d.sections : [];
      pageInfo.chars = d.chars || 0;
    } catch (_e) {
      /* pagina in transizione: resta il valore precedente */
    }
    pageInfo.extractedAt = Date.now();
  }

  /** La pagina diventa una "conversazione": 1 messaggio di apertura (il
   *  documento, ruolo utente) + una voce per sezione (ruolo assistente). La
   *  pipeline dei capitoli resta UNA: il motore raggruppa le sezioni. */
  function pageMessages() {
    ensurePageInfo(false);
    var msgs = [];
    var url = location.href.split("#")[0];
    if (pageInfo.title) {
      msgs.push({ role: "user", text: ("Documento: «" + pageInfo.title + "» — " + url).slice(0, 260) });
    }
    pageInfo.sections.forEach(function (s) {
      var text = (s.heading ? s.heading + "\n\n" : "") + s.text;
      if (text && text.length >= 40) msgs.push({ role: "assistant", text: text });
    });
    return msgs;
  }

  function convInfo() {
    if (genericMode) {
      ensurePageInfo(false);
      return {
        host: "page",
        convKey: "page" + location.pathname + location.search,
        title: pageInfo.title || "Pagina web",
        url: location.href.split("#")[0],
      };
    }
    var ck = A.conversationKey(host, location);
    // Nuova chat senza id nell'URL: l'id visto dalla rete stabilizza la
    // sessione PRIMA che l'URL riceva /c/<id> (stesso uuid, stessa chiave).
    if (host === "chatgpt" && net.convId) {
      // /c/<id>, /u/<id> e /uc/<id> (chat anonima senza account).
      var m = location.pathname.match(/\/(?:uc|c|u)\/([0-9a-zA-Z-]{8,})/);
      if (!m) ck = "c-" + net.convId;
    }
    return {
      host: host,
      convKey: ck,
      title: A.conversationTitle(host, document),
      url: location.href.split("#")[0],
    };
  }

  /** Passaggio di navigazione che cambia DAVVERO conversazione (SPA): la
   *  traccia della rete della chat precedente non deve finire nel registro
   *  della nuova. Per chatgpt si esclude il solo passaggio landing("/") ->
   *  /c/<id> della STESSA conversazione appena creata (l'id di rete stabilizza
   *  la sessione: lì la traccia va CONSERVATA, non buttata). */
  var netLastSearch = location.search;
  var lastPath = location.pathname;
  function netMayBeStale() {
    var path = location.pathname;
    if (path === lastPath) return false;
    var prev = lastPath;
    lastPath = path;
    if (host === "chatgpt") {
      var rx = /\/(?:uc|c|u)\/([0-9a-zA-Z-]{8,})/;
      var mNow = path.match(rx);
      var mPrev = prev.match(rx);
      // Landing -> /c/<id>: stabilizzazione della conversazione corrente, NON
      // cambio: la traccia di rete resta (contiene l'eco del primo messaggio).
      if (mNow && !mPrev) return false;
      // /c/<A> -> /c/<B> (altra chat) o /c/<A> -> landing: reset.
      if (mNow && mPrev && mNow[1] !== mPrev[1]) return true;
      if (!mNow && mPrev) return true;
      return false;
    }
    if (host === "claude") {
      var cNow = path.match(/\/chat\/([0-9a-zA-Z-]{8,})/);
      var cPrev = prev.match(/\/chat\/([0-9a-zA-Z-]{8,})/);
      return String((cNow && cNow[1]) || "") !== String((cPrev && cPrev[1]) || "");
    }
    // glmchat: "Nuova chat" incrementa ?c=N (query, non path).
    if (host === "glmchat") {
      if (location.search !== netLastSearch) {
        netLastSearch = location.search;
        return true;
      }
      return false;
    }
    return false;
  }

  /** Fusione completa del momento: DOM attuale ∪ stream di rete, proiettata
   *  sul registro accumulato della sessione. In modalità PAGINA il documento
   *  estratto (cache) È la conversazione: niente fusione di rete. */
  function mergedMessages() {
    if (genericMode) {
      var pageMsgs = pageMessages();
      lastStats = { dom: pageInfo.sections.length, net: 0, total: pageMsgs.length };
      return pageMsgs;
    }
    var domMsgs = A.extractMessages(host, document);
    lastEls = A.messageElements(host, document);
    // Prima di fondere: se la navigazione ha cambiato conversazione, la
    // traccia di rete vecchia va buttata (altrimenti i messaggi della chat
    // precedente inquinano la nuova — tipico di "Nuova chat" sulla GLM).
    if (netMayBeStale()) {
      net.convId = null;
      net.stream = [];
      net.ids = {};
    }
    var current = weave(domMsgs, net.stream);
    var key = convInfo().convKey;
    if (key !== registryKey) {
      registryKey = key;
      registry = [];
    }
    var merged = weave(registry, current);
    if (merged.length > REGISTRY_CAP) merged = merged.slice(-REGISTRY_CAP);
    registry = merged;
    lastStats = { dom: domMsgs.length, net: net.stream.length, total: merged.length };
    return merged;
  }

  // ---------------------------------------------------------------------------
  // Impostazioni + badge
  // ---------------------------------------------------------------------------

  // v1.0.0: l'auto-apertura del pannello è STATA RIMOSSA — il pannello si
  // apre solo quando lo vuoi tu (o dal popup). La lettura passiva resta
  // soltanto per il contatore sulla pillola: non costruisce più nulla da sola.

  function currentSignature(msgs, info) {
    var last = msgs.length ? msgs[msgs.length - 1].text.slice(-140) : "";
    return info.convKey + "|" + msgs.length + "|" + last + "|" + info.title;
  }

  /** Aggiorna il contatore sulla pillola e la fa pulsare a ogni risposta nuova. */
  function updateBadge(msgs) {
    if (!launcher || !badge) return;
    var n = msgs.length;
    if (n === lastBadgeCount) return;
    var grew = n > lastBadgeCount && lastBadgeCount >= 0;
    lastBadgeCount = n;
    badge.textContent = n > 99 ? "99+" : String(n);
    launcher.classList.toggle("mf-has-messages", n > 0);
    if (grew) {
      launcher.classList.remove("mf-pulse");
      void launcher.offsetWidth; // riavvia l'animazione
      launcher.classList.add("mf-pulse");
      setTimeout(function () {
        launcher.classList.remove("mf-pulse");
      }, 2400);
    }
  }

  /** Invia al pannello (iframe) lo stato corrente della conversazione. */
  function pushMessages(force) {
    if (!isOpen || !iframe || !iframe.contentWindow) return;
    var msgs = mergedMessages();
    var info = convInfo();
    var sig = currentSignature(msgs, info);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    var payload = {
      type: "mindflow:messages",
      info: info,
      messages: msgs.map(function (m) {
        return { role: m.role, text: m.text };
      }),
      stats: { dom: lastStats.dom, net: lastStats.net },
    };
    try {
      iframe.contentWindow.postMessage(payload, "*");
    } catch (_e) {
      /* iframe in chiusura */
    }
  }

  /**
   * Lettura passiva: gira sempre (pannello aperto o chiuso) così la pillola
   * mostra di essere viva con il contatore dei messaggi. A pannello chiuso il
   * costo è una querySelectorAll ogni 700 ms di mutazioni (throttle) / 2,5 s.
   */
  function refresh() {
    var msgs;
    try {
      msgs = mergedMessages();
    } catch (_e) {
      return; // DOM in transizione: il prossimo giro riparte pulito
    }
    updateBadge(msgs);
    if (isOpen) pushMessages(false);
  }

  // --- Osservazione DOM (throttled) + poll SPA --------------------------------

  var obsTimer = null;
  var observer = new MutationObserver(function () {
    if (obsTimer) return;
    obsTimer = setTimeout(function () {
      obsTimer = null;
      refresh();
    }, 700);
  });

  function startObservers() {
    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    } catch (_e) {
      /* DOM non pronto: il poll di sicurezza resta attivo */
    }
    setInterval(refresh, 2500);
  }

  // --- Cattura di rete (MAIN world) -------------------------------------------
  // Dove lo stream esiste: ChatGPT, Claude e la chat GLM di prova. Gemini
  // resta sul DOM.
  //
  // INIEZIONE A DUE VIE (bug cattura ChatGPT, novembre 2026): l'iniezione via
  // <script src="chrome-extension://…"> è soggetta al CSP della PAGINA, e
  // chatgpt.com ha un CSP molto severo: quando lo blocca il MAIN world non
  // parte MAI, la cattura di rete muore in silenzio e restano solo le bolle
  // utente dal DOM (il bug «legge solo i miei messaggi»). Percorso nuovo:
  //   1) iniezione DOM come prima;
  //   2) net-capture segnala "alive" appena parte;
  //   3) se dopo 900 ms non è arrivato, il service worker inietta il file
  //      con chrome.scripting.executeScript (world MAIN, immune al CSP).
  var netAlive = false;

  function injectNetCapture() {
    if (host !== "chatgpt" && host !== "claude" && host !== "glmchat") return;
    try {
      if (document.querySelector("script[data-mf-net]")) return;
      var s = document.createElement("script");
      s.src = chrome.runtime.getURL("net-capture.js");
      s.async = false;
      s.setAttribute("data-mf-net", "1");
      s.onload = function () {
        if (s.parentNode) s.parentNode.removeChild(s);
      };
      (document.head || document.documentElement).appendChild(s);
    } catch (_e) {
      /* iniezione negata: il fallback qui sotto prende il largo */
    }
    // Fallback CSP: se il MAIN world non è vivo, passa dal service worker.
    setTimeout(function () {
      if (netAlive) return;
      try {
        if (!chrome.runtime || !chrome.runtime.sendMessage) return;
        chrome.runtime.sendMessage({ type: "mindflow:inject-net" }, function (resp) {
          if (chrome.runtime.lastError) {
            /* contesto orfano o permessi assenti: resta la cattura DOM */
            return;
          }
          if (resp && resp.ok) {
            // net-capture, appena eseguito, manderà il suo "alive": non serve
            // altro qui. Se il provider dei permessi è cambiato, il pulsante
            // «Ricarica la pagina» del launcher guarisce il contesto.
          } else {
            // Permessi host mancanti (es. estensione non ancora riavviata dopo
            // l'aggiornamento): la cattura resta DOM-only.
          }
        });
      } catch (_e2) {
        /* canale morto: resta la cattura DOM */
      }
    }, 900);
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    var d = event.data;
    if (d && d.source === "mindflow-net") {
      try {
        onNetMessage(d);
        refresh();
      } catch (_e) {
        /* registro in transizione */
      }
    }
  });

  // --- UI ---------------------------------------------------------------------

  function ensureUI() {
    if (frame) return;

    launcher = document.createElement("button");
    launcher.id = "mindflow-launcher";
    launcher.setAttribute("aria-label", "Apri MindFlow Companion");
    launcher.setAttribute("aria-expanded", "false");
    launcher.title = genericMode
      ? "MindFlow Companion — il grafo di memoria di questa pagina"
      : "MindFlow Companion — il grafo di memoria di questa chat";
    launcher.innerHTML =
      '<svg class="mf-logo" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="7" y1="6.5" x2="17" y2="6.5"/><line x1="7" y1="6.5" x2="12" y2="17.5"/><line x1="17" y1="6.5" x2="12" y2="17.5"/>' +
      '<circle cx="7" cy="6.5" r="2.6"/><circle cx="17" cy="6.5" r="2.6"/><circle cx="12" cy="17.5" r="2.6"/>' +
      "</svg>" +
      '<span class="mf-word">MindFlow</span>' +
      '<span class="mf-badge" aria-hidden="true"></span>';
    badge = launcher.querySelector(".mf-badge");
    launcher.addEventListener("click", function () {
      // Contesto orfano (estensione aggiornata con la pagina aperta): il clic
      // guarisce ricaricando la pagina, invece di aprire un pannello morto.
      if (contextBroken) {
        try {
          location.reload();
        } catch (_e) {
          /* pagina in chiusura */
        }
        return;
      }
      setOpen(!isOpen);
    });

    frame = document.createElement("div");
    frame.id = "mindflow-panel-frame";
    frame.classList.add("mf-closed");
    iframe = document.createElement("iframe");
    iframe.id = "mindflow-panel-iframe";
    iframe.title = "MindFlow Companion";
    iframe.src = chrome.runtime.getURL("panel.html");
    iframe.setAttribute("allow", "clipboard-write");
    frame.appendChild(iframe);
    document.documentElement.appendChild(launcher);
    document.documentElement.appendChild(frame);
  }

  function setOpen(next) {
    isOpen = !!next;
    ensureUI();
    frame.classList.toggle("mf-closed", !isOpen);
    frame.classList.toggle("mf-open", isOpen);
    launcher.classList.toggle("mf-active", isOpen);
    launcher.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (isOpen) {
      pushMessages(true);
      updateBadge(mergedMessages());
    }
  }

  // --- Modalità Studio, salto al messaggio, raccolta della chat intera --------

  function applyWidthMode(mode) {
    if (!frame) return;
    if (mode === "studio") {
      frame.style.width = STUDIO_WIDTH;
    } else {
      frame.style.width = "";
    }
  }

  /** Evidenzia il messaggio che il checkpoint selezionato comprime. */
  function flashMessage(index) {
    var els = lastEls.length ? lastEls : A.messageElements(host, document);
    var entry = els[index];
    if (!entry || !entry.el || typeof entry.el.scrollIntoView !== "function") return;
    try {
      entry.el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_e) {
      try {
        entry.el.scrollIntoView();
      } catch (_e2) {
        return;
      }
    }
    var el = entry.el;
    try {
      el.classList.add("mf-goto-flash");
    } catch (_e3) {
      return;
    }
    setTimeout(function () {
      try {
        el.classList.remove("mf-goto-flash");
      } catch (_e4) {
        /* nodo rimosso dalla pagina */
      }
    }, 2200);
  }

  /**
   * Raccolta completa della conversazione: porta il contenitore della chat
   * in cima e scorre verso il basso finché il numero di messaggi non resta
   * stabile. Ogni finestra DOM incontrata viene fusa nel registro (weave),
   * così i siti che virtualizzano i turni contribuiscono tutti i messaggi.
   */
  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function findScrollHost(fromEl) {
    var el = fromEl;
    while (el && el !== document.documentElement) {
      try {
        var oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll" || oy === "overlay") && el.scrollHeight - el.clientHeight > 80) {
          return el;
        }
      } catch (_e) {
        break;
      }
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollStep(container) {
    var win = container.ownerDocument && container.ownerDocument.defaultView;
    // v1.1.2: passo all'85% dell'viewport (prima 80%): una finestra in meno
    // per ogni schermata di conversazione, stesso margine anti-taglio.
    if (container === document.scrollingElement || container === document.documentElement) {
      win = win || window;
      win.scrollBy(0, Math.max(320, win.innerHeight * 0.85));
      return;
    }
    container.scrollTop += Math.max(320, container.clientHeight * 0.85);
  }

  /** Consegna comune del risultato della raccolta al pannello: badge + resoconto.
   *  Prima la consegna viveva solo nel ramo chat: le pagine non ne beneficiavano. */
  function deliverCollected(msgs) {
    try {
      updateBadge(msgs);
      // Il risultato viene SEMPRE consegnato al pannello, anche parziale:
      // prima un'eccezione a metà scroll lasciava la barra di avanzamento
      // appesa per sempre (pannello che sembrava bloccato).
      try {
        iframe.contentWindow.postMessage(
          {
            type: "mindflow:messages-collected",
            info: convInfo(),
            messages: msgs.map(function (m) {
              return { role: m.role, text: m.text };
            }),
            stats: { dom: lastStats.dom, net: lastStats.net },
          },
          "*"
        );
      } catch (_e2) {
        /* iframe chiuso */
      }
    } catch (_e3) {
      /* convInfo o registro in transizione: il poll regolare recupera */
    }
  }

  async function collectAll() {
    if (collecting) return;
    collecting = true;
    collectCanceled = false; // un nuovo avvio riparte pulito
    var acc = [];
    try {
      if (genericMode) {
        // PAGINA: niente scroll né virtualizzazione — il reader generico
        // produce tutto subito. Forza il ricalcolo: la pagina può essere
        // cambiata (navigazione SPA) da quando è stato estratto l'ultimo giro.
        ensurePageInfo(true);
        acc = pageMessages();
      } else {
        var els = A.messageElements(host, document);
        var container = findScrollHost(els.length ? els[els.length - 1].el : document.body);
        // Torna in cima: serve per i siti che virtualizzano la conversazione.
        if (container === document.scrollingElement || container === document.documentElement) {
          window.scrollTo(0, 0);
        } else {
          container.scrollTop = 0;
        }
        await sleep(350);

        var lastCount = -1;
        var stable = 0;
        for (var i = 0; i < 80; i++) {
          // v1.1.4: l'utente ha premuto «Annulla» nel pannello: lo scorrimento
          // si ferma SUBITO (non al giro successivo) e si consegna il parziale,
          // che il pannello scarta quando il dialogo è stato annullato.
          if (collectCanceled) break;
          try {
            var domMsgs = A.extractMessages(host, document);
            acc = weave(acc, domMsgs);
            if (domMsgs.length === lastCount) {
              stable++;
              if (stable >= 3) break;
            } else {
              stable = 0;
              lastCount = domMsgs.length;
            }
          } catch (_loop) {
            /* finestra DOM in transizione: il prossimo giro riprende */
          }
          scrollStep(container);
          // v1.1.2: 300 ms per finestra (prima 380): i siti virtualizzati
          // renderizzano in ~100 ms, il margine resta ampio — su una chat
          // lunga la raccolta guadagna ~1/4 del tempo.
          await sleep(300);
        }
        acc = weave(acc, net.stream);
        acc = weave(acc, A.extractMessages(host, document));
      }
    } catch (_err) {
      /* errore a metà raccolta: consegna comunque quanto già visto */
    } finally {
      try {
        if (genericMode) {
          lastStats = { dom: pageInfo.sections.length, net: 0, total: acc.length };
        } else {
          if (acc.length > REGISTRY_CAP) acc = acc.slice(-REGISTRY_CAP);
          registry = acc;
          registryKey = convInfo().convKey;
          lastStats = { dom: lastStats.dom, net: net.stream.length, total: acc.length };
        }
        deliverCollected(acc);
      } catch (_e3) {
        /* consegna rinviata al poll regolare */
      }
      collecting = false;
    }
  }

  // --- Messaggi dal pannello ---------------------------------------------------

  window.addEventListener("message", function (event) {
    if (!iframe || event.source !== iframe.contentWindow) return;
    var d = event.data || {};
    switch (d.type) {
      case "mindflow:ready":
        pushMessages(true);
        break;
      case "mindflow:get-messages":
        pushMessages(true);
        break;
      case "mindflow:inject": {
        var ok = A.injectText(host, document, String(d.text || ""));
        try {
          iframe.contentWindow.postMessage({ type: "mindflow:inject-result", ok: ok }, "*");
        } catch (_e) {
          /* iframe chiuso */
        }
        break;
      }
      case "mindflow:close":
        setOpen(false);
        break;
      case "mindflow:set-width":
        applyWidthMode(d.mode === "studio" ? "studio" : "narrow");
        break;
      case "mindflow:goto-message":
        flashMessage(Number(d.index) || 0);
        break;
      case "mindflow:collect-all":
        collectAll();
        break;
      case "mindflow:collect-cancel":
        // v1.1.4: dal pannello è stato premuto «Annulla» durante la raccolta:
        // il prossimo giro del ciclo di scorrimento esce e consegna il parziale.
        collectCanceled = true;
        break;
      case "mindflow:reload-page":
        // Richiesto dal banner del pannello quando il contesto dell'estensione
        // è invalidato (estensione aggiornata con la pagina aperta): il content
        // script può sempre ricaricare la sua pagina, anche se orfano.
        try {
          location.reload();
        } catch (_eR) {
          /* pagina in chiusura */
        }
        break;
      case "mindflow:diagnose": {
        var report = A.diagnose(host, document);
        report.url = location.href.split("#")[0];
        report.title = (document.title || "").slice(0, 120);
        report.panelOpen = isOpen;
        report.userAgent = navigator.userAgent;
        report.capture = { dom: lastStats.dom, net: lastStats.net, total: lastStats.total };
        try {
          iframe.contentWindow.postMessage({ type: "mindflow:diagnose-result", report: report }, "*");
        } catch (_eD) {
          /* iframe chiuso */
        }
        break;
      }
      default:
        break;
    }
  });

  // --- Canale di controllo per il popup della barra strumenti ------------------

  try {
    chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "mindflow:popup-status") {
        var msgs = mergedMessages();
        var info = convInfo();
        sendResponse({
          ok: true,
          host: host,
          title: info.title,
          convKey: info.convKey,
          messages: msgs.length,
          dom: lastStats.dom,
          net: lastStats.net,
          panelOpen: isOpen,
        });
        return;
      }
      if (msg.type === "mindflow:open-panel") {
        setOpen(true);
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "mindflow:collect") {
        collectAll();
        sendResponse({ ok: true });
        return;
      }
    });
  } catch (_e) {
    /* runtime non disponibile (pagina demo): il canale resta spento */
  }

  // --- Contesto orfano (estensione aggiornata con la pagina aperta) ----------
  // Quando l'estensione viene ricaricata/aggiornata, il content script resta
  // “orfano”: i canali chrome.* muoiono e il pannello incorporato muore con
  // loro. La pillola lo dichiara con un puntino rosso e un clic ricarica la
  // pagina: un clic, guarito. Prima l'avviso viveva solo dentro il pannello
  // (che però era già morto) e non c'era via d'uscita visibile.
  var contextBroken = false;
  function watchContextAlive() {
    if (contextBroken) return;
    var alive = false;
    try {
      alive = !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_e) {
      alive = false;
    }
    if (alive) return;
    contextBroken = true;
    try {
      if (launcher) {
        launcher.classList.add("mf-stale");
        launcher.title = "MindFlow è stato aggiornato: clicca qui per ricaricare la pagina e riattivarlo";
      }
    } catch (_e2) {
      /* UI già rimossa */
    }
  }
  setInterval(watchContextAlive, 4000);

  // Avvio: UI creata subito ma chiusa (solo launcher visibile).
  function start() {
    if (started) return;
    started = true;
    // Marcatore per la pagina host: permette alla chat GLM di mostrare
    // "Estensione attiva" senza domande dirette al content script.
    try {
      document.documentElement.setAttribute("data-mindflow-companion", "1");
    } catch (_e) {
      /* non bloccante */
    }
    injectNetCapture();
    ensureUI();
    startObservers();
    refresh(); // primo conteggio subito, senza aspettare il poll
  }

  // Host "multi-pagina" (es. anteprima space-z.ai): attiva solo quando la
  // pagina contiene il marcatore della chat. Poll leggero: copre anche la
  // navigazione SPA verso /chat dopo il caricamento.
  var marker = A.pageMarker(host);
  if (marker) {
    var tryStart = function () {
      if (started) return;
      if (document.getElementById(marker)) start();
    };
    tryStart();
    setInterval(tryStart, 1200);
  } else {
    start();
  }
})();
