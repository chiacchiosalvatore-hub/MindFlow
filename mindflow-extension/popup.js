/**
 * MindFlow Companion — popup della barra strumenti (v0.8.0).
 *
 * La rotella ora è raggiungibile ovunque: questo popup si apre dalla barra
 * e mostra lo stato REALE del motore (connessione verificata, non presunta)
 * e della chat corrente, con le azioni rapide. La verifica usa fetch diretto
 * dalla pagina popup: è essa stessa una pagina dell'estensione, quindi ha
 * gli host_permissions verso localhost/127.0.0.1 e non dipende dal service
 * worker.
 */

(function () {
  "use strict";

  var $ = function (id) {
    return document.getElementById(id);
  };
  var dotEl = $("pp-dot");
  var nameEl = $("pp-engine-name");
  var detailEl = $("pp-engine-detail");
  var noteEl = $("pp-engine-note");
  var tabStateEl = $("pp-tab-state");
  var tabDetailEl = $("pp-chat-detail");
  var captureEl = $("pp-capture");
  var retestBtn = $("pp-btn-retest");

  var HOST_LABEL = {
    chatgpt: "ChatGPT",
    claude: "Claude",
    gemini: "Gemini",
    glmchat: "Chat GLM",
    page: "Pagina web",
  };

  function contextAlive() {
    try {
      return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
    } catch (_e) {
      return false;
    }
  }

  function storageGet() {
    return new Promise(function (resolve) {
      if (!contextAlive()) return resolve(null);
      try {
        chrome.storage.local.get(["mf.settings"], function (res) {
          void chrome.runtime.lastError;
          resolve(res || null);
        });
      } catch (_e) {
        resolve(null);
      }
    });
  }

  function fetchTimeout(url, opts, timeoutMs) {
    var ctrl = new AbortController();
    var t = setTimeout(function () {
      ctrl.abort();
    }, timeoutMs);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(function () {
      clearTimeout(t);
    });
  }

  /** Verifica REALE del motore configurato: conta anche il modello, che il
   *  solo test di porta lascia scoperto (la trappola del modello vuoto). */
  function checkEngine(engine) {
    var kind = engine.kind;
    var base = (engine.baseUrl || "").replace(/\/+$/, "");
    var model = (engine.model || "").trim();
    if (!model) {
      return Promise.resolve({
        state: "warn",
        name: "Modello non impostato",
        detail: kind + " a " + base,
        note: "La connessione può funzionare, ma senza un modello scelto i checkpoint vengono rifiutati. Apri le impostazioni e scegli il modello (es. gemma3).",
      });
    }
    var url = kind === "ollama" ? base + "/api/tags" : base + "/models";
    return fetchTimeout(url, { method: "GET" }, 6000)
      .then(function (res) {
        if (!res.ok) {
          return {
            state: "warn",
            name: kind + " · " + model,
            detail: "il motore ha risposto con errore " + res.status,
            note: "Il modello è impostato ma il motore non risponde bene: verifica l'URL nelle impostazioni.",
          };
        }
        var okResult = {
          state: "ok",
          name: kind + " · " + model,
          detail: "connesso a " + base,
          note: "",
        };
        if (kind !== "ollama") return okResult;
        // Ollama: il GET /api/tags passa anche quando Ollama è CHIUSO alle
        // estensioni. Una piccola sonda POST (modello inesistente, niente
        // caricamenti) rivela il 403 PRIMA che l'utente tenti un riassunto.
        return fetchTimeout(
          base + "/api/chat",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "mindflow-sonda-collegamento",
              stream: false,
              messages: [{ role: "user", content: "ping" }],
            }),
          },
          8000
        )
          .then(function (res2) {
            if (res2 && res2.status === 403) {
              return {
                state: "warn",
                name: kind + " · " + model,
                detail: "Ollama blocca l'estensione (403)",
                note: "Ollama è vivo ma rifiuta le richieste dell'estensione: apri le impostazioni e segui la guida «Sblocca Ollama» (variabile OLLAMA_ORIGINS + riavvio completo di Ollama).",
              };
            }
            return okResult;
          })
          .catch(function () {
            return okResult;
          });
      })
      .catch(function () {
        return {
          state: "warn",
          name: kind + " · " + model,
          detail: "motore non raggiungibile",
          note: "Il motore è configurato ma non risponde: avvialo (es. `ollama serve`). Finché non risponde, i checkpoint restano in pausa.",
        };
      });
  }

  function renderEngine(state, name, detail, note) {
    dotEl.className = "pp-dot " + state;
    nameEl.textContent = name;
    detailEl.textContent = detail;
    if (note) {
      noteEl.textContent = note;
      noteEl.classList.remove("mf-hidden");
    } else {
      noteEl.classList.add("mf-hidden");
    }
  }

  function runEngineCheck() {
    renderEngine("busy", "Verifica del motore…", "sonda il motore configurato", "");
    storageGet().then(function (res) {
      var s = res && res["mf.settings"];
      var e = s && s.engine ? s.engine : null;
      if (!e || (!e.baseUrl && !e.model)) {
        renderEngine(
          "err",
          "Motore non configurato",
          "nessun motore salvato",
          "Apri le impostazioni: la rilevazione automatica trova Ollama (o LM Studio, llama.cpp, vLLM…) e imposta anche il modello."
        );
        return;
      }
      checkEngine(e).then(function (r) {
        renderEngine(r.state, r.name, r.detail, r.note);
      });
    });
  }

  // --- Stato della scheda corrente --------------------------------------------

  function activeTab() {
    return new Promise(function (resolve) {
      if (!contextAlive() || !chrome.tabs || !chrome.tabs.query) return resolve(null);
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          resolve(tabs && tabs[0] ? tabs[0] : null);
        });
      } catch (_e) {
        resolve(null);
      }
    });
  }

  function tabSend(tabId, msg) {
    return new Promise(function (resolve) {
      if (!contextAlive() || !chrome.tabs || !chrome.tabs.sendMessage) return resolve(null);
      try {
        chrome.tabs.sendMessage(tabId, msg, function (res) {
          void chrome.runtime.lastError;
          resolve(res || null);
        });
      } catch (_e) {
        resolve(null);
      }
    });
  }

  function renderTab(status) {
    if (!status || !status.ok) {
      tabStateEl.textContent = "MindFlow non attivo";
      tabDetailEl.textContent =
        "Questa scheda non ha il companion (o la pagina va ricaricata dopo l'installazione/aggiornamento).";
      captureEl.textContent = "";
      return;
    }
    var label = HOST_LABEL[status.host] || status.host;
    tabStateEl.textContent =
      label + " · " + status.messages + (status.host === "page" ? " blocchi" : " messaggi");
    tabDetailEl.textContent =
      (status.panelOpen ? "Il pannello è aperto in questa scheda." : "Il pannello è chiuso: «Apri il grafo qui» lo apre.") +
      " " +
      (status.host === "page" ? "Pagina: “" : "Chat: “") +
      String(status.title || "—").slice(0, 60) +
      "”";
    var parts = [];
    if (typeof status.dom === "number") parts.push("DOM " + status.dom);
    if (typeof status.net === "number" && status.net > 0) parts.push("rete " + status.net);
    captureEl.textContent = parts.length ? "cattura: " + parts.join(" + ") : "";
  }

  // --- Azioni -------------------------------------------------------------------

  $("pp-btn-settings").addEventListener("click", function () {
    if (!contextAlive()) return;
    try {
      chrome.runtime.openOptionsPage();
    } catch (_e) {
      /* popup orfano: chiudi */
    }
  });

  $("pp-btn-panel").addEventListener("click", function () {
    activeTab().then(function (tab) {
      if (!tab) return;
      tabSend(tab.id, { type: "mindflow:open-panel" }).then(function (res) {
        if (!res || !res.ok) {
          tabDetailEl.textContent =
            "Non riesco a comunicare con questa scheda: ricarica la pagina della chat e riprova.";
          return;
        }
        window.close();
      });
    });
  });

  $("pp-btn-collect").addEventListener("click", function () {
    activeTab().then(function (tab) {
      if (!tab) return;
      tabSend(tab.id, { type: "mindflow:collect" }).then(function (res) {
        if (!res || !res.ok) {
          tabDetailEl.textContent =
            "Non riesco a comunicare con questa scheda: ricarica la pagina della chat e riprova.";
          return;
        }
        tabDetailEl.textContent =
          "Raccolta avviata: il pannello scorre la chat e costruisce il grafo completo.";
      });
    });
  });

  retestBtn.addEventListener("click", runEngineCheck);

  // --- Avvio ----------------------------------------------------------------------

  if (!contextAlive()) {
    renderEngine("err", "Contesto estensione assente", "popup fuori contesto", "");
    tabStateEl.textContent = "—";
    return;
  }
  try {
    var manifest = chrome.runtime.getManifest();
    $("pp-version").textContent = "v" + manifest.version;
  } catch (_e) {
    /* titolo di versione resta placeholder */
  }
  runEngineCheck();
  activeTab().then(function (tab) {
    if (!tab) {
      renderTab(null);
      return;
    }
    tabSend(tab.id, { type: "mindflow:popup-status" }).then(function (res) {
      renderTab(res);
    });
  });
})();
