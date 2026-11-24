/**
 * MindFlow Companion — Pannello (pagina dell'estensione, v1.2.0 «Grafo compatto, resa efficiente»).
 *
 * Responsabilità:
 * - riceve dal content script i messaggi letti nella chat host;
 * - gestisce le sessioni di memoria per (sito, conversazione) in chrome.storage.local;
 * - crea checkpoint (compressione via motore locale/API: con il motore spento
 *   il checkpoint viene rifiutato con un messaggio chiaro, mai simulato);
 * - disegna il grafo SVG dei checkpoint (albero con forcazioni) con effetti:
 *   zoom/pan, hover dei collegamenti, burst di particelle sui nuovi nodi;
 * - modalità Studio: pannello largo (chat a sinistra, grafo a destra);
 * - UNA pipeline per TUTTE le origini (v1.0.0): raccolta della pagina, testo
 *   incollato, file export o coda della chat. Sempre: verifica motore →
 *   MAPPA dei capitoli (1 chiamata: è il motore a decidere i confini
 *   semantici, non più un taglio a caratteri) → compressione per capitolo
 *   (v1.1.2: capitoli in PARALLELO, 2 alla volta sui motori locali e 3 sulle
 *   API cloud, nodi aggiunti in ordine man mano che arrivano);
 * - v1.1.2 velocità: pipeline dichiarata OCCUPATA dal primo istante (niente
 *   doppie pipeline in concorrenza al motore), orologio dei secondi sempre
 *   visibile, finestra di contesto adattiva alla lunghezza reale del testo;
 * - importa chat passate: raccolta con auto-scroll, testo incollato, file
 *   export (JSON di ChatGPT, txt, md) -> catena di capitoli con progress;
 * - compila il contesto (catena ancestrale + coda viva) e lo copia/inietta nel prompt.
 *
 * Se chrome.* non è disponibile (anteprima web senza estensione) il pannello
 * passa in modalità DEMO: storage su localStorage, compressione locale di
 * dimostrazione, conversazione fittizia — utile anche come vetrina.
 */

(function () {
  "use strict";

  // Adattatori (panel.html carica adapters.js prima di panel.js): servono
  // ai parser dell'import (testo incollato / export JSON).
  var A = globalThis.MindFlowAdapters || null;

  // Client del motore condiviso (panel.html carica engine-client.js prima di
  // panel.js): riassunto e verifica del motore in fetch DIRETTO dal pannello,
  // senza passare dal service worker.
  var MF = globalThis.MindFlowEngineClient || null;

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------

  var HAS_RUNTIME =
    typeof chrome !== "undefined" && chrome && chrome.runtime && chrome.runtime.id;

  function storageGet(keys) {
    if (!HAS_RUNTIME) {
      var raw = localStorage.getItem("mf.demo.state");
      var state = {};
      try {
        state = raw ? JSON.parse(raw) : {};
      } catch (_e) {
        state = {};
      }
      var out = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
        out[k] = state[k];
      });
      return Promise.resolve(out);
    }
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function storageSet(obj) {
    if (!HAS_RUNTIME) {
      var raw = localStorage.getItem("mf.demo.state");
      var state = {};
      try {
        state = raw ? JSON.parse(raw) : {};
      } catch (_e) {
        state = {};
      }
      Object.keys(obj).forEach(function (k) {
        state[k] = obj[k];
      });
      localStorage.setItem("mf.demo.state", JSON.stringify(state));
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      chrome.storage.local.set(obj, resolve);
    });
  }

  function chromeSend(msg) {
    if (!HAS_RUNTIME) return Promise.resolve(null);
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          var err = chrome.runtime.lastError;
          // SOLO il contesto invalidato prova l'estensione aggiornata/ricaricata
          // con la pagina ancora aperta. «message port closed» e «Receiving end
          // does not exist» arrivano ANCHE quando il service worker è solo
          // lento a svegliarsi o è stato spento durante un riassunto: trattarli
          // come «aggiornato» mostrava il banner a torto e il ricaricamento
          // non risolveva, perché l'errore non c'entrava con la versione.
          if (err && /context invalidated|extension context/i.test(String(err.message || ""))) {
            markRuntimeBroken();
          } else if (resp) {
            markRuntimeOk();
          }
          resolve(resp || null);
        });
      } catch (e) {
        // Contexto estensione invalidato (estensione ricaricata/aggiornata con
        // la pagina ancora aperta): TUTTE le chiamate al service worker
        // falliscono finché l'utente non ricarica la pagina della chat.
        if (/context invalidated|extension context/i.test(String((e && e.message) || ""))) {
          markRuntimeBroken();
        }
        resolve(null);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Contesto estensione invalidato: banner "ricarica la pagina"
  // ---------------------------------------------------------------------------

  var runtimeBroken = false;
  var reloadBanner = null;

  function markRuntimeBroken() {
    if (runtimeBroken) return;
    runtimeBroken = true;
    try {
      ensureReloadBanner();
      reloadBanner.classList.remove("mf-hidden");
    } catch (_e) {
      /* banner non creatabile: resta lo stato nel motore */
    }
    renderEngineState();
  }

  /** Una chiamata riuscita DOPO un contesto rotto lo dichiara guarito (il
   *  service worker può essere stato solo lento alla prima apertura): il
   *  banner si nasconde da solo invece di restare per sempre. */
  function markRuntimeOk() {
    if (!runtimeBroken) return;
    runtimeBroken = false;
    try {
      if (reloadBanner) reloadBanner.classList.add("mf-hidden");
    } catch (_e) {
      /* banner già assente */
    }
    renderEngineState();
  }

  function ensureReloadBanner() {
    if (reloadBanner) return;
    reloadBanner = document.createElement("div");
    reloadBanner.className = "mf-reload-banner";
    reloadBanner.setAttribute("role", "alert");
    // Testo corto + azione diretta: il content script (anche quello "orfano"
    // di una versione precedente) riceve il postMessage e ricarica la pagina.
    reloadBanner.innerHTML =
      "<strong>MindFlow è stato aggiornato o ricaricato.</strong>" +
      "<span>Ricarica la pagina della chat per riattivare il pannello.</span>";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mf-reload-btn";
    btn.textContent = "Ricarica la pagina";
    btn.addEventListener("click", function () {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "mindflow:reload-page" }, "*");
          setStatus("Ricarica della pagina richiesta…");
        } else {
          window.location.reload();
        }
      } catch (_e) {
        setStatus("Ricarica manualmente la pagina della chat (Cmd/Ctrl+R).", "error");
      }
    });
    reloadBanner.appendChild(btn);
    var body = document.body || document.documentElement;
    body.insertBefore(reloadBanner, body.firstChild);
  }

  // ---------------------------------------------------------------------------
  // Impostazioni
  // ---------------------------------------------------------------------------

  var DEFAULT_SETTINGS = {
    engine: {
      kind: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "",
      keys: { openai: "", anthropic: "", compat: "" },
    },
    panel: { widthMode: "narrow" },
  };

  function mergeSettings(stored) {
    var s = stored && typeof stored === "object" ? stored : {};
    var out = {
      engine: {
        kind: s.engine && s.engine.kind ? s.engine.kind : DEFAULT_SETTINGS.engine.kind,
        baseUrl: s.engine && s.engine.baseUrl ? s.engine.baseUrl : DEFAULT_SETTINGS.engine.baseUrl,
        model: s.engine && s.engine.model ? s.engine.model : "",
        keys: {
          openai: (s.engine && s.engine.keys && s.engine.keys.openai) || "",
          anthropic: (s.engine && s.engine.keys && s.engine.keys.anthropic) || "",
          compat: (s.engine && s.engine.keys && s.engine.keys.compat) || "",
        },
      },
      panel: {
        widthMode: s.panel && s.panel.widthMode === "studio" ? "studio" : "narrow",
        // autoOpen non si perde più: prima una scrittura dal pannello
        // azzerava la preferenza salvata dalla pagina opzioni.
        autoOpen: s.panel && typeof s.panel.autoOpen === "boolean" ? s.panel.autoOpen : true,
      },
    };
    // Le chiavi sconosciute (aggiunte da versioni future) non si buttano via:
    // il pannello riscrive mf.settings solo in modo additivo.
    for (var k in s) {
      if (Object.prototype.hasOwnProperty.call(s, k) && !(k in out)) out[k] = s[k];
    }
    if (s.engine) {
      for (var ek in s.engine) {
        if (Object.prototype.hasOwnProperty.call(s.engine, ek) && !(ek in out.engine)) out.engine[ek] = s.engine[ek];
      }
    }
    return out;
  }

  function enginePayload() {
    var e = settings.engine;
    var apiKey =
      e.kind === "openai"
        ? e.keys.openai
        : e.kind === "anthropic"
          ? e.keys.anthropic
          : e.kind === "openai-compat"
            ? e.keys.compat
            : "";
    return { kind: e.kind, baseUrl: e.baseUrl, model: e.model, apiKey: apiKey };
  }

  // ---------------------------------------------------------------------------
  // Stato
  // ---------------------------------------------------------------------------

  var settings = mergeSettings(null);
  var sessions = {};
  var info = null; // { host, convKey, title, url }
  var messages = [];
  var selectedNodeId = null;
  var payloadText = "";
  var lastInjectEcho = 0;

  // Sessione in visualizzazione (null = chat collegata; chiave = import o altra).
  var viewOverride = null;
  var knownEdges = {};
  var edgeEls = [];
  var nodeEls = [];
  var graphZoom = 1;
  var graphSize = { w: 0, h: 0 };
  var lastLayout = null;
  var lastGraphSig = null; // v1.2.0: firma dell'ultimo grafo disegnato (anti-rebuild)
  var importRunning = false;
  var importCancel = false;
  // v1.1.2 — guardia unica anti-doppio-lancio: prima, durante verifica motore
  // e mappa dei capitoli, NESSUN flag era attivo e un secondo clic avviava una
  // pipeline in concorrenza che raddoppiava il carico sul motore locale
  // (il «collo di bottiglia» di Aggiorna grafo). Ora la pipeline si dichiara
  // SUBITO e i clic extra ricevano un messaggio, mai il silenzio.
  var collectPending = false; // raccolta della pagina in corso
  var pipelinePhase = "";     // etichetta della fase corrente (per il messaggio di guardia)

  var DEMO_MESSAGES = [
    { role: "user", text: "Ciao! Sto progettando una dashboard per le mie spese mensili in Python. Da dove comincio?" },
    { role: "assistant", text: "Parti da tre pilastri: 1) un modello dati minimale (data, categoria, importo, note); 2) un modulo di caricamento CSV con pandas; 3) una vista aggregata per mese con groupby. Tieni la UI (Streamlit) separata dalla logica." },
    { role: "user", text: "Uso pandas. Il CSV ha colonne 'data', 'categoria', 'importo'. Come normalizzo le date?" },
    { role: "assistant", text: "pd.to_datetime(df['data'], dayfirst=True). Aggiungi df['mese'] = df['data'].dt.to_period('M') per aggregare per mese. Controlla i NaN con df.isna().sum() prima di aggregare." },
    { role: "user", text: "Perfetto. Ora voglio stimare il budget del prossimo trimestre: ci mettiamo una media mobile?" },
    { role: "assistant", text: "Sì: df.groupby('mese')['importo'].sum().rolling(3).mean(). Per il trimestre futuro usa l'ultima media mobile × 3 come baseline, poi correggi con le spese fisse note. Deciso: baseline = media mobile trimestrale." },
    { role: "user", text: "Ultima cosa: come divido le categorie fisse e variabili?" },
    { role: "assistant", text: "Una lista python FISSE = ['affitto', 'utenze', 'abbonamenti'] e df['tipo'] = df['categoria'].apply(lambda c: 'fissa' if c in FISSE else 'variabile'). Così il report può mostrare due tabelle separate." },
  ];

  // ---------------------------------------------------------------------------
  // Sessioni
  // ---------------------------------------------------------------------------

  function sessionKey(host, convKey) {
    return host + "::" + convKey;
  }

  function pageSessionKey() {
    return info ? sessionKey(info.host, info.convKey) : "demo::demo";
  }

  /** Messaggi rilevanti per la sessione in visualizzazione. */
  function sessionMessages() {
    var s = currentSession();
    if (s && s.imported && Array.isArray(s.messages)) return s.messages;
    return messages;
  }

  function currentSession() {
    var key = viewOverride || pageSessionKey();
    var existing = sessions[key];
    if (existing) return existing;
    if (viewOverride) return null; // sessione in visualizzazione assente: niente creazione implicita
    if (!info) return null;
    sessions[key] = {
      key: key,
      host: info.host,
      title: info.title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: [
        {
          id: "root",
          parentId: null,
          createdAt: Date.now(),
          title: "Inizio conversazione",
          summary: "",
          keyDecisions: [],
          msgIndex: 0,
        },
      ],
      activeNodeId: "root",
    };
    saveSessions();
    return sessions[key];
  }

  function switchSession(key) {
    viewOverride = key || null;
    knownNodeIds = {};
    knownEdges = {};
    lastScrollTarget = null;
    graphZoom = 1;
    selectedNodeId = null;
    payloadText = "";
    elPayload.textContent = "";
    if (!currentSession()) viewOverride = null;
    renderSessionsMenu();
    renderAll();
  }

  var saveTimer = null;
  function saveSessions() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      storageSet({ "mf.sessions": sessions });
    }, 250);
  }

  function nodeById(id) {
    var s = currentSession();
    if (!s) return null;
    return s.nodes.find(function (n) {
      return n.id === id;
    }) || null;
  }

  function chainToRoot(session, nodeId) {
    var out = [];
    var cur = session.nodes.find(function (n) {
      return n.id === nodeId;
    });
    while (cur) {
      out.unshift(cur);
      cur = cur.parentId
        ? session.nodes.find(function (n) {
            return n.id === cur.parentId;
          })
        : null;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Compilazione del contesto
  // ---------------------------------------------------------------------------

  function compilePayload() {
    var s = currentSession();
    if (!s) return "";
    var chain = chainToRoot(s, s.activeNodeId);
    var covered = nodeById(s.activeNodeId) ? nodeById(s.activeNodeId).msgIndex : 0;
    var tail = sessionMessages().slice(covered);

    var L = [];
    L.push("## Contesto compilato (MindFlow Companion)");
    L.push("# Chat: " + s.title);
    var cps = chain.filter(function (n) {
      return n.parentId !== null;
    });
    if (cps.length) {
      L.push("");
      L.push("### Memoria compressa (percorso di checkpoint attivo)");
      cps.forEach(function (n, i) {
        L.push("[CP " + (i + 1) + "] " + n.title);
        if (n.summary) L.push(n.summary);
        (n.keyDecisions || []).forEach(function (d) {
          L.push("- Decisione: " + d);
        });
      });
    } else {
      L.push("");
      L.push("### Memoria compressa");
      L.push("(nessun checkpoint: il segmento sotto è l'intera conversazione)");
    }
    if (tail.length) {
      L.push("");
      L.push("### Messaggi dopo l'ultimo checkpoint (" + tail.length + ")");
      tail.slice(-30).forEach(function (m) {
        var role = m.role === "user" ? "UTENTE" : "ASSISTENTE";
        var text = m.text.length > 1200 ? m.text.slice(0, 1200) + "…" : m.text;
        L.push("**[" + role + "]** " + text);
      });
    }
    return L.join("\n");
  }

  function estimateTokens(text) {
    return Math.ceil((text || "").length / 4);
  }

  function fmtTokens(n) {
    if (n >= 1000) return (n / 1000 >= 10 ? Math.round(n / 1000) : Math.round(n / 100) / 10) + "k";
    return String(n);
  }

  // ---------------------------------------------------------------------------
  // Riferimenti DOM
  // ---------------------------------------------------------------------------

  var $ = function (id) {
    return document.getElementById(id);
  };
  var elTitle = $("mf-session-title");
  var elBadge = $("mf-mode-badge");
  var elEngineLabel = $("mf-engine-label");
  var elDot = $("mf-engine-dot");
  var elStatMsgs = $("mf-stat-msgs");
  var elStatCps = $("mf-stat-cps");
  var elStatTok = $("mf-stat-tok");
  var elGraphEmpty = $("mf-graph-empty");
  var elGraphScroll = $("mf-graph-scroll");
  var elGraph = $("mf-graph");
  var elDetails = $("mf-details");
  var elDTitle = $("mf-d-title");
  var elDMeta = $("mf-d-meta");
  var elDSummary = $("mf-d-summary");
  var elDDecisions = $("mf-d-decisions");
  var elDActivate = $("mf-d-activate");
  var elBtnCp = $("mf-btn-checkpoint");
  var elCpBadge = $("mf-cp-badge");
  var elBtnCompile = $("mf-btn-compile");
  var elBtnCopy = $("mf-btn-copy");
  var elBtnInject = $("mf-btn-inject");
  var elPayload = $("mf-payload");
  var elStatus = $("mf-status");
  var elBtnReset = $("mf-btn-reset");

  var statusHoldUntil = 0; // v1.1.4: i feedback dei tasti restano visibili ~3 s
  function setStatus(text, kind) {
    elStatus.textContent = text || "";
    elStatus.classList.remove("mf-error", "mf-busy");
    if (kind === "error") elStatus.classList.add("mf-error");
    if (kind === "busy") elStatus.classList.add("mf-busy");
    // v1.1.4 — un messaggio NON-busy (esito di Compila/Copia/Inietta, errore,
    // esito pipeline) "tiene" la riga per 3 secondi: prima l'orologio della
    // pipeline sovrascriveva ogni secondo QUALSIASI feedback e i tasti
    // sembravano morti mentre la pipeline lavorava.
    statusHoldUntil = kind === "busy" ? 0 : Date.now() + 3000;
  }

  // ---------------------------------------------------------------------------
  // Grafo SVG
  // ---------------------------------------------------------------------------

  var NODE_W = 158;
  var NODE_H = 54;
  var ROW_H = 84;
  var COL_W = 186;

  // v1.2.0 — SCALETTA a due colonne per la catena pura (chat senza bivi):
  // ogni capitolo scende di ZIG_STEP (invece di ROW_H) alternando la colonna,
  // così una chat di 20 capitoli occupa ~metà altezza e il pannello mostra
  // molta più storia senza scroll. ZIG_GAP è il corridoio tra le colonne.
  var ZIG_STEP = 52;
  var ZIG_GAP = 36;

  // Nodi già disegnati: l'animazione d'ingresso scatta solo per i nuovi,
  // così i poll di aggiornamento non ri-animano tutto il grafo.
  var knownNodeIds = {};
  var lastScrollTarget = null;

  /** Defs SVG condivise: gradienti e filtri di glow del grafo. */
  function renderGraphDefs() {
    var defs = svgEl("defs");
    defs.innerHTML =
      '<radialGradient id="mf-grad-active" cx="50%" cy="26%" r="95%">' +
      '<stop offset="0%" stop-color="#124b3c"/>' +
      '<stop offset="55%" stop-color="#0d2a22"/>' +
      '<stop offset="100%" stop-color="#0b1b16"/>' +
      "</radialGradient>" +
      '<linearGradient id="mf-grad-node" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#1a2521"/>' +
      '<stop offset="100%" stop-color="#111a17"/>' +
      "</linearGradient>" +
      '<linearGradient id="mf-grad-edge" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="rgba(110, 231, 183, 0.95)"/>' +
      '<stop offset="100%" stop-color="rgba(16, 185, 129, 0.45)"/>' +
      "</linearGradient>" +
      '<filter id="mf-glow" x="-60%" y="-60%" width="220%" height="220%">' +
      '<feGaussianBlur stdDeviation="3.2" result="b"/>' +
      '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      "</filter>" +
      '<filter id="mf-glow-soft" x="-40%" y="-40%" width="180%" height="180%">' +
      '<feGaussianBlur stdDeviation="1.4" result="b"/>' +
      '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      "</filter>";
    return defs;
  }

  /** Contatore animato (cubic ease-out) per le statistiche. */
  function animateNumber(el, to, fmt) {
    to = Math.max(0, Math.round(to));
    var from = parseInt(el.dataset.v || "0", 10) || 0;
    el.dataset.v = String(to);
    if (from === to) {
      el.textContent = fmt ? fmt(to) : String(to);
      return;
    }
    var t0 = null;
    var dur = 420;
    function frame(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      var val = Math.round(from + (to - from) * e);
      el.textContent = k < 1 ? String(val) : (fmt ? fmt(to) : String(to));
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function layoutTree(nodes) {
    var children = {};
    var byId = {};
    nodes.forEach(function (n) {
      byId[n.id] = n;
    });
    nodes.forEach(function (n) {
      var p = n.parentId && byId[n.parentId] ? n.parentId : null;
      if (!children[p]) children[p] = [];
      children[p].push(n);
    });
    var X = {};
    var Y = {};
    var roots = nodes.filter(function (n) {
      return !n.parentId || !byId[n.parentId];
    });

    // v1.2.0 — CATENA PURA (una sola radice, nessun nodo con 2+ figli): è il
    // grafo tipico di una chat letta per intero. Invece della colonna verticale
    // infinita (20 capitoli = 20 righe da 84px), i nodi scendono a scaletta su
    // due colonne alternate: passo 52px per nodo → altezza quasi dimezzata e
    // larghezza finalmente sfruttata. Con UNA sola forcazione (bivi veri dei
    // checkpoint ri-agganciati) si resta sul layout ad albero classico, che
    // non rischia sovrapposizioni tra i rami.
    var pureChain =
      roots.length === 1 &&
      nodes.every(function (n) {
        return (children[n.id] || []).length <= 1;
      });
    if (pureChain) {
      var order = [];
      var cur = roots[0];
      var guard = 0;
      while (cur && guard++ <= nodes.length) {
        order.push(cur);
        var kids = (children[cur.id] || []).slice().sort(function (a, b) {
          return a.createdAt - b.createdAt;
        });
        cur = kids[0] || null;
      }
      order.forEach(function (n, i) {
        Y[n.id] = i * ZIG_STEP;
        X[n.id] = i % 2 === 0 ? 0 : NODE_W + ZIG_GAP;
      });
      return { X: X, Y: Y, byId: byId };
    }

    var slot = 0;
    function dfs(n, depth) {
      Y[n.id] = depth * ROW_H;
      var kids = (children[n.id] || []).slice().sort(function (a, b) {
        return a.createdAt - b.createdAt;
      });
      if (!kids.length) {
        X[n.id] = slot * COL_W;
        slot++;
        return;
      }
      kids.forEach(function (k) {
        dfs(k, depth + 1);
      });
      X[n.id] = (X[kids[0].id] + X[kids[kids.length - 1].id]) / 2;
    }
    roots.forEach(function (r) {
      dfs(r, 0);
    });
    return { X: X, Y: Y, byId: byId };
  }

  function svgEl(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function applyZoomStyle() {
    if (!graphSize.w) return;
    elGraph.style.width = Math.round(graphSize.w * graphZoom) + "px";
    elGraph.style.height = Math.round(graphSize.h * graphZoom) + "px";
  }

  /** Disegno progressivo di un arco nuovo (stroke-dashoffset animato). */
  function drawInEdge(path) {
    try {
      var L = path.getTotalLength();
      if (!L || !isFinite(L)) return;
      path.style.transition = "none";
      path.style.strokeDasharray = L + " " + L;
      path.style.strokeDashoffset = String(L);
      path.getBoundingClientRect(); // forza il reflow prima di animare
      path.style.transition = "stroke-dashoffset 0.7s cubic-bezier(0.3, 0.7, 0.2, 1)";
      path.style.strokeDashoffset = "0";
      setTimeout(function () {
        path.style.transition = "";
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
      }, 900);
    } catch (_e) {
      /* non bloccante */
    }
  }

  /** Esplosione di particelle quando nasce un checkpoint. */
  function spawnBurst(world, x, y) {
    var g = svgEl("g");
    g.setAttribute("class", "mf-burst");
    for (var i = 0; i < 14; i++) {
      var c = svgEl("circle");
      var ang = (Math.PI * 2 * i) / 14 + Math.random() * 0.6;
      var dist = 24 + Math.random() * 36;
      c.setAttribute("cx", x.toFixed(1));
      c.setAttribute("cy", y.toFixed(1));
      c.setAttribute("r", (1.3 + Math.random() * 2).toFixed(2));
      c.style.setProperty("--dx", (Math.cos(ang) * dist).toFixed(1) + "px");
      c.style.setProperty("--dy", (Math.sin(ang) * dist).toFixed(1) + "px");
      c.style.animationDelay = (Math.random() * 130).toFixed(0) + "ms";
      g.appendChild(c);
    }
    world.appendChild(g);
    setTimeout(function () {
      if (g.parentNode) g.parentNode.removeChild(g);
    }, 1500);
  }

  /** Hover: evidenzia il nodo con i suoi vicini e attenua il resto. */
  function setHover(id) {
    var s = currentSession();
    if (!s || !id) return;
    var hot = {};
    hot[id] = true;
    s.nodes.forEach(function (n) {
      if (n.parentId === id) hot[n.id] = true; // figli
      if (n.id === id && n.parentId) hot[n.parentId] = true; // padre
    });
    edgeEls.forEach(function (e) {
      var isHot = hot[e.from] && hot[e.to];
      e.el.classList.toggle("mf-edge-hot", isHot);
      e.el.classList.toggle("mf-edge-dim", !isHot);
    });
    nodeEls.forEach(function (p) {
      p.el.classList.toggle("mf-node-dim", !hot[p.id]);
    });
  }

  function clearHover() {
    edgeEls.forEach(function (e) {
      e.el.classList.remove("mf-edge-hot", "mf-edge-dim");
    });
    nodeEls.forEach(function (p) {
      p.el.classList.remove("mf-node-dim");
    });
  }

  function zoomAt(cx, cy, factor) {
    var rect = elGraphScroll.getBoundingClientRect();
    var ox = cx - rect.left;
    var oy = cy - rect.top;
    var bx = (elGraphScroll.scrollLeft + ox) / graphZoom;
    var by = (elGraphScroll.scrollTop + oy) / graphZoom;
    graphZoom = Math.min(2.6, Math.max(0.45, graphZoom * factor));
    applyZoomStyle();
    elGraphScroll.scrollLeft = bx * graphZoom - ox;
    elGraphScroll.scrollTop = by * graphZoom - oy;
  }

  function zoomCenter(factor) {
    var rect = elGraphScroll.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  function fitView() {
    graphZoom = 1;
    applyZoomStyle();
    if (!lastLayout) return;
    var s = currentSession();
    var nid = s ? s.activeNodeId : null;
    var x = nid && lastLayout.X[nid] !== undefined ? lastLayout.X[nid] : 0;
    var y = nid && lastLayout.Y[nid] !== undefined ? lastLayout.Y[nid] : 0;
    requestAnimationFrame(function () {
      try {
        elGraphScroll.scrollTo({ top: Math.max(0, y - 90), left: Math.max(0, x - 100), behavior: "smooth" });
      } catch (_e) {
        elGraphScroll.scrollTop = Math.max(0, y - 90);
      }
    });
  }

  /** Zoom con rotella (Ctrl/Cmd) e pan a trascinamento; bind una sola volta. */
  var graphInteractionsBound = false;
  function setupGraphInteraction() {
    if (graphInteractionsBound) return;
    graphInteractionsBound = true;
    var scroll = elGraphScroll;

    scroll.addEventListener("wheel", function (e) {
      if (!e.ctrlKey && !e.metaKey) return; // rotella libera: scorrimento normale
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    var panning = false;
    var moved = 0;
    var px = 0;
    var py = 0;
    scroll.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      panning = true;
      moved = 0;
      px = e.clientX;
      py = e.clientY;
      scroll.classList.add("mf-panning");
    });
    window.addEventListener("mousemove", function (e) {
      if (!panning) return;
      var dx = e.clientX - px;
      var dy = e.clientY - py;
      moved += Math.abs(dx) + Math.abs(dy);
      px = e.clientX;
      py = e.clientY;
      scroll.scrollLeft -= dx;
      scroll.scrollTop -= dy;
      if (moved > 6) scroll.classList.add("mf-suppress-click");
    });
    window.addEventListener("mouseup", function () {
      if (!panning) return;
      panning = false;
      scroll.classList.remove("mf-panning");
      if (scroll.classList.contains("mf-suppress-click")) {
        setTimeout(function () {
          scroll.classList.remove("mf-suppress-click");
        }, 90);
      }
    });
    scroll.addEventListener(
      "click",
      function (e) {
        if (scroll.classList.contains("mf-suppress-click")) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );

    $("mf-z-in").addEventListener("click", function () {
      zoomCenter(1.25);
    });
    $("mf-z-out").addEventListener("click", function () {
      zoomCenter(1 / 1.25);
    });
    $("mf-z-fit").addEventListener("click", fitView);
  }

  function truncStr(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function renderGraph() {
    var s = currentSession();
    if (!s) return;

    // v1.2.0 — FIRMA del grafo: il poll della chat (mindflow:messages, ogni
    // ~2,5 s) chiama renderAll di continuo e prima questo metodo ricostruiva
    // TUTTO l'SVG da zero a ogni giro — centinaia di elementi ricreati per
    // niente su una chat con 20 capitoli, col pannello che consumava CPU anche
    // da fermo. Se nodi, titoli, intervalli dei capitoli, attivo e selezione
    // sono identici all'ultimo disegno, il rebuild si salta del tutto.
    var sig =
      s.activeNodeId + "|" + selectedNodeId + "|" + s.nodes.length + "|" +
      s.nodes
        .map(function (n) {
          return (
            n.id + ":" + (n.title || "") + ":" + (n.chapterIndex || 0) + ":" +
            (n.chapterFrom || 0) + ":" + (n.chapterTo || 0) + ":" + (n.msgIndex || 0)
          );
        })
        .join(",");
    if (s.nodes.length > 1 && sig === lastGraphSig) return;
    lastGraphSig = sig;

    elGraph.textContent = "";
    edgeEls = [];
    nodeEls = [];
    var legend = document.getElementById("mf-legend");
    if (s.nodes.length <= 1) {
      elGraphScroll.classList.add("mf-hidden");
      elGraphEmpty.classList.remove("mf-hidden");
      if (legend) legend.classList.add("mf-hidden");
      $("mf-zoom").classList.add("mf-hidden");
      knownNodeIds = {};
      knownEdges = {};
      graphZoom = 1;
      graphSize = { w: 0, h: 0 };
      lastLayout = null;
      lastScrollTarget = null;
      lastGraphSig = null;
      return;
    }
    elGraphEmpty.classList.add("mf-hidden");
    elGraphScroll.classList.remove("mf-hidden");
    $("mf-zoom").classList.remove("mf-hidden");
    if (legend) legend.classList.remove("mf-hidden");

    var PAD_X = 20;
    var PAD_Y = 34; // spazio per la legenda in alto a destra

    var layout = layoutTree(s.nodes);
    lastLayout = layout;
    var maxX = 0;
    var maxY = 0;
    s.nodes.forEach(function (n) {
      maxX = Math.max(maxX, layout.X[n.id] || 0);
      maxY = Math.max(maxY, layout.Y[n.id] || 0);
    });
    var W = maxX + NODE_W + PAD_X * 2;
    var H = maxY + NODE_H + PAD_Y + 24;
    graphSize = { w: W, h: H };
    elGraph.setAttribute("width", String(W));
    elGraph.setAttribute("height", String(H));
    elGraph.setAttribute("viewBox", "0 0 " + W + " " + H);
    applyZoomStyle();

    elGraph.appendChild(renderGraphDefs());

    // Gruppo mondo: padding interno così nodi e legenda non si sovrappongono.
    var world = svgEl("g");
    world.setAttribute("transform", "translate(" + PAD_X + "," + PAD_Y + ")");
    elGraph.appendChild(world);

    // Catena attiva: root -> ... -> checkpoint attivo. I suoi archi pulsano.
    var chain = chainToRoot(s, s.activeNodeId);
    var chainSet = {};
    chain.forEach(function (n) {
      chainSet[n.id] = true;
    });

    // Edges prima dei nodi (sotto).
    var edgeIndex = 0;
    s.nodes.forEach(function (n) {
      if (!n.parentId) return;
      var p = layout.byId[n.parentId];
      if (!p) return;
      var x1 = (layout.X[n.parentId] || 0) + NODE_W / 2;
      var y1 = (layout.Y[n.parentId] || 0) + NODE_H;
      var x2 = (layout.X[n.id] || 0) + NODE_W / 2;
      var y2 = layout.Y[n.id] || 0;
      var d;
      if (Math.abs(y2 - y1) < 30) {
        // v1.2.0 — arco della scaletta (padre e figlio su colonne diverse,
        // quasi alla stessa altezza): curva a S morbida e orizzontale, senza
        // il «gancio» verticale che i controlli ±28 producevano qui.
        var c1x = x1 + (x2 - x1) * 0.42;
        var c2x = x1 + (x2 - x1) * 0.58;
        d =
          "M " + x1 + " " + y1 +
          " C " + c1x + " " + y1 + ", " + c2x + " " + y2 + ", " + x2 + " " + y2;
      } else {
        d =
          "M " + x1 + " " + y1 +
          " C " + x1 + " " + (y1 + 28) + ", " + x2 + " " + (y2 - 28) + ", " + x2 + " " + y2;
      }
      var live = chainSet[n.parentId] && chainSet[n.id];
      var edgeId = "mf-edge-" + n.parentId + "-" + n.id;

      var path = svgEl("path");
      path.setAttribute("class", "mf-edge" + (live ? " mf-edge-live" : ""));
      path.setAttribute("d", d);
      world.appendChild(path);
      edgeEls.push({ el: path, from: n.parentId, to: n.id });

      var isNewEdge = !knownEdges[n.parentId + "->" + n.id];
      knownEdges[n.parentId + "->" + n.id] = true;
      if (isNewEdge && knownNodeIds[n.id]) {
        // arco verso un nodo già disegnato (raro): disegnalo comunque con grazia
        drawInEdge(path);
      } else if (isNewEdge && !knownNodeIds[n.id]) {
        drawInEdge(path);
      }

      if (live) {
        // Scia animata sopra l'arco + impulso luminoso che viaggia (SMIL:
        // funziona in Chrome, Safari e Firefox senza dipendere dal CSS).
        var flow = svgEl("path");
        flow.setAttribute("class", "mf-edge-flow");
        flow.setAttribute("d", d);
        world.appendChild(flow);

        path.setAttribute("id", edgeId);
        var dot = svgEl("circle");
        dot.setAttribute("class", "mf-pulse");
        dot.setAttribute("r", "2.6");
        dot.setAttribute("filter", "url(#mf-glow)");
        var motion = svgEl("animateMotion");
        motion.setAttribute("dur", "2.2s");
        motion.setAttribute("repeatCount", "indefinite");
        motion.setAttribute("begin", (edgeIndex * 0.45).toFixed(2) + "s");
        var mpath = svgEl("mpath");
        mpath.setAttribute("href", "#" + edgeId);
        // Compatibilità SMIL: Firefox/Safari meno recenti vogliono xlink:href.
        mpath.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#" + edgeId);
        motion.appendChild(mpath);
        dot.appendChild(motion);
        world.appendChild(dot);
        edgeIndex++;
      }
    });

    // Nodi (con entrata scaglionata solo per quelli nuovi).
    var entrance = 0;
    s.nodes.forEach(function (n) {
      var isNew = !knownNodeIds[n.id];
      var isActive = n.id === s.activeNodeId;
      var g = svgEl("g");
      g.setAttribute("class", "mf-node" +
        (n.id === "root" ? " mf-root" : "") +
        (isActive ? " mf-active" : "") +
        (n.id === selectedNodeId ? " mf-selected" : "") +
        (isNew ? " mf-in" : ""));
      if (isNew) {
        g.style.animationDelay = Math.min(entrance * 70, 560) + "ms";
        entrance++;
      }
      g.setAttribute("transform", "translate(" + (layout.X[n.id] || 0) + "," + (layout.Y[n.id] || 0) + ")");
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      var label = n.id === "root" ? "Inizio conversazione" : n.title || "Checkpoint";
      g.setAttribute("aria-label", label);

      // Alone pulsante dietro il nodo attivo.
      if (isActive) {
        var halo = svgEl("circle");
        halo.setAttribute("class", "mf-halo");
        halo.setAttribute("cx", String(NODE_W / 2));
        halo.setAttribute("cy", String(NODE_H / 2));
        halo.setAttribute("r", String(NODE_H * 0.8));
        g.appendChild(halo);
      }

      var rect = svgEl("rect");
      rect.setAttribute("class", "mf-n-body");
      rect.setAttribute("width", String(NODE_W));
      rect.setAttribute("height", String(NODE_H));
      rect.setAttribute("rx", "11");
      if (isActive) rect.setAttribute("filter", "url(#mf-glow)");
      else rect.setAttribute("filter", "url(#mf-glow-soft)");
      g.appendChild(rect);

      // Tooltip nativo SVG: il capitolo con il suo intervallo e l'inizio del
      // sommario, senza dover cliccare per capirlo.
      var tip = svgEl("title");
      var rangeTxt = n.chapterIndex
        ? "Capitolo " + n.chapterIndex + "/" + n.chapterCount + " · messaggi " + n.chapterFrom + "–" + n.chapterTo
        : n.id === "root"
          ? "radice del grafo"
          : "copre i messaggi fino a #" + n.msgIndex;
      tip.textContent = (n.summary ? truncStr(n.summary.replace(/\s+/g, " "), 180) + "\n" : "") + rangeTxt;
      g.appendChild(tip);

      // Striscia laterale smeraldo sui checkpoint (il root resta pulito).
      if (n.parentId) {
        var stripe = svgEl("rect");
        stripe.setAttribute("class", "mf-n-stripe");
        stripe.setAttribute("x", "0");
        stripe.setAttribute("y", "8");
        stripe.setAttribute("width", "4.5");
        stripe.setAttribute("height", String(NODE_H - 16));
        stripe.setAttribute("rx", "2.2");
        g.appendChild(stripe);
      }

      var textX = n.parentId ? "15" : "12";
      var t1 = svgEl("text");
      t1.setAttribute("class", "mf-n-title");
      t1.setAttribute("x", textX);
      t1.setAttribute("y", "23");
      t1.textContent = truncStr(label, 20);
      g.appendChild(t1);

      var t2 = svgEl("text");
      t2.setAttribute("class", "mf-n-sub");
      t2.setAttribute("x", textX);
      t2.setAttribute("y", "40");
      t2.textContent = n.id === "root"
        ? "radice del grafo"
        : n.chapterIndex
          ? "msg " + n.chapterFrom + "–" + n.chapterTo
          : "messaggi ≤ " + n.msgIndex;
      g.appendChild(t2);

      // Chip del capitolo (miglioria v1.0.0): il numero nella storia della
      // conversazione, visibile a colpo d'occhio su ogni nodo.
      if (n.chapterIndex && n.parentId) {
        var chipBg = svgEl("circle");
        chipBg.setAttribute("class", "mf-n-chip");
        chipBg.setAttribute("cx", String(NODE_W - 11));
        chipBg.setAttribute("cy", "11");
        chipBg.setAttribute("r", "8");
        g.appendChild(chipBg);
        var chipTx = svgEl("text");
        chipTx.setAttribute("class", "mf-n-chip-t");
        chipTx.setAttribute("x", String(NODE_W - 11));
        chipTx.setAttribute("y", "14.5");
        chipTx.setAttribute("text-anchor", "middle");
        chipTx.textContent = String(n.chapterIndex);
        g.appendChild(chipTx);
      }

      g.addEventListener("click", function () {
        selectNode(n.id);
      });
      g.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          selectNode(n.id);
        }
      });
      g.addEventListener("mouseenter", function () {
        setHover(n.id);
      });
      g.addEventListener("mouseleave", clearHover);
      world.appendChild(g);
      nodeEls.push({ el: g, id: n.id });
      knownNodeIds[n.id] = true;

      // Boom di particelle per ogni checkpoint appena nato.
      if (isNew && n.parentId) {
        spawnBurst(
          world,
          (layout.X[n.id] || 0) + NODE_W / 2,
          (layout.Y[n.id] || 0) + NODE_H / 2
        );
      }
    });

    // Auto-scroll morbido verso il nodo attivo (solo quando cambia).
    if (s.activeNodeId && s.activeNodeId !== lastScrollTarget) {
      lastScrollTarget = s.activeNodeId;
      var ty = (layout.Y[s.activeNodeId] || 0) + PAD_Y;
      var tx = (layout.X[s.activeNodeId] || 0) + PAD_X;
      requestAnimationFrame(function () {
        try {
          elGraphScroll.scrollTo({
            top: Math.max(0, ty - 90),
            left: Math.max(0, tx - 100),
            behavior: "smooth",
          });
        } catch (_e) {
          elGraphScroll.scrollTop = Math.max(0, ty - 90);
        }
      });
    }
  }

  function selectNode(id) {
    selectedNodeId = id;
    renderGraph();
    renderDetails();
    var n = id ? nodeById(id) : null;
    if (n && n.parentId && HAS_RUNTIME && window.parent && window.parent !== window) {
      // Salto al messaggio nella chat: l'ultimo coperto dal checkpoint.
      window.parent.postMessage({ type: "mindflow:goto-message", index: Math.max(0, n.msgIndex - 1) }, "*");
    }
  }

  function renderDetails() {
    var s = currentSession();
    var n = selectedNodeId ? nodeById(selectedNodeId) : null;
    if (!s || !n) {
      elDetails.classList.add("mf-hidden");
      return;
    }
    elDetails.classList.remove("mf-hidden");
    elDTitle.textContent = n.title || "Checkpoint";
    var when = new Date(n.createdAt).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    elDMeta.textContent = "";
    if (n.chapterIndex) {
      // Miglioria v1.0.0: il nodo mostra DOVE sta nella storia (capitolo X di
      // Y, messaggi A–B) invece del solo indice di copertura.
      var chip = document.createElement("span");
      chip.className = "mf-chip";
      chip.textContent = "Capitolo " + n.chapterIndex + "/" + n.chapterCount;
      elDMeta.append(
        document.createTextNode(
          "creato " + when + " · messaggi " + n.chapterFrom + "–" + n.chapterTo + " · "
        )
      );
      elDMeta.append(chip);
    } else {
      elDMeta.append(
        document.createTextNode(
          "creato " + when + " · copre i messaggi fino a #" + n.msgIndex
        )
      );
    }
    elDSummary.textContent = n.summary || "Nessun sommario.";
    elDDecisions.textContent = "";
    (n.keyDecisions || []).forEach(function (d) {
      var li = document.createElement("li");
      li.textContent = d;
      elDDecisions.appendChild(li);
    });
    if (n.parentId && n.id !== s.activeNodeId) {
      elDActivate.classList.remove("mf-hidden");
    } else {
      elDActivate.classList.add("mf-hidden");
    }
    // Salto al messaggio di APERTURA del capitolo (il clic sul nodo invece
    // porta all'ultimo coperto): i due punti d'ingresso complementari.
    var gotoBtn = $("mf-d-goto");
    if (gotoBtn) {
      var canJump =
        n.parentId && HAS_RUNTIME && window.parent && window.parent !== window;
      gotoBtn.classList.toggle("mf-hidden", !canJump);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering generale
  // ---------------------------------------------------------------------------

  function renderStats() {
    var s = currentSession();
    var cps = s
      ? s.nodes.filter(function (n) {
          return n.parentId !== null;
        }).length
      : 0;
    animateNumber(elStatMsgs, sessionMessages().length);
    animateNumber(elStatCps, cps);
    animateNumber(elStatTok, estimateTokens(payloadText || compilePayload()), fmtTokens);
  }

  function renderSessionHeader() {
    var s = currentSession();
    if (s && s.imported) {
      elTitle.textContent = "Importata · " + s.title;
      elTitle.title = "Grafo costruito da una chat passata (importazione locale)";
      return;
    }
    if (info) {
      var hostLabel =
        info.host === "chatgpt" ? "ChatGPT" : info.host === "claude" ? "Claude" : info.host === "gemini" ? "Gemini" : info.host === "page" ? "Pagina web" : info.host;
      elTitle.textContent = hostLabel + " · " + (s ? s.title : info.title || "—");
      elTitle.title = info.url || "";
    } else {
      elTitle.textContent = "In attesa della chat…";
    }
  }

  function renderEngineState() {
    if (!HAS_RUNTIME) {
      elBadge.classList.remove("mf-hidden");
      elDot.classList.remove("mf-ok", "mf-err", "mf-warn");
      elEngineLabel.textContent = "";
      elEngineLabel.classList.remove("mf-ok", "mf-warn", "mf-click");
      return;
    }
    elBadge.classList.add("mf-hidden");
    var e = settings.engine;
    var configured =
      e.model &&
      (e.kind === "ollama" ||
        e.kind === "openai-compat" ||
        (e.kind === "openai" && e.keys.openai) ||
        (e.kind === "anthropic" && e.keys.anthropic));
    var kindLabel = e.kind === "ollama" ? "Ollama" : e.kind === "openai-compat" ? "motore locale" : e.kind === "openai" ? "OpenAI" : e.kind === "anthropic" ? "Anthropic" : e.kind;
    elDot.classList.remove("mf-ok", "mf-err", "mf-warn");
    elEngineLabel.classList.remove("mf-ok", "mf-warn");
    // Contesto estensione invalidato (estensione ricaricata con la pagina
    // aperta): ogni altro stato sarebbe fuorviante. Etichetta corta, il
    // dettaglio sta nel banner in cima al pannello.
    if (runtimeBroken) {
      elDot.classList.add("mf-warn");
      elEngineLabel.textContent = "ricarica la pagina";
      elEngineLabel.title =
        "L'estensione è stata aggiornata/ricaricata mentre la pagina restava aperta: le chiamate al motore falliscono. Ricarica la pagina della chat (Cmd/Ctrl+R).";
      elDot.title = elEngineLabel.title;
      return;
    }
    if (!configured) {
      elDot.classList.add("mf-err");
      elEngineLabel.textContent = "modello mancante";
      elEngineLabel.title =
        "Motore non configurato: manca il MODELLO. Apri le impostazioni e scegli il modello (es. gemma3) — senza modello non è possibile creare i checkpoint.";
      elDot.title = elEngineLabel.title;
      return;
    }
    if (engineState.checking) {
      elDot.classList.add("mf-warn");
      elEngineLabel.textContent = "verifica motore…";
      elEngineLabel.title = "Verifica della connessione al motore…";
      elDot.title = elEngineLabel.title;
      return;
    }
    // Ollama vivo ma CHIUSO alle estensioni (403): stato proprio, cura
    // precisa, pillola cliccabile verso la guida. Non è «motore spento».
    if (engineState.originBlocked) {
      elDot.classList.add("mf-warn");
      elEngineLabel.textContent = "Ollama blocca l'estensione";
      elEngineLabel.classList.add("mf-warn", "mf-click");
      elEngineLabel.title =
        "Ollama risponde ma rifiuta le richieste dell'estensione (403): per sicurezza accetta solo le pagine del browser su localhost. Si sblocca una volta per tutte: clicca qui (o premi l'ingranaggio) e segui la guida «Sblocca Ollama» — variabile OLLAMA_ORIGINS + riavvio completo di Ollama.";
      elDot.title = elEngineLabel.title;
      return;
    }
    // Server OpenAI-compatibile (LM Studio, llama.cpp, vLLM…) vivo ma CHIUSO
    // alle estensioni (403: CORS spento). Il gemello del blocco Ollama, con
    // cura diversa: l'interruttore CORS dentro il server.
    if (engineState.compatBlocked) {
      elDot.classList.add("mf-warn");
      elEngineLabel.textContent = "LM Studio blocca l'estensione";
      elEngineLabel.classList.add("mf-warn", "mf-click");
      elEngineLabel.title =
        "Il server locale risponde ma rifiuta le richieste dell'estensione (errore 403): il CORS del server è spento. Si sblocca una volta per tutte: apri LM Studio → scheda Developer (Sviluppo) → impostazioni del server → attiva «Enable CORS» (llama.cpp/vLLM: avvia il server con gli header CORS), poi aggiorna il pannello (F5) e riprova.";
      elDot.title = elEngineLabel.title;
      return;
    }
    if (engineState.reachable === true) {
      if (engineState.modelMissing) {
        // Connesso MA il modello impostato non esiste nel motore: è la trappola
        // classica (es. "gemma" vs "gemma3:latest"). Con Ollama il service
        // worker corregge il nome da solo (fixedModel): qui resta il caso in
        // cui la correzione automatica non è riuscita.
        var suggest = pickSuggestedModel(engineState.models, e.model);
        elDot.classList.add("mf-warn");
        elEngineLabel.textContent = "modello assente";
        elEngineLabel.classList.add("mf-warn");
        elEngineLabel.title =
          "MODELLO “" + e.model + "” NON presente nel motore (" + kindLabel + "): i checkpoint verrebbero rifiutati." +
          (suggest ? " Modello suggerito: " + suggest + " — correggilo nelle impostazioni." : " Controlla il nome esatto nelle impostazioni (LM Studio: chiave del modello, es. lmstudio-community/…; Ollama: ollama list).") +
          (engineState.models && engineState.models.length ? " Modelli presenti: " + engineState.models.slice(0, 6).join(", ") : "");
        elDot.title = elEngineLabel.title;
        return;
      }
      elDot.classList.add("mf-ok");
      elEngineLabel.textContent = kindLabel + " · " + e.model;
      elEngineLabel.classList.add("mf-ok");
      elEngineLabel.title = "Motore collegato e VERIFICATO: " + e.kind + " · " + e.model;
      elDot.title = elEngineLabel.title;
    } else if (engineState.reachable === false) {
      elDot.classList.add("mf-warn");
      elEngineLabel.textContent = "motore spento";
      elEngineLabel.classList.add("mf-warn");
      elEngineLabel.title =
        "Motore impostato (" + e.kind + " · " + e.model + ") ma NON raggiungibile: avvialo (es. `ollama serve`; LM Studio: Developer → Start Server). Se resta spento, controlla la PORTA: LM Studio la mostra nella scheda Developer (se la 1234 è occupata sale a 1235/1236…) e Ollama di solito è 11434. Apri le impostazioni (ingranaggio) e premi «Test connessione»: l'endpoint si corregge da solo. Finché il motore non risponde, i checkpoint restano in pausa: il grafo non viene riempito di riassunti fatti.";
      elDot.title = elEngineLabel.title;
    } else {
      elDot.classList.add("mf-warn");
      elEngineLabel.textContent = kindLabel + " · " + e.model;
      elEngineLabel.title = "Motore impostato (" + e.kind + " · " + e.model + "); connessione in verifica…";
      elDot.title = elEngineLabel.title;
    }
  }

  /** Suggerisce, tra i modelli realmente presenti nel motore, quello più
   *  vicino a quello richiesto: delega al client condiviso (match fuzzy —
   *  copre le chiavi lunghe di LM Studio e i tag Ollama); solo fallback
   *  locale se il client non c'è. */
  function pickSuggestedModel(models, wanted) {
    if (!models || !models.length) return "";
    if (MF && MF.suggestModel) return MF.suggestModel(models, wanted || "");
    var w = (wanted || "").trim().toLowerCase().split(":")[0];
    var same = models.find(function (m) {
      return (String(m).toLowerCase().split(":")[0] || "") === w;
    });
    if (same) return same;
    var preferred = models.find(function (m) {
      return /gemma|llama|mistral|phi|qwen|granite|smol/i.test(String(m));
    });
    return preferred || models[0] || "";
  }

  // Stato REALE del motore: verificato con una chiamata vera (engine-test),
  // non presunto dai campi. È la differenza tra "configurato" e "funziona".
  // models/modelMissing: il test di connessione elenca anche i modelli — se
  // quello configurato NON c'è, il pannello lo dichiara (era la causa nascosta
  // dei checkpoint con il pallino verde ma il modello sbagliato).
  var engineState = { reachable: null, checking: false, models: [], modelMissing: false, lastFixedModel: "", originBlocked: false, compatBlocked: false };
  var engineCheckTimer = null;

  // Quando Ollama blocca l'estensione (403) la pillola del motore diventa un
  // bottone: un click apre le impostazioni sulla guida «Sblocca Ollama».
  // Stesso click per il 403 dei server OpenAI-compat (LM Studio: CORS spento).
  function openUnlockGuide() {
    if (!HAS_RUNTIME) return;
    chromeSend({ type: "mindflow:open-options" });
  }
  elEngineLabel.addEventListener("click", function () {
    if (engineState.originBlocked || engineState.compatBlocked) openUnlockGuide();
  });
  elDot.addEventListener("click", function () {
    if (engineState.originBlocked || engineState.compatBlocked) openUnlockGuide();
  });

  function scheduleEngineCheck(delay) {
    if (!HAS_RUNTIME) return;
    if (engineCheckTimer) clearTimeout(engineCheckTimer);
    engineCheckTimer = setTimeout(function () {
      engineCheckTimer = null;
      runEngineCheck();
    }, delay || 300);
  }

  async function runEngineCheck() {
    if (!HAS_RUNTIME || engineState.checking) return;
    var e = settings.engine;
    var configured =
      e.model &&
      (e.kind === "ollama" ||
        e.kind === "openai-compat" ||
        (e.kind === "openai" && e.keys.openai) ||
        (e.kind === "anthropic" && e.keys.anthropic));
    if (!configured) {
      engineState.reachable = null;
      renderEngineState();
      return;
    }
    engineState.checking = true;
    renderEngineState();
    // v0.9.2: la verifica del motore è un fetch DIRETTO dal pannello (come
    // già nelle impostazioni e nel popup). Niente ping, niente service
    // worker: un fallimento qui è il MOTORE spento, non un motivo per
    // chiedere il ricaricamento della pagina (il vecchio ping-3-volte era
    // la causa del banner «aggiorna» che tornava anche dopo il reload).
    var resp = null;
    if (MF) {
      try {
        resp = await MF.testEngine(enginePayload());
      } catch (_e) {
        resp = null;
      }
    }
    // 403 di Ollama o dei server OpenAI-compat (LM Studio: CORS spento): il
    // blocco dell'origine è DETERMINISTICO e vale per ogni punto di rete
    // dell'estensione (pannello e service worker hanno la stessa origine
    // chrome-extension://…): niente verifica di riserva, si dichiara subito
    // lo stato con la cura giusta.
    if (resp && (resp.originBlocked || resp.compatBlocked)) {
      engineState.checking = false;
      engineState.reachable = false;
      engineState.originBlocked = !!resp.originBlocked;
      engineState.compatBlocked = !!resp.compatBlocked;
      renderEngineState();
      return;
    }
    if (!resp || !resp.ok) {
      // Riserva: UNA sola verifica via service worker (stesso motore, altro
      // punto di rete), per l'ipotesi remota di un fetch diretto bloccato.
      // Qualunque esito: NIENTE banner «ricarica la pagina».
      var sw = null;
      try {
        sw = await chromeSend({ type: "mindflow:engine-test", engine: enginePayload() });
      } catch (_e2) {
        sw = null;
      }
      if (sw && (sw.originBlocked || sw.compatBlocked)) resp = sw;
      else if (sw && sw.ok) resp = sw;
    }
    engineState.checking = false;
    engineState.reachable = !!(resp && resp.ok);
    engineState.originBlocked = !!(resp && resp.originBlocked);
    engineState.compatBlocked = !!(resp && resp.compatBlocked);
    var models = resp && resp.ok && Array.isArray(resp.models) ? resp.models : [];
    engineState.models = models;
    engineState.modelMissing = !!(resp && resp.ok && models.length > 0 && models.indexOf(e.model) === -1);
    if (resp && resp.ok && resp.fixedModel) {
      // Il service worker ha corretto da solo il nome del modello (es. "gemma3"
      // → "gemma3:latest") e l'ha salvato: storage.onChanged riconfigurerà il
      // pannello. Lo dichiara solo una volta per configurazione.
      if (engineState.lastFixedModel !== resp.fixedModel) {
        engineState.lastFixedModel = resp.fixedModel;
        setStatus(
          "Modello corretto automaticamente nel motore: “" + e.model + "” non esiste, uso " + resp.fixedModel + "."
        );
      }
    }
    // AUTO-CORREZIONE del modello anche via client diretto (prima era solo
    // del service worker): “gemma3” → “gemma3:latest” si sistema da solo e
    // l'etichetta in alto mostra il modello VERO del motore.
    if (engineState.modelMissing) {
      var fix = MF ? MF.suggestModel(models, e.model) : pickSuggestedModel(models, e.model);
      if (fix) {
        var old = e.model;
        settings.engine.model = fix;
        try {
          storageSet({ "mf.settings": JSON.parse(JSON.stringify(settings)) });
        } catch (_e3) {
          /* storage non scrivibile: la correzione vale per questa chiamata */
        }
        engineState.modelMissing = false;
        engineState.lastFixedModel = fix;
        setStatus(
          "Modello corretto automaticamente: “" + old + "” non esiste nel motore, uso " + fix + " (salvato nelle impostazioni)."
        );
      }
    }
    if (engineState.modelMissing) {
      var sug = pickSuggestedModel(models, e.model);
      setStatus(
        "ATTENZIONE: il modello “" + e.model + "” non esiste nel motore" + (sug ? " — suggerito: " + sug : "") + ". Correggilo nelle impostazioni: senza un modello valido i checkpoint vengono rifiutati.",
        "error"
      );
    }
    renderEngineState();
  }

  /** Invito morbido a costruire + etichetta del pulsante che segue il grafo:
   *  vuoto → «Costruisci il grafo», esistente → «Aggiorna grafo». */
  function renderSuggest() {
    var s = currentSession();
    var covered = 0;
    if (s) covered = nodeById(s.activeNodeId) ? nodeById(s.activeNodeId).msgIndex : 0;
    var span = elBtnCp.querySelector("span");
    var label = covered > 0 ? "Aggiorna grafo" : "Costruisci il grafo";
    if (span) span.textContent = label;
    var assistantSince = sessionMessages()
      .slice(covered)
      .filter(function (m) {
        return m.role === "assistant";
      }).length;
    var suggest = assistantSince >= 3;
    elBtnCp.classList.toggle("mf-suggesting", suggest);
    elCpBadge.classList.toggle("mf-hidden", !suggest);
    elCpBadge.textContent = suggest ? String(assistantSince) : "";
    elCpBadge.title =
      assistantSince + " risposte nuove dall'ultimo checkpoint — premi “" + label + "”.";
  }

  /** Stato vuoto: propone la costruzione immediata quando la chat ha messaggi. */
  function renderEmptyState() {
    var s = currentSession();
    var show = !!s && s.nodes.length <= 1 && messages.length >= 2;
    var btn = $("mf-empty-build");
    btn.classList.toggle("mf-hidden", !show);
    if (show) {
      $("mf-empty-build-label").textContent =
        "Costruisci il grafo (" + messages.length + " messaggi letti)";
    }
  }

  function renderAll() {
    renderSessionHeader();
    renderEngineState();
    renderGraph();
    renderEmptyState();
    renderDetails();
    renderStats();
    renderSuggest();
  }

  // ---------------------------------------------------------------------------
  // Azioni
  // ---------------------------------------------------------------------------

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  /**
   * Compressione LOCALE di riserva — SOLO per l'anteprima demo (nessuna
   * estensione). Nell'estensione reale i checkpoint nascono SEMPRE dal
   * motore configurato: se il motore non risponde, il checkpoint non viene
   * creato e lo stato lo dice chiaro (v0.9.0: il vecchio fallback estrattivo
   * riempiva il grafo di nodi tutti uguali).
   */
  function localMemory(segment) {
    var firstUser = null;
    var lastAssistant = null;
    segment.forEach(function (m) {
      if (m.role === "user" && !firstUser) firstUser = m;
      if (m.role === "assistant") lastAssistant = m;
    });
    var cut = function (t, n) {
      var clean = (t || "").replace(/\s+/g, " ").trim();
      return clean.length > n ? clean.slice(0, n) + "…" : clean;
    };
    var parts = [];
    if (firstUser) parts.push("Argomento: " + cut(firstUser.text, 160));
    if (lastAssistant) parts.push("Conclusione: " + cut(lastAssistant.text, 220));
    return {
      title: firstUser ? cut(firstUser.text, 48) : "Segmento di chat",
      summary: parts.join(" — ") || "Segmento privo di contenuto.",
      keyDecisions: [],
    };
  }

  var busy = false;

  /** Rilettura FRESCA delle impostazioni prima di usare il motore: se
   *  l'utente configura Ollama nelle opzioni mentre il pannello è già aperto,
   *  il pannello lo vede subito (prima restava la config vecchia: era una
   *  causa tipica dei checkpoint che ignoravano il motore configurato). */
  async function refreshSettings() {
    if (!HAS_RUNTIME) return;
    var stored = await storageGet(["mf.settings"]);
    settings = mergeSettings(stored && stored["mf.settings"]);
  }

  // Ricarica le impostazioni in tempo reale mentre il pannello è aperto.
  try {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== "local" || !changes["mf.settings"]) return;
        var next = mergeSettings(changes["mf.settings"].newValue);
        var engineChanged = JSON.stringify(next.engine) !== JSON.stringify(settings.engine);
        settings = next;
        if (engineChanged) scheduleEngineCheck(500);
        renderAll();
      });
    }
  } catch (_e) {
    /* storage eventi non disponibili: resta la rilettura pre-uso */
  }

  /**
   * RISERVA (v0.9.2): riassunto via service worker, usato solo quando il
   * fetch DIRETTO del pannello non è praticabile (errore di rete del client
   * diretto). Il lavoro parte con ACK immediato (l'id del job) e lo stato
   * si legge ogni 2 s con mindflow:job-status; il worker ora AUTO-RIPRENDE
   * i lavori interrotti, quindi anche questa via è sopravvissuta ai riavvii.
   * Un poll senza risposta è di norma solo il worker che si sta ri-svegliando:
   * si tollerano 6 mancate di fila prima di dichiarare il lavoro perduto.
   */
  function runSummarizeJob(segment, prevTitle, onWait) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;
      var misses = 0;
      var waitNotified = false;
      var startedAt = Date.now();
      function finish(out) {
        if (settled) return;
        settled = true;
        if (timer) clearInterval(timer);
        resolve(out);
      }
      chromeSend({ type: "mindflow:summarize", engine: enginePayload(), segment: segment, prevTitle: prevTitle }).then(
        function (resp) {
          if (!resp || !resp.ok || !resp.jobId) {
            finish({
              ok: false,
              error:
                resp && resp.error
                  ? resp.error
                  : "service worker non raggiungibile: riapri il pannello o ricarica la pagina della chat e riprova",
            });
            return;
          }
          // Promemoria di pazienza: il primo caricamento del modello in RAM
          // può superare il minuto; lo stato resta «busy» ma non mutolo.
          setTimeout(function () {
            if (!settled && !waitNotified) {
              waitNotified = true;
              if (typeof onWait === "function") onWait();
            }
          }, 30000);
          timer = setInterval(function () {
            if (Date.now() - startedAt > 8.5 * 60 * 1000) {
              finish({
                ok: false,
                error:
                  "Il motore non ha completato il riassunto entro 8 minuti: riprova (il primo caricamento del modello può essere lento) o usa un modello più piccolo.",
              });
              return;
            }
            chromeSend({ type: "mindflow:job-status", jobId: resp.jobId }).then(function (st) {
              if (!st || !st.ok) {
                misses++;
                if (misses >= 6) {
                  finish({
                    ok: false,
                    error:
                      "Service worker irraggiungibile durante il riassunto: riapri il pannello e riprova.",
                  });
                }
                return;
              }
              misses = 0;
              if (!st.done) return;
              if (st.status === "done" && st.result) finish({ ok: true, data: st.result });
              else finish({ ok: false, error: st.error || "riassunto non riuscito: controlla lo stato del motore e riprova." });
            });
          }, 2000);
        }
      );
    });
  }

  /** Salva nelle impostazioni il modello riparato dal client, senza rumore:
   *  la nota per l'utente arriva nello stato finale del chiamante. */
  function persistModelFix(model) {
    try {
      settings.engine.model = model;
      storageSet({ "mf.settings": JSON.parse(JSON.stringify(settings)) });
    } catch (_e) {
      /* storage non scrivibile: la correzione vale per questa chiamata */
    }
  }

  /**
   * Riassunto, via DIRETTA dal pannello (v0.9.2).
   * Il fetch vive e muore col pannello aperto: niente più «service worker
   * non raggiungibile» a metà riassunto né checkpoint lasciati in pausa.
   * Riserva: se il fetch diretto non parte PER RETE (err.isNetwork), il
   * lavoro gira nel service worker (che ora auto-riprende i lavori
   * interrotti). Gli errori di modello/JSON sono la verità del motore:
   * si mostrano e basta.
   */
  async function runSummarizeFlow(segment, prevTitle, onWait) {
    if (HAS_RUNTIME && MF) {
      var netErr = null;
      try {
        var mem = await MF.summarize(enginePayload(), segment, prevTitle);
        if (mem && mem.recoveredModel) persistModelFix(mem.recoveredModel);
        return { ok: true, data: mem };
      } catch (err) {
        if (err && err.isOriginBlocked) {
          // 403: la pillola del motore lo dichiara SUBITO (cliccabile verso
          // la guida), invece di aspettare la verifica periodica.
          engineState.originBlocked = true;
          engineState.reachable = false;
          renderEngineState();
          return { ok: false, error: err.message, originBlocked: true };
        }
        if (err && err.isCompatBlocked) {
          // 403 di LM Studio / server OpenAI-compat (CORS spento): anche qui
          // la pillola lo dichiara SUBITO con la cura precisa.
          engineState.compatBlocked = true;
          engineState.reachable = false;
          renderEngineState();
          return { ok: false, error: err.message, compatBlocked: true };
        }
        if (err && err.isNetwork) {
          netErr = err;
        } else {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (netErr) {
        var swResp = await runSummarizeJob(segment, prevTitle, onWait);
        if (swResp && swResp.ok) return swResp;
        return {
          ok: false,
          error: swResp && swResp.error ? swResp.error : netErr.message,
        };
      }
    }
    return await runSummarizeJob(segment, prevTitle, onWait);
  }

  /**
   * Pulsante UNICO (v1.0.0) «Costruisci/Aggiorna grafo» sulla chat collegata.
   *  - cattura ferma o pannello appena aperto (coda < 2): al click si fa la
   *    RACCOLTA VERA (scorrimento completo della pagina) e poi la pipeline —
   *    è la promessa «un click, un grafo», niente più grafi da una frase sola;
   *  - coda lunga (>= 5 messaggi con almeno 2 risposte): pipeline a capitoli
   *    agganciata al checkpoint attivo (mappa + compressione);
   *  - coda corta: un checkpoint singolo, come prima.
   */
  async function createCheckpoint() {
    if (busy || importRunning || collectPending) {
      // v1.1.2: prima il ritorno era MUTO e durante la mappa nessun flag era
      // attivo — un secondo clic avviava una pipeline in concorrenza che
      // raddoppiava il carico sul motore. Ora il clic riceve una risposta e
      // la pipeline in corso finisce da sola.
      setStatus(
        "Pipeline già in corso" +
          (pipelinePhase ? " (" + pipelinePhase + ")" : " (raccolta della pagina)") +
          ": alla fine il grafo si aggiorna da solo — nessun clic perso.",
        "busy"
      );
      return;
    }
    var s = currentSession();
    if (!s) {
      setStatus("Nessuna chat collegata: apri il pannello da una chat supportata.", "error");
      return;
    }
    var active = nodeById(s.activeNodeId);
    var covered = active ? active.msgIndex : 0;
    var segSource = sessionMessages();
    var tail = segSource.slice(covered).map(function (m) {
      return { role: m.role, text: m.text };
    });

    if (!s.imported && tail.length < 2 && HAS_RUNTIME && window.parent && window.parent !== window) {
      // Raccolta VERA al click, con il dialog aperto: il progresso dello
      // scorrimento è visibile e il resoconto arriva dentro il dialog.
      openImport();
      runPageCollection();
      return;
    }
    if (!tail.length) {
      setStatus("Nessun nuovo messaggio da comprimere dopo l'ultimo checkpoint.", "error");
      return;
    }
    var tailAssistants = 0;
    tail.forEach(function (m) {
      if (m.role === "assistant") tailAssistants++;
    });
    if (HAS_RUNTIME && tail.length >= 5 && tailAssistants >= 2) {
      await buildChapterChain(s, tail, {
        fromNodeId: s.activeNodeId,
        suffix: " · coda della chat",
        showProgress: false,
      });
      return;
    }

    busy = true;
    elBtnCp.disabled = true;
    var mem = null;
    try {
      if (HAS_RUNTIME) {
        await refreshSettings();
        phaseTickerStart(
          "Compressione via " + settings.engine.kind + (settings.engine.model ? " (" + settings.engine.model + ")" : "") + "…"
        );
        var resp = await runSummarizeFlow(
          tail,
          active ? active.title : "",
          function () {
            phaseTickerLabel(
              "Ancora in attesa del motore (il primo caricamento del modello in RAM può metterci più di un minuto)…"
            );
          }
        );
        if (!resp || !resp.ok || !resp.data) {
          // NIENTE checkpoint locale di ripiego: se il motore non risponde il
          // grafo resta pulito e l'utente vede il motivo vero.
          setStatus(
            "Checkpoint non creato — " + (resp && resp.error ? resp.error : "motore non disponibile."),
            "error"
          );
          return;
        }
        mem = resp.data;
      } else {
        // Solo anteprima demo (senza estensione): compressione locale silenziosa.
        setStatus("Compressione (demo)…", "busy");
        await sleep(700);
        mem = localMemory(tail);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Errore sconosciuto.", "error");
      return;
    } finally {
      phaseTickerStop();
      busy = false;
      elBtnCp.disabled = false;
    }

    var id = "cp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    s.nodes.push({
      id: id,
      parentId: s.activeNodeId,
      createdAt: Date.now(),
      title: mem.title || "Checkpoint",
      summary: mem.summary || "",
      keyDecisions: Array.isArray(mem.keyDecisions) ? mem.keyDecisions : [],
      msgIndex: Math.max(covered, segSource.length),
    });
    s.activeNodeId = id;
    s.title = info && info.title ? info.title : s.title;
    s.updatedAt = Date.now();
    selectedNodeId = id;
    saveSessions();
    payloadText = compilePayload();
    elPayload.textContent = payloadText;
    renderAll();
    var note = mem.recoveredModel
      ? " — modello corretto automaticamente nel motore: " + mem.recoveredModel + " (salvato nelle impostazioni)"
      : "";
    setStatus("Checkpoint creato: “" + (mem.title || "") + "”" + note);
  }

  function doCompile() {
    payloadText = compilePayload();
    elPayload.textContent = payloadText || "Niente da compilare.";
    renderStats();
    // Confronto con la chat intera: è il valore DEL GRAFO (il risparmio token
    // quando porti la memoria in una nuova conversazione). Stima len/4 come
    // per la chat compilata: confronto uniforme, nessuna pretesa di precisione.
    var msgs = sessionMessages();
    var origChars = 0;
    for (var i = 0; i < msgs.length; i++) origChars += (msgs[i].text || "").length;
    var comp = estimateTokens(payloadText || "");
    var origT = estimateTokens(origChars);
    var msg;
    if (origT > 0 && comp < origT) {
      var pct = Math.round((1 - comp / origT) * 100);
      msg =
        "Contesto compilato: " + fmtTokens(comp) + " token (chat intera: " +
        fmtTokens(origT) + ") — porti in una nuova chat circa il " +
        Math.max(0, 100 - pct) + "% del testo.";
    } else {
      msg = "Contesto compilato: " + fmtTokens(comp) + " token stimati.";
    }
    setStatus(msg);
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  async function doCopy() {
    var text = payloadText || compilePayload();
    if (!text) {
      setStatus("Compila prima il contesto.", "error");
      return;
    }
    var ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (_e) {
      ok = false;
    }
    if (!ok) ok = fallbackCopy(text);
    setStatus(ok ? "Contesto copiato negli appunti." : "Copia non riuscita: selezionalo dal box.", ok ? undefined : "error");
  }

  function doInject() {
    var text = payloadText || compilePayload();
    if (!text) {
      setStatus("Compila prima il contesto.", "error");
      return;
    }
    if (!HAS_RUNTIME || !window.parent || window.parent === window) {
      setStatus("L'iniezione funziona dentro la chat (estensione attiva).", "error");
      return;
    }
    lastInjectEcho = Date.now();
    window.parent.postMessage({ type: "mindflow:inject", text: text }, "*");
    setStatus("Iniezione nel prompt richiesta…");
    setTimeout(function () {
      if (Date.now() - lastInjectEcho >= 2400) {
        setStatus("Il sito non ha confermato l'iniezione: usa “Copia” e incolla a mano.", "error");
      }
    }, 2600);
  }

  var resetArmed = null;
  function doReset() {
    var s = currentSession();
    if (!s) return;
    if (!resetArmed) {
      resetArmed = setTimeout(function () {
        resetArmed = null;
        elBtnReset.title = "Azzera la memoria di questa chat";
      }, 3000);
      elBtnReset.title = "Clic di nuovo per confermare l'azzeramento";
      setStatus("Secondo clic per confermare l'azzeramento della memoria.");
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = null;
    var wasImported = !!s.imported;
    delete sessions[s.key];
    saveSessions();
    selectedNodeId = null;
    payloadText = "";
    elPayload.textContent = "";
    knownNodeIds = {};
    knownEdges = {};
    graphZoom = 1;
    lastScrollTarget = null;
    if (wasImported) {
      viewOverride = null;
      renderSessionsMenu();
    }
    currentSession(); // ricrea radice
    renderAll();
    setStatus(wasImported ? "Grafo importato eliminato." : "Memoria di questa chat azzerata.");
  }

  // ---------------------------------------------------------------------------
  // Modalità Studio (pannello largo: chat a sinistra, grafo a destra)
  // ---------------------------------------------------------------------------

  function applyWidthMode(send) {
    var mode = settings.panel && settings.panel.widthMode === "studio" ? "studio" : "narrow";
    document.body.classList.toggle("mf-studio", mode === "studio");
    $("mf-btn-width").classList.toggle("mf-on", mode === "studio");
    if (send && HAS_RUNTIME && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "mindflow:set-width", mode: mode }, "*");
    }
  }

  // ---------------------------------------------------------------------------
  // Menu sessioni + apertura rapida dei chatbot
  // ---------------------------------------------------------------------------

  function hostLabel(host) {
    return host === "chatgpt" ? "ChatGPT" : host === "claude" ? "Claude" : host === "gemini" ? "Gemini" : host === "glmchat" ? "Chat GLM" : host === "page" ? "Pagina web" : host === "import" ? "Importata" : host || "Chat";
  }

  function renderSessionsMenu() {
    var list = $("mf-sess-list");
    list.textContent = "";
    var pageKey = pageSessionKey();
    var items = [];

    if (info) {
      var ps = sessions[pageKey];
      var nCp = ps
        ? ps.nodes.filter(function (n) {
            return n.parentId !== null;
          }).length
        : 0;
      items.push({
        key: null,
        title: info.title || "Questa chat",
        meta: hostLabel(info.host) + " · chat collegata · " + nCp + " cp",
        live: true,
      });
    }

    Object.keys(sessions)
      .map(function (k) {
        return sessions[k];
      })
      .filter(function (s) {
        return s.imported;
      })
      .sort(function (a, b) {
        return b.updatedAt - a.updatedAt;
      })
      .forEach(function (s) {
        var nCp2 = s.nodes.filter(function (n) {
          return n.parentId !== null;
        }).length;
        items.push({ key: s.key, title: s.title, meta: "importata · " + nCp2 + " cp · " + (s.messages ? s.messages.length : 0) + " msg" });
      });

    if (!items.length) {
      var p = document.createElement("p");
      p.className = "mf-sess-empty";
      p.textContent = "Nessuna sessione salvata ancora.";
      list.appendChild(p);
    }

    items.forEach(function (item) {
      var b = document.createElement("button");
      b.className = "mf-sess-item" + ((viewOverride || null) === item.key ? " mf-cur" : "");
      b.setAttribute("role", "menuitem");
      var dot = document.createElement("span");
      dot.className = "mf-sess-dot" + (item.live ? " mf-live" : "");
      var box = document.createElement("span");
      box.className = "mf-sess-txt";
      var t = document.createElement("strong");
      t.textContent = item.title || "Senza titolo";
      var m = document.createElement("small");
      m.textContent = item.meta;
      box.appendChild(t);
      box.appendChild(m);
      b.appendChild(dot);
      b.appendChild(box);
      b.addEventListener("click", function () {
        hideSessionsMenu();
        switchSession(item.key);
        setStatus(item.key ? "Visualizzo il grafo importato: “" + item.title + "”." : "Tornato alla chat collegata.");
      });
      list.appendChild(b);
    });
  }

  function toggleSessionsMenu() {
    var menu = $("mf-sess-menu");
    if (menu.classList.contains("mf-hidden")) {
      renderSessionsMenu();
      menu.classList.remove("mf-hidden");
    } else {
      menu.classList.add("mf-hidden");
    }
  }

  function hideSessionsMenu() {
    $("mf-sess-menu").classList.add("mf-hidden");
  }

  function openChatbot(url) {
    if (/^\//.test(url)) {
      window.open(url, "_blank");
      return;
    }
    if (HAS_RUNTIME) {
      chromeSend({ type: "mindflow:open-url", url: url });
    } else {
      window.open(url, "_blank");
    }
  }

  // ---------------------------------------------------------------------------
  // Import di chat passate
  // ---------------------------------------------------------------------------

  function slugify(t) {
    return (
      (t || "chat")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "chat"
    );
  }

  /** Divisione meccanica di riserva — SOLO per la demo senza estensione
   *  (l'anteprima web non ha un motore). Nell'estensione reale i capitoli
   *  li decide il MOTORE (MF.planChapters): un capitolo per blocco. */
  function chunkMessages(msgs) {
    var chunks = [];
    var cur = [];
    var chars = 0;
    var assistants = 0;
    msgs.forEach(function (m) {
      cur.push(m);
      chars += m.text.length;
      if (m.role === "assistant") assistants++;
      var enough = (assistants >= 2 && chars >= 1400) || assistants >= 4 || chars >= 3600;
      if (enough) {
        chunks.push(cur);
        cur = [];
        chars = 0;
        assistants = 0;
      }
    });
    if (cur.length) {
      if (!chunks.length || cur.length >= 2) chunks.push(cur);
      else chunks[chunks.length - 1] = chunks[chunks.length - 1].concat(cur);
    }
    return chunks;
  }

  var tickTimer = null;
  var tickStart = 0;
  var tickBase = "";
  /** Il log del progress mostra SEMPRE i secondi trascorsi: un modello locale
   *  può pensare a lungo su un capitolo, ma il pannello non deve più sembrare
   *  bloccato — il numero che cresce dice che sta lavorando. */
  function tickProgressLog() {
    var el = $("mf-i-log");
    if (!el) return;
    var s = Math.floor((Date.now() - tickStart) / 1000);
    var txt = s >= 60 ? Math.floor(s / 60) + " min " + (s % 60) + " s" : s + " s";
    el.textContent = tickBase ? tickBase + " · " + txt : "";
  }

  function importProgress(show) {
    $("mf-i-progress").classList.toggle("mf-hidden", !show);
    if (!show) {
      $("mf-i-fill").style.width = "0%";
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    } else {
      tickStart = Date.now();
      if (!tickTimer) tickTimer = setInterval(tickProgressLog, 1000);
      tickProgressLog();
    }
  }

  function setProgress(done, total, logText) {
    $("mf-i-fill").style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
    tickBase = logText || "";
    $("mf-i-log").textContent = tickBase;
  }

  // --- Orologio della riga di stato (v1.1.2) -----------------------------------
  // La pipeline «coda della chat» (Aggiorna grafo) lavora senza dialog: la
  // riga di stato restava FERMA anche per minuti sullo stesso testo e il
  // pannello sembrava bloccato. L'orologio aggiunge i secondi che crescono:
  // il lavoro si VEDE vivere, come già accadeva nel dialogo di import.
  var phaseTimer = null;
  var phaseStart = 0;
  function phaseElapsedText() {
    var s = Math.floor((Date.now() - phaseStart) / 1000);
    return s >= 60 ? Math.floor(s / 60) + " min " + (s % 60) + " s" : s + " s";
  }
  function phaseTickerStart(label) {
    pipelinePhase = label;
    if (!phaseStart) phaseStart = Date.now();
    setStatus(label + " · 0 s", "busy");
    if (!phaseTimer) {
      phaseTimer = setInterval(function () {
        // v1.1.4: se un tasto (Compila/Copia/Inietta…) ha appena scritto un
        // esito o un errore, la riga lo mostra per 3 s prima che l'orologio
        // della pipeline riprenda il suo conteggio.
        if (pipelinePhase && Date.now() >= statusHoldUntil) {
          setStatus(pipelinePhase + " · " + phaseElapsedText(), "busy");
        }
      }, 1000);
    }
  }
  function phaseTickerLabel(label) {
    if (!pipelinePhase && !label) return;
    pipelinePhase = label || pipelinePhase;
    if (!phaseStart) phaseStart = Date.now();
    setStatus(pipelinePhase + " · " + phaseElapsedText(), "busy");
  }
  function phaseTickerStop() {
    if (phaseTimer) clearInterval(phaseTimer);
    phaseTimer = null;
    pipelinePhase = "";
    phaseStart = 0;
  }
  /** Risposta per i pulsanti che rifiutano mentre la pipeline lavora: prima
   *  il ritorno era MUTO e il pulsante sembrava semplicemente bloccato. */
  function pipelineBusyNotice() {
    setStatus(
      "Pipeline già in corso" + (pipelinePhase ? " (" + pipelinePhase + ")" : "") +
        ": aspetta l'esito qui sopra, il grafo si aggiorna da solo.",
      "busy"
    );
  }

  /**
   * PIPELINE UNICA (v1.0.0) — la «migliore funzione unica».
   * Usata da TUTTE le origini: raccolta della pagina, testo incollato, file
   * importato, coda della chat collegata. Tre passi:
   *   1. verifica del motore (con la cura per il 403 di Ollama);
   *   2. MAPPA dei capitoli: il motore legge la conversazione e ne decide i
   *      confini SEMANTICI (niente più taglio a caratteri). Riserva DICHIARATA
   *      per modelli restii: capitoli per scambio (il contenuto resta del
   *      motore, cambia solo il confine);
   *   3. compressione per capitolo: ogni checkpoint sa a che punto della
   *      storia si trova → titoli coerenti, nessuna ripetizione, catena
   *      leggibile come un indice.
   * opts.fromNodeId  → nodo da cui agganciare la catena (root per le import,
   *                    checkpoint attivo per la coda della chat);
   * opts.showProgress → true quando il dialog di import è aperto (progress
   *                    visibile, errori DENTRO il dialog);
   * opts.suffix → nota finale nel messaggio di esito.
   */
  async function buildChapterChain(target, msgs, opts) {
    opts = opts || {};
    var suffix = opts.suffix || "";
    var showProgress = !!opts.showProgress;
    var parentId = opts.fromNodeId || "root";
    var total = Array.isArray(msgs) ? msgs.length : 0;
    if (!total) {
      var empty0 = "Nessun contenuto sufficiente da comprimere.";
      if (showProgress) showImportError(empty0);
      else setStatus(empty0, "error");
      return false;
    }

    // Nodo di partenza: per la coda della chat il checkpoint attivo (così
    // msgIndex resta assoluto e il contesto compilato continua a quadrare).
    var parentNode = null;
    for (var q = 0; q < target.nodes.length; q++) {
      if (target.nodes[q].id === parentId) { parentNode = target.nodes[q]; break; }
    }
    var baseOffset = parentNode ? parentNode.msgIndex || 0 : 0;

    var chapters = null;
    var mapped = false;
    // v1.1.2 — la pipeline si dichiara OCCUPATA SUBITO, prima ancora di
    // verificare il motore: prima il flag partiva solo alla compressione e
    // durante verifica+mappa (anche minuti) un secondo clic avviava una
    // pipeline gemella che RADDOPPIAVA il carico sul motore locale — il vero
    // «collo di bottiglia» di Aggiorna grafo. Il finally garantisce il
    // rilascio su OGNI uscita, errori compresi.
    importRunning = true;
    importCancel = false;
    var created = 0;
    var failed = false;
    try {
      if (HAS_RUNTIME) {
        await refreshSettings();
        if (showProgress) {
          setStatus("Verifica del motore (" + settings.engine.kind + ")…", "busy");
          importProgress(true);
          setProgress(0, 0, "Verifica del motore (" + settings.engine.kind + ")…");
        } else {
          phaseTickerStart("Verifica del motore (" + settings.engine.kind + ")…");
        }
        var test = null;
        if (MF) {
          try {
            test = await MF.testEngine(enginePayload());
          } catch (_e) {
            test = null;
          }
        }
        if (!test || !test.ok) {
          var swTest = null;
          try {
            swTest = await chromeSend({ type: "mindflow:engine-test", engine: enginePayload() });
          } catch (_e2) {
            swTest = null;
          }
          if (swTest && swTest.ok) test = swTest;
          else if (swTest && (swTest.originBlocked || swTest.compatBlocked)) test = swTest;
        }
        // Ollama blocca l'estensione (403): partire significherebbe far morire la
        // catena al capitolo 1. Lo si dichiara SUBITO, con la cura.
        if (test && test.originBlocked) {
          var msg403 =
            "Grafo non creato — Ollama \u00e8 vivo ma BLOCCA le richieste dell'estensione (403). Si sblocca una volta per tutte: clicca la pillola del motore in alto (\u00abOllama blocca l'estensione\u00bb) o l'ingranaggio e segui la guida \u00abSblocca Ollama\u00bb \u2014 variabile OLLAMA_ORIGINS + riavvio completo di Ollama.";
          if (showProgress) showImportError(msg403);
          else setStatus(msg403, "error");
          return false;
        }
        // LM Studio (o server OpenAI-compat) col CORS spento: il GET passa ma
        // ogni POST muore con 403. Dichiarato SUBITO con la cura precisa,
        // prima di sprecare minuti di mappa.
        if (test && test.compatBlocked) {
          var msgCompat =
            "Grafo non creato — il server locale (LM Studio) \u00e8 vivo ma RIFIUTA le richieste dell'estensione (403: CORS spento). Si sblocca una volta per tutte: apri LM Studio \u2192 scheda Developer (Sviluppo) \u2192 impostazioni del server \u2192 attiva \u00abEnable CORS\u00bb, poi aggiorna il pannello (F5) e riprova.";
          if (showProgress) showImportError(msgCompat);
          else setStatus(msgCompat, "error");
          return false;
        }
        if (!test || !test.ok) {
          var why = test && test.error ? test.error : "motore non raggiungibile";
          var msgDead = "Grafo non creato — motore non collegato: " + why;
          if (showProgress) showImportError(msgDead);
          else setStatus(msgDead, "error");
          return false;
        }

        // MAPPA dei capitoli. Conversazione corta (o coda corta): un capitolo
        // unico — chiamare il pianificatore sarebbe solo tempo perso.
        if (total >= 5) {
          if (showProgress) {
            setStatus("Mappa dei capitoli via " + settings.engine.kind + " (" + settings.engine.model + ")…", "busy");
            setProgress(0, 0, "Il motore legge la conversazione e disegna i capitoli…");
          } else {
            phaseTickerLabel("Il motore legge " + total + " messaggi e disegna i capitoli…");
          }
          try {
            chapters = await MF.planChapters(enginePayload(), msgs);
            mapped = true;
          } catch (mapErr) {
            if (mapErr && mapErr.isOriginBlocked) {
              engineState.originBlocked = true;
              engineState.reachable = false;
              renderEngineState();
              var msgOrigin = "Grafo non creato — " + mapErr.message;
              if (showProgress) showImportError(msgOrigin);
              else setStatus(msgOrigin, "error");
              return false;
            }
            if (mapErr && mapErr.isCompatBlocked) {
              engineState.compatBlocked = true;
              engineState.reachable = false;
              renderEngineState();
              var msgCompatMap = "Grafo non creato — " + mapErr.message;
              if (showProgress) showImportError(msgCompatMap);
              else setStatus(msgCompatMap, "error");
              return false;
            }
            // Riserva DICHIARATA (mai silenziosa): il modello non ha saputo
            // mappare — capitoli per scambio, contenuto SEMPRE del motore.
            chapters = MF ? MF.exchangeChapters(msgs) : exchangeChaptersLocal(msgs);
            var mapNote =
              "Mappa semantica non riuscita con questo modello (" +
              (mapErr && mapErr.message ? String(mapErr.message).slice(0, 90) : "risposta non interpretabile") +
              "): uso capitoli per scambio.";
            setStatus(mapNote, "error");
            if (showProgress) setProgress(0, 0, "Capitoli per scambio (mappa non riuscita)…");
            await sleep(1600);
          }
        } else {
          chapters = [{ title: "", from: 1, to: total }];
        }
      } else {
        // Solo anteprima demo (senza estensione): blocchi bilanciati locali.
        chapters = [];
        var dFrom = 1;
        var dChars = 0;
        var dAsst = 0;
        for (var di = 0; di < total; di++) {
          dChars += (msgs[di].text || "").length;
          if (msgs[di].role === "assistant") dAsst++;
          var enough = (dAsst >= 2 && dChars >= 1400) || dAsst >= 4 || dChars >= 3600 || di === total - 1;
          if (enough) {
            chapters.push({ title: "", from: dFrom, to: di + 1 });
            dFrom = di + 2;
            dChars = 0;
            dAsst = 0;
          }
        }
        if (!chapters.length) chapters = [{ title: "", from: 1, to: total }];
      }

      // --- COMPRESSIONE PARALLELA (v1.1.2) ------------------------------------
      // PRIMA: un capitolo alla volta, e ognuno aspettava il precedente SOLO
      // per il suo titolo (prevTitle) — con 8-10 capitoli su un modello locale
      // erano minuti di chiamate in fila. ORA: i titoli dei capitoli li ha
      // già prodotti la MAPPA, quindi ogni capitolo è INDIPENDENTE e si parte
      // con più richieste insieme (2 sui motori locali — Ollama le parallelizza
      // se può, altrimenti le accoda in casa sua: mai peggio di prima — e 3
      // sulle API cloud). I nodi vengono aggiunti IN ORDINE man mano che i
      // risultati arrivano: la catena (parentId, chapterIndex, contesto) è
      // IDENTICA a quella della versione sequenziale.
      var isLocalEngine =
        settings.engine.kind === "ollama" || settings.engine.kind === "openai-compat";
      var CONC = !HAS_RUNTIME ? 1 : isLocalEngine ? 2 : 3;
      var jobs = new Array(chapters.length).fill(null);
      var started = 0;
      var finished = 0;
      var stopLaunch = false;
      function bumpProgress() {
        var doneN = Math.min(finished, chapters.length);
        if (showProgress) setProgress(doneN, chapters.length, "Capitoli pronti: " + doneN + "/" + chapters.length + "…");
        else phaseTickerLabel("Compressione capitoli: " + doneN + "/" + chapters.length + " pronti…");
      }
      function launchNext() {
        if (stopLaunch || importCancel || started >= chapters.length) return;
        var idx = started++;
        var ch = chapters[idx];
        var segment = msgs.slice(ch.from - 1, ch.to).map(function (m) {
          return { role: m.role, text: m.text };
        });
        if (!segment.length) {
          // Capitolo senza contenuto (buchi della mappa): la catena prosegue
          // senza nodo, come nella versione sequenziale.
          finished++;
          jobs[idx] = Promise.resolve({ ok: true, data: null, empty: true });
          launchNext();
          return;
        }
        // Il «checkpoint precedente» di ogni capitolo è il titolo che la MAPPA
        // ha dato al capitolo prima di lui: deterministico e noto in partenza
        // — è QUESTO che scioglie la dipendenza sequenziale di prima.
        var prevT = idx === 0 ? parentNode ? parentNode.title || "" : "" : chapters[idx - 1].title || "";
        var p = HAS_RUNTIME
          ? runSummarizeFlow(segment, prevT, null)
          : sleep(340).then(function () {
              return { ok: true, data: localMemory(segment) };
            });
        jobs[idx] = p.then(
          function (resp) {
            finished++;
            bumpProgress();
            launchNext(); // il posto liberato si riempie subito
            return resp;
          },
          function (err) {
            finished++;
            bumpProgress();
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        );
      }
      for (var w = 0; w < Math.min(CONC, chapters.length); w++) launchNext();
      if (showProgress) {
        setProgress(0, chapters.length, mapped ? chapters.length + " capitoli dalla mappa del motore: comprimo…" : "Comprimo " + chapters.length + " capitoli…");
      } else {
        phaseTickerLabel((mapped ? chapters.length + " capitoli dalla mappa del motore" : chapters.length + " capitoli") + ": comprimo…");
      }

      for (var ci = 0; ci < chapters.length; ci++) {
        if (importCancel) break;
        var ch = chapters[ci];
        var resp = jobs[ci] ? await jobs[ci] : null;
        if (importCancel) break;
        if (!resp || !resp.ok || !resp.data) {
          if (resp && resp.empty) continue;
          stopLaunch = true; // oltre il fallimento non si parte più
          failed = true;
          setStatus(
            "Catena interrotta al capitolo " + (ci + 1) + "/" + chapters.length + " — " +
              (resp && resp.error ? resp.error : "motore non disponibile"),
            "error"
          );
          break;
        }
        var mem = resp.data;
        var id = "cp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
        target.nodes.push({
          id: id,
          parentId: parentId,
          createdAt: Date.now(),
          title: mem.title || ch.title || "Capitolo " + (ci + 1),
          summary: mem.summary || "",
          keyDecisions: Array.isArray(mem.keyDecisions) ? mem.keyDecisions : [],
          msgIndex: Math.max(baseOffset, baseOffset + ch.to),
          chapterIndex: ci + 1,
          chapterCount: chapters.length,
          chapterFrom: baseOffset + ch.from,
          chapterTo: baseOffset + ch.to,
          imported: !opts.fromNodeId || opts.fromNodeId === "root",
        });
        parentId = id;
        target.activeNodeId = id;
        target.updatedAt = Date.now();
        created++;
        saveSessions();
        if (showProgress) setProgress(created, chapters.length, "Checkpoint " + created + "/" + chapters.length + ": " + (mem.title || ch.title || ""));
        else phaseTickerLabel("Checkpoint " + created + "/" + chapters.length + ": " + (mem.title || ch.title || "") + "…");
        renderAll();
      }
    } finally {
      importRunning = false;
      phaseTickerStop();
    }
    if (showProgress) {
      importProgress(false);
      closeImport();
    }
    if (importCancel) {
      setStatus("Costruzione annullata: i checkpoint già creati restano nel grafo.");
      renderAll();
      return false;
    }
    if (failed) {
      renderAll();
      return false;
    }
    setStatus(
      "Grafo pronto: " + created + (created === 1 ? " capitolo" : " capitoli") + " da " + total + " messaggi" +
        (mapped ? " · mappa del motore" : "") + (suffix || "") + "."
    );
    renderAll();
    return created > 0;
  }

  /** Riserva locale dei capitoli per scambio (solo se il client del motore
   *  non è caricato — non dovrebbe mai accadere nel pannello reale). */
  function exchangeChaptersLocal(msgs) {
    var out = [];
    var from = 1;
    var assistants = 0;
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i] && msgs[i].role === "assistant") assistants++;
      if (assistants >= 2 || i === msgs.length - 1) {
        out.push({ title: "Parte " + (out.length + 1), from: from, to: i + 1 });
        from = i + 2;
        assistants = 0;
      }
    }
    return out.length ? out : [{ title: "Conversazione", from: 1, to: msgs.length }];
  }

  async function importToNewSession(title, msgs) {
    if (!msgs || !msgs.length) {
      setStatus("Nessun messaggio riconosciuto: controlla il testo o il file.", "error");
      return;
    }
    var key = "import::" + slugify(title) + "-" + Date.now().toString(36);
    sessions[key] = {
      key: key,
      host: "import",
      title: title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      imported: true,
      messages: msgs,
      nodes: [
        {
          id: "root",
          parentId: null,
          createdAt: Date.now(),
          title: "Inizio conversazione",
          summary: "",
          keyDecisions: [],
          msgIndex: 0,
        },
      ],
      activeNodeId: "root",
    };
    saveSessions();
    switchSession(key);
    await buildChapterChain(sessions[key], msgs, {
      suffix: " · catena attiva dalla radice",
      showProgress: true,
    });
    renderSessionsMenu();
  }

  function openImport() {
    hideSessionsMenu();
    $("mf-import").classList.remove("mf-hidden");
    $("mf-i-paste-box").classList.add("mf-hidden");
    hideImportError();
    importProgress(false);
  }

  function closeImport() {
    $("mf-import").classList.add("mf-hidden");
    hideImportError();
  }

  /** Errore visibile dentro il dialogo di importazione (non solo la riga di stato). */
  function showImportError(msg) {
    $("mf-i-error-text").textContent = msg;
    $("mf-i-error").classList.remove("mf-hidden");
    $("mf-i-diag-out").classList.add("mf-hidden");
    setStatus(msg, "error");
  }

  function hideImportError() {
    $("mf-i-error").classList.add("mf-hidden");
    $("mf-i-diag-out").classList.add("mf-hidden");
    $("mf-i-diag-out").textContent = "";
  }

  /** Lancia la raccolta della pagina dal pannello (progress nel dialogo).
   *  Con rete di sicurezza: se il content script non risponde entro 60 s
   *  (pagina in ricarica, contesto rotto, pannello orfano) la barra non resta
   *  appesa per sempre — era uno dei motivi del pannello "bloccato". */
  var collectGuard = null;
  function runPageCollection() {
    importCancel = false; // v1.1.4: un nuovo avvio ignora un annullamento precedente
    importProgress(true);
    setProgress(0, 0, "Lettura del contenuto della pagina…");
    if (window.parent && window.parent !== window) {
      // v1.1.2: la raccolta (che include lo scorrimento della pagina) si
      // dichiara SUBITO: un «Costruisci/Aggiorna» durante la raccolta non
      // avvia una seconda pipeline in concorrenza.
      collectPending = true;
      window.parent.postMessage({ type: "mindflow:collect-all" }, "*");
    } else {
      importProgress(false);
      showImportError("La raccolta della pagina richiede l'estensione installata: usa “Incolla testo”.");
      return;
    }
    if (collectGuard) clearTimeout(collectGuard);
    collectGuard = setTimeout(function () {
      collectGuard = null;
      collectPending = false;
      importProgress(false);
      closeImport();
      setStatus(
        "La pagina non ha risposto alla raccolta: il pannello è collegato a una versione precedente dell'estensione — ricarica la pagina della chat e riprova.",
        "error"
      );
    }, 60000);
  }

  // ---------------------------------------------------------------------------
  // Eventi
  // ---------------------------------------------------------------------------

  elBtnCp.addEventListener("click", createCheckpoint);
  elBtnCompile.addEventListener("click", doCompile);
  elBtnCopy.addEventListener("click", doCopy);
  elBtnInject.addEventListener("click", doInject);
  elBtnReset.addEventListener("click", doReset);

  // --- Nuovi controlli: Studio, sessioni, import --------------------------------

  $("mf-btn-width").addEventListener("click", function () {
    settings.panel.widthMode = settings.panel.widthMode === "studio" ? "narrow" : "studio";
    storageSet({ "mf.settings": settings });
    applyWidthMode(true);
    setStatus(
      settings.panel.widthMode === "studio"
        ? "Modalità Studio: la chat resta a sinistra, il grafo si allarga a destra."
        : "Pannello stretto ripristinato."
    );
  });

  $("mf-btn-sessions").addEventListener("click", function (e) {
    e.stopPropagation();
    toggleSessionsMenu();
  });

  document.addEventListener("click", function (e) {
    var menu = $("mf-sess-menu");
    if (!menu.classList.contains("mf-hidden") && !menu.contains(e.target)) {
      hideSessionsMenu();
    }
  });

  document.querySelectorAll(".mf-sess-bots button").forEach(function (b) {
    b.addEventListener("click", function () {
      hideSessionsMenu();
      openChatbot(b.getAttribute("data-bot"));
      setStatus("Chatbot aperto in una nuova scheda: il pannello lo seguirà appena la chat è pronta.");
    });
  });

  $("mf-btn-import").addEventListener("click", openImport);
  $("mf-empty-import").addEventListener("click", openImport);
  $("mf-i-close").addEventListener("click", closeImport);

  // Costruzione immediata dallo stato vuoto: raccoglie la pagina aperta
  // (estensione) o comprime direttamente i messaggi demo (anteprima web).
  $("mf-empty-build").addEventListener("click", function () {
    if (importRunning) { pipelineBusyNotice(); return; }
    if (!HAS_RUNTIME || !window.parent || window.parent === window) {
      var s0 = currentSession();
      if (s0 && messages.length) {
        buildChapterChain(s0, messages.slice(), { suffix: " · demo", showProgress: false });
      }
      return;
    }
    openImport();
    runPageCollection();
  });

  $("mf-i-page").addEventListener("click", function () {
    if (importRunning) { pipelineBusyNotice(); return; }
    if (!HAS_RUNTIME || !window.parent || window.parent === window) {
      showImportError("La raccolta della pagina richiede l'estensione installata (qui è demo): usa “Incolla testo”.");
      return;
    }
    runPageCollection();
  });

  $("mf-i-paste-alt").addEventListener("click", function () {
    hideImportError();
    $("mf-i-paste-box").classList.remove("mf-hidden");
    $("mf-i-text").focus();
  });

  // Diagnostica DOM: chiede al content script il report dei selettori e lo
  // copia negli appunti, così si può incollare in chat per correggerli.
  $("mf-i-diag").addEventListener("click", function () {
    if (!HAS_RUNTIME || !window.parent || window.parent === window) {
      showImportError("La diagnostica richiede l'estensione installata su una chat reale.");
      return;
    }
    var btn = $("mf-i-diag");
    btn.disabled = true;
    var restore = setTimeout(function () {
      btn.disabled = false;
    }, 4000);
    var onReport = function (ev) {
      var d = ev.data || {};
      if (d.type !== "mindflow:diagnose-result" || !d.report) return;
      window.removeEventListener("message", onReport);
      clearTimeout(restore);
      btn.disabled = false;
      var json = JSON.stringify(d.report, null, 2);
      var out = $("mf-i-diag-out");
      out.textContent = json;
      out.classList.remove("mf-hidden");
      var done = function () {
        setStatus("Diagnostica copiata negli appunti: incollala in chat per far correggere i selettori.");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(done, function () {
          setStatus("Diagnostica pronta: copiala dal riquadro qui sopra.", "error");
        });
      } else {
        setStatus("Diagnostica pronta: copiala dal riquadro qui sopra.");
      }
    };
    window.addEventListener("message", onReport);
    window.parent.postMessage({ type: "mindflow:diagnose" }, "*");
  });

  $("mf-i-paste").addEventListener("click", function () {
    $("mf-i-paste-box").classList.remove("mf-hidden");
    $("mf-i-text").focus();
  });

  $("mf-i-text").addEventListener("input", function () {
    var msgs = A ? A.parseTranscriptText($("mf-i-text").value) : [];
    $("mf-i-count").textContent = msgs.length
      ? msgs.length + " turni riconosciuti"
      : "—";
  });

  $("mf-i-run").addEventListener("click", function () {
    if (importRunning) { pipelineBusyNotice(); return; }
    var text = $("mf-i-text").value;
    var msgs = A ? A.parseTranscriptText(text) : [];
    if (!msgs.length) {
      setStatus("Nessun turno riconosciuto nel testo incollato.", "error");
      return;
    }
    var title = ($("mf-i-title").value || "").trim() || "Chat importata";
    // Il dialog RESTA aperto con la barra di progresso: la pipeline lo chiude
    // da sola all'esito (prima si chiudeva subito e il progress era invisibile).
    importToNewSession(title, msgs);
  });

  $("mf-i-file").addEventListener("click", function () {
    $("mf-i-input").click();
  });

  $("mf-i-input").addEventListener("change", function () {
    if (importRunning) { pipelineBusyNotice(); return; }
    var file = $("mf-i-input").files && $("mf-i-input").files[0];
    if (!file) return;
    var name = (file.name || "").toLowerCase();
    file
      .text()
      .then(function (raw) {
        var msgs = null;
        var title = "";
        if (name.indexOf(".json") !== -1) {
          try {
            var parsed = A ? A.parseChatGptExportJson(JSON.parse(raw)) : null;
            if (parsed) {
              msgs = parsed.messages;
              title = parsed.title;
            }
          } catch (_e) {
            /* JSON malformato: sotto il messaggio d'errore */
          }
          if (!msgs) {
            setStatus("JSON non riconosciuto come export di chat (attesi conversations.json o {title, messages}).", "error");
            return;
          }
        } else {
          msgs = A ? A.parseTranscriptText(raw) : [];
        }
        if (!msgs.length) {
          setStatus("Nessun messaggio riconosciuto nel file.", "error");
          return;
        }
        var t2 = title || file.name.replace(/\.(txt|md|markdown|json)$/i, "") || "Chat importata";
        $("mf-i-input").value = "";
        // Anche qui il dialog resta aperto con il progress (chiusura a fine).
        importToNewSession(t2, msgs);
      })
      .catch(function () {
        setStatus("Lettura del file non riuscita.", "error");
      });
  });

  $("mf-i-cancel").addEventListener("click", function () {
    // v1.1.4 — «Annulla» ora torna SEMPRE indietro: prima impostava solo il
    // flag di cancellazione e il dialogo restava APERTO a coprire il pannello
    // (l'interfaccia sotto sembrava bloccata e non c'era modo di uscire se
    // non con la piccola X in alto). Ora: il dialogo si chiude sempre e la
    // cancellazione agisce davvero su ciò che sta girando.
    importCancel = true;
    closeImport();
    if (collectPending) {
      // Raccolta in corso (scorrimento della pagina): fermarla DAVVERO.
      if (collectGuard) {
        clearTimeout(collectGuard);
        collectGuard = null;
      }
      collectPending = false;
      importProgress(false);
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "mindflow:collect-cancel" }, "*");
        }
      } catch (_e) {
        /* pannello orfano: la guardia a 60 s del content script chiude tutto */
      }
      // importCancel resta true finché il content script consegna (eventuale)
      // il risultato parziale: il gestore lo riconosce e NON avvia la pipeline.
      setStatus("Raccolta annullata: nessun grafo costruito.");
      return;
    }
    if (importRunning) {
      setStatus("Annullamento richiesto: la catena si fermerà al capitolo in corso; i checkpoint già creati restano nel grafo.", "busy");
      return;
    }
    importCancel = false; // niente in corso: il flag non deve inquinare il prossimo avvio
    setStatus("Importazione annullata.");
  });

  elDActivate.addEventListener("click", function () {
    var s = currentSession();
    if (s && selectedNodeId && nodeById(selectedNodeId)) {
      s.activeNodeId = selectedNodeId;
      s.updatedAt = Date.now();
      saveSessions();
      payloadText = compilePayload();
      elPayload.textContent = payloadText;
      renderAll();
      setStatus("Checkpoint attivo: “" + nodeById(selectedNodeId).title + "”. Il prossimo checkpoint nascerà da qui.");
    }
  });
  $("mf-d-close").addEventListener("click", function () {
    selectedNodeId = null;
    renderGraph();
    renderDetails();
  });
  $("mf-d-goto").addEventListener("click", function () {
    var s = currentSession();
    var n = selectedNodeId ? nodeById(selectedNodeId) : null;
    if (!s || !n) return;
    var idx = Math.max(0, (n.chapterFrom || n.msgIndex) - 1);
    if (HAS_RUNTIME && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "mindflow:goto-message", index: idx }, "*");
      setStatus("Evidenzio in chat il messaggio di apertura del capitolo.");
    } else {
      setStatus("Il salto al messaggio funziona dentro la chat (estensione attiva).", "error");
    }
  });
  $("mf-btn-close").addEventListener("click", function () {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "mindflow:close" }, "*");
    }
  });
  $("mf-btn-settings").addEventListener("click", function () {
    if (HAS_RUNTIME) {
      chromeSend({ type: "mindflow:open-options" });
    } else {
      setStatus("Modalità demo: le impostazioni sono nella pagina della documentazione.", undefined);
    }
  });

  window.addEventListener("message", function (event) {
    // Il pannello parla SOLO col content script che lo ospita (il suo frame
    // padre). Qualsiasi altra sorgente (altri frame della pagina, script del
    // sito) non deve poter inviare messaggi MindFlow.
    if (window.parent && window.parent !== window && event.source !== window.parent) return;
    var d = event.data || {};
    if (d.type === "mindflow:messages" && d.info) {
      var changedConv =
        !info || info.host !== d.info.host || info.convKey !== d.info.convKey;
      info = d.info;
      messages = Array.isArray(d.messages) ? d.messages : [];
      if (changedConv) {
        selectedNodeId = null;
        payloadText = "";
        currentSession();
        elPayload.textContent = "";
      }
      renderAll();
      if (changedConv) {
        var cap =
          d.stats && typeof d.stats.dom === "number"
            ? " Cattura: DOM " + d.stats.dom + (d.stats.net ? " + rete " + d.stats.net : "") + "."
            : "";
        setStatus(
          messages.length
            ? (info.host === "page"
                ? "Leggo la pagina in silenzio."
                : "Leggo la chat in silenzio.") + cap
            : (info.host === "page"
                ? "Nessun testo rilevato in questa pagina: prova su una pagina con contenuto (wiki, articolo, documentazione) o usa Importa → Incolla testo."
                : "Nessun messaggio rilevato in questa pagina: scrivi qualcosa o apri una conversazione. Se la chat è già aperta, usa Importa → Diagnostica pagina.")
        );
      }
    } else if (d.type === "mindflow:messages-collected" && d.info) {
      // Risultato della raccolta con auto-scroll: RESOCONTO prima di spendere
      // il motore, poi la pipeline unica. Se la cattura ha preso poco, si vede
      // subito — niente più grafi fantasma costruiti su una frase sola.
      if (collectGuard) {
        clearTimeout(collectGuard);
        collectGuard = null;
      }
      collectPending = false; // la raccolta è finita: la guardia si apre
      info = d.info;
      messages = Array.isArray(d.messages) ? d.messages : [];
      var isPage = info && info.host === "page";
      var nUser = 0;
      var nAsst = 0;
      messages.forEach(function (m) {
        if (m.role === "assistant") nAsst++;
        else nUser++;
      });
      importProgress(false);
      renderAll();
      if (importRunning) return;
      if (importCancel) {
        // v1.1.4: l'utente ha ANNULLATO dal dialogo mentre la raccolta girava
        // (il content script consegna comunque il parziale arrivato fin qui):
        // niente pipeline fantasma dopo l'annullamento.
        importCancel = false;
        setStatus("Raccolta annullata: nessun grafo costruito.");
        return;
      }
      if (!messages.length || (isPage && nAsst === 0)) {
        showImportError(
          isPage
            ? "In questa pagina non ho trovato testo significativo. MindFlow legge pagine con contenuto (voci wiki, articoli, documentazione); su pagine quasi senza testo — es. la home di un motore di ricerca — non c'è nulla da mappare. Prova su una pagina con testo."
            : "Non ho trovato messaggi in questa pagina. La conversazione è aperta? Se sì, il sito potrebbe aver cambiato la struttura del DOM: premi “Diagnostica pagina e copia” e incolla il risultato in chat per farmi correggere i selettori."
        );
        return;
      }
      hideImportError();
      var report = isPage
        ? "Raccolte " + nAsst + " sezioni della pagina («" + (info.title || "") + "»): comprimo in capitoli…"
        : "Raccolti " + messages.length + " messaggi: " + nUser + " tuoi, " + nAsst + " dell'assistente. Comprimo…";
      setStatus(report);
      // Il dialog è aperto e copre la riga di stato: il resoconto va ANCHE nel log.
      setProgress(0, 0, report);
      var s = currentSession();
      if (!s) return;
      buildChapterChain(s, messages.slice(), {
        suffix: " · raccolti dalla pagina",
        showProgress: true,
      });
    } else if (d.type === "mindflow:inject-result") {
      lastInjectEcho = Date.now();
      setStatus(
        d.ok
          ? "Contesto iniettato nel prompt: rileggi e premi invio quando vuoi."
          : "Iniezione rifiutata dal sito: usa “Copia” e incolla a mano.",
        d.ok ? undefined : "error"
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Avvio
  // ---------------------------------------------------------------------------

  (async function init() {
    var stored = await storageGet(["mf.settings", "mf.sessions"]);
    settings = mergeSettings(stored["mf.settings"]);
    sessions = stored["mf.sessions"] && typeof stored["mf.sessions"] === "object" ? stored["mf.sessions"] : {};

    if (!HAS_RUNTIME) {
      // Demo: conversazione fittizia.
      info = { host: "demo", convKey: "demo-dashboard", title: "Dashboard spese (demo)" };
      messages = DEMO_MESSAGES;
      payloadText = "";
    } else {
      // v0.9.2: NESSUN ping di servizio all'avvio. Il pannello parla col
      // motore in fetch diretto e con la pagina via postMessage: il banner
      // «ricarica la pagina» esiste SOLO per il contesto estensione
      // invalidato DAVVERO (estensione aggiornata con la chat aperta), un
      // caso che il ricaricamento risolve davvero e che non può più tornare
      // per un falso allarme del service worker.
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "mindflow:ready" }, "*");
      }
    }
    currentSession();
    setupGraphInteraction();
    applyWidthMode(true); // la modalità Studio si riapplica ad ogni apertura
    renderAll();
    if (HAS_RUNTIME) {
      scheduleEngineCheck(600); // verifica reale del motore all'apertura
      // Riverifica leggera ogni 60 s: se Ollama torna su dopo essere stato
      // avviato, lo stato passa a verde e l'auto-checkpoint riparte da solo.
      setInterval(function () {
        if (!document.hidden) scheduleEngineCheck(0);
      }, 60000);
    }
    if (!HAS_RUNTIME) setStatus("Modalità demo — installando l'estensione il pannello si aggancia alla chat reale.");
  })();
})();
