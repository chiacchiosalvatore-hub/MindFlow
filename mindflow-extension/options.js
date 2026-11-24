/**
 * MindFlow Companion — pagina opzioni (v1.2.2).
 *
 * La configurazione del motore NON passa dal service worker: questa pagina è
 * essa stessa una pagina dell'estensione e ha già gli host_permissions verso
 * localhost/127.0.0.1 e le API cloud, quindi interroga il motore in fetch
 * diretto (engine-client.js, condiviso col pannello). Questo elimina alla
 * radice la classe d'errore «Could not establish connection. Receiving end
 * does not exist.»: anche se il service worker è spento, in errore o non
 * ancora svegliato, il test di connessione, la rilevazione automatica e la
 * prova riassunto funzionano comunque.
 *
 * Il service worker resta solo come RISERVA della prova riassunto (lavoro
 * con ACK + polling, ora con auto-ripresa dei lavori interrotti).
 */

(function () {
  "use strict";

  var $ = function (id) {
    return document.getElementById(id);
  };
  var kindEl = $("opt-kind");
  var baseEl = $("opt-base");
  var modelEl = $("opt-model");
  var openaiEl = $("opt-openai");
  var anthropicEl = $("opt-anthropic");
  var compatEl = $("opt-compat");
  var testBtn = $("btn-test");
  var detectBtn = $("btn-detect");
  var testRes = $("test-result");
  var modelList = $("model-list");
  var unlockCard = $("mf-unlock");

  // Impostazioni correnti caricate da storage: collect() le aggiorna senza
  // perdere le chiavi che questa pagina non gestisce (es. panel.widthMode).
  var current = null;

  var DEFAULTS = {
    engine: {
      kind: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "",
      keys: { openai: "", anthropic: "", compat: "" },
    },
  };

  var BASE_HINTS = {
    ollama: "Ollama: <code>http://127.0.0.1:11434</code> (nativo /api/chat). Se hai incollato un URL con /v1 lo tolgo automaticamente. Se i riassunti falliscono con «Errore 403 dal motore», Ollama sta bloccando l'estensione: segui la sezione «Sblocca Ollama» (compare da sola, oppure dopo il test).",
    "openai-compat": "LM Studio: <code>http://127.0.0.1:1234/v1</code> — llama.cpp: <code>http://127.0.0.1:8080/v1</code> — vLLM: <code>http://127.0.0.1:8000/v1</code>. IMPORTANTE: LM Studio parte sulla 1234 ma se la trova occupata sceglie DA SOLO la successiva (1235, 1236…): incolla la porta VERA mostrata nella scheda Developer — e se sbagli, «Test connessione» la corregge da solo. Se il test si collega ma il riassunto riceve un 403, attiva CORS nel server LM Studio (Developer → Enable CORS). I nomi dei modelli LM Studio sono chiavi lunghe (es. <code>lmstudio-community/Qwen3.5-9B-abliterated-GGUF</code>): il test le vede e il campo si corregge da solo.",
    openai: "Endpoint fisso https://api.openai.com/v1 — serve la chiave.",
    anthropic: "Endpoint fisso https://api.anthropic.com/v1 — serve la chiave.",
  };

  function normalizeBase(kind, raw) {
    var base = (raw || "").trim().replace(/\/+$/, "");
    if (!base) {
      base =
        kind === "ollama"
          ? "http://127.0.0.1:11434"
          : kind === "openai-compat"
            ? "http://127.0.0.1:1234/v1"
            : kind === "openai"
              ? "https://api.openai.com/v1"
              : "https://api.anthropic.com/v1";
      return base;
    }
    if (kind === "ollama") base = base.replace(/\/v1$/i, "");
    else if (kind === "openai-compat" && !/\/v\d+$/i.test(base)) base += "/v1";
    return base;
  }

  function refreshVisibility() {
    var kind = kindEl.value;
    $("row-base").classList.toggle("mf-hidden", kind === "openai" || kind === "anthropic");
    $("row-openai").classList.toggle("mf-hidden", kind !== "openai");
    $("row-anthropic").classList.toggle("mf-hidden", kind !== "anthropic");
    $("row-compat").classList.toggle("mf-hidden", kind !== "openai-compat");
    $("base-hint").innerHTML = BASE_HINTS[kind] || "";
    if (kind === "openai") baseEl.value = "https://api.openai.com/v1";
    if (kind === "anthropic") baseEl.value = "https://api.anthropic.com/v1";
  }

  // ---------------------------------------------------------------------------
  // Storage (con riconoscimento della pagina orfana)
  // ---------------------------------------------------------------------------

  /** true se il contesto dell'estensione è valido. Dopo un «ricarica
   *  estensione» la pagina opzioni rimasta aperta è orfana: ogni accesso a
   *  chrome.storage/chrome.runtime lancia «Extension context invalidated». */
  function contextAlive() {
    try {
      return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
    } catch (_e) {
      return false;
    }
  }

  function storageGet() {
    return new Promise(function (resolve) {
      if (!contextAlive()) {
        resolve(null); // pagina orfana: si parte dai predefiniti
        return;
      }
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

  function storageSet(obj) {
    if (!contextAlive()) return;
    try {
      chrome.storage.local.set(obj);
    } catch (_e) {
      /* pagina orfana: non è salvabile da qui */
    }
  }

  function load(cb) {
    storageGet().then(function (res) {
      var s =
        res && res["mf.settings"] && typeof res["mf.settings"] === "object"
          ? res["mf.settings"]
          : DEFAULTS;
      current = JSON.parse(JSON.stringify(s));
      var e = s.engine || DEFAULTS.engine;
      var p = s.panel || {};
      kindEl.value = e.kind || "ollama";
      baseEl.value = e.baseUrl || DEFAULTS.engine.baseUrl;
      modelEl.value = e.model || "";
      openaiEl.value = (e.keys && e.keys.openai) || "";
      anthropicEl.value = (e.keys && e.keys.anthropic) || "";
      compatEl.value = (e.keys && e.keys.compat) || "";
      refreshVisibility();
      if (!contextAlive()) {
        testRes.className = "test-result err";
        testRes.textContent =
          "Pagina orfana di una versione precedente: le modifiche non verranno salvate. Premi F5 per ricaricarla.";
      }
      if (cb) cb();
    });
  }

  function collect() {
    var base = current && typeof current === "object" ? current : {};
    var out = JSON.parse(JSON.stringify(base));
    out.engine = {
      kind: kindEl.value,
      baseUrl: normalizeBase(kindEl.value, baseEl.value),
      model: modelEl.value.trim(),
      keys: {
        openai: openaiEl.value.trim(),
        anthropic: anthropicEl.value.trim(),
        compat: compatEl.value.trim(),
      },
    };
    out.panel = {
      widthMode: base.panel && base.panel.widthMode === "studio" ? "studio" : "narrow",
      // autoOpen resta preservato nello storage (chiave ereditata) ma non è
      // più usato: l'auto-apertura del pannello è stata rimossa in v1.0.0.
      autoOpen: false,
    };
    return out;
  }

  function save() {
    storageSet({ "mf.settings": collect() });
  }

  // ---------------------------------------------------------------------------
  // Rete DIRETTA dalla pagina opzioni (niente service worker)
  // ---------------------------------------------------------------------------

  function fetchTimeout(url, opts, timeoutMs) {
    var ctrl = new AbortController();
    var t = setTimeout(function () {
      ctrl.abort();
    }, timeoutMs);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(function () {
      clearTimeout(t);
    });
  }

  function netHint(err) {
    var msg = err && err.message ? err.message : String(err || "errore di rete");
    if (/Failed to fetch|NetworkError|Load failed|ERR_CONNECTION_REFUSED/i.test(msg)) {
      return "Motore non raggiungibile: controlla che sia avviato (es. `ollama serve`) e che URL e porta siano corretti. Per LM Studio la porta VERA è quella mostrata nella scheda Developer (se la 1234 è occupata sale a 1235/1236…): «Test connessione» la corregge da solo.";
    }
    if (/aborted|Timeout|timed out/i.test(msg)) {
      return "Il motore non ha risposto in tempo (timeout): riprova o usa un modello più piccolo.";
    }
    return msg;
  }

  /** Elenco dei candidati locali, stesso ordine di preferenza del service
   *  worker. Per ogni candidato si provano 127.0.0.1 e localhost. v1.2.2:
   *  LM Studio sale di porta (1235, 1236, 1237) quando la 1234 è occupata e
   *  Ollama idem (11435, 11436) — il caso reale dell'utente con il server
   *  su 1235 mentre il campo diceva 1234. */
  var PROBE_CANDIDATES = [
    { kind: "ollama", baseUrl: "http://127.0.0.1:11434", label: "Ollama", path: "/api/tags" },
    { kind: "ollama", baseUrl: "http://localhost:11434", label: "Ollama", path: "/api/tags" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:1234", label: "LM Studio", path: "/v1/models" },
    { kind: "openai-compat", baseUrl: "http://localhost:1234", label: "LM Studio", path: "/v1/models" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:1235", label: "LM Studio (porta 1235)", path: "/v1/models" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:1236", label: "LM Studio (porta 1236)", path: "/v1/models" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:1237", label: "LM Studio (porta 1237)", path: "/v1/models" },
    { kind: "ollama", baseUrl: "http://127.0.0.1:11435", label: "Ollama (porta 11435)", path: "/api/tags" },
    { kind: "ollama", baseUrl: "http://127.0.0.1:11436", label: "Ollama (porta 11436)", path: "/api/tags" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:8080", label: "llama.cpp / Llamafile", path: "/v1/models" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:8000", label: "vLLM", path: "/v1/models" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:1337", label: "Jan", path: "/v1/models" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:5001", label: "KoboldCpp", path: "/v1/models" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:4891", label: "GPT4All", path: "/v1/models" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:5000", label: "text-generation-webui", path: "/v1/models" },
    { kind: "openai-compat", baseUrl: "http://127.0.0.1:8081", label: "Server OpenAI-compatibile", path: "/v1/models" },
  ];

  function parseModelList(kind, data) {
    try {
      var models = [];
      if (kind === "ollama" && data && Array.isArray(data.models)) {
        models = data.models.map(function (m) { return m.name || m.model; });
      } else if (data && Array.isArray(data.data)) {
        models = data.data.map(function (m) { return m.id; });
      } else if (data && Array.isArray(data.models)) {
        models = data.models.map(function (m) { return m.id || m.name; });
      } else if (data && Array.isArray(data.model_list)) {
        models = data.model_list.map(function (m) { return m.id || m.name || (m.meta && m.meta.alias); });
      }
      return models.filter(Boolean);
    } catch (_e) {
      return [];
    }
  }

  function probeCandidate(c) {
    var url = c.baseUrl.replace(/\/+$/, "") + c.path;
    return fetchTimeout(url, { method: "GET" }, 4000)
      .then(function (res) {
        if (!res.ok) return null;
        return res
          .json()
          .catch(function () { return null; })
          .then(function (data) {
            if (!data) return null;
            var models = parseModelList(c.kind, data);
            if (c.kind === "ollama" && !(data && Array.isArray(data.models))) return null;
            if (c.kind !== "ollama" && !models.length) return null;
            return { kind: c.kind, baseUrl: c.baseUrl, label: c.label, models: models.slice(0, 40) };
          });
      })
      .catch(function () {
        return null;
      });
  }

  function pickDefaultModel(models) {
    if (!models || !models.length) return "";
    var preferred = models.find(function (m) {
      return /gemma|llama|mistral|phi|qwen2\.?5.*instruct|qwen3|granite|smol/i.test(m);
    });
    return preferred || models[0];
  }

  function directAutodetect() {
    return Promise.all(PROBE_CANDIDATES.map(probeCandidate))
      .then(function (results) {
        var found = results.filter(Boolean);
        var seen = {};
        found = found.filter(function (r) {
          var k = r.kind + "|" + r.baseUrl.replace("localhost", "127.0.0.1");
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        });
        if (!found.length) {
          return {
            ok: false,
            error:
              "Nessun motore locale trovato. Ho provato Ollama (11434–11437), LM Studio (1234–1237), llama.cpp (8080), vLLM (8000), Jan (1337), KoboldCpp (5001), GPT4All (4891), text-generation-webui (5000). Avvia il motore (es. `ollama serve`; LM Studio: scheda Developer → Start Server) e riprova, oppure compila i campi a mano.",
          };
        }
        var best = found[0];
        return { ok: true, found: found, best: Object.assign({}, best, { model: pickDefaultModel(best.models) }) };
      });
  }

  function directEngineTest(engine) {
    var kind = engine.kind;
    var base = normalizeBase(kind, engine.baseUrl);
    var key = (engine.apiKey || "").trim();
    var url = base;
    var headers = {};
    if (kind === "ollama") {
      url = base + "/api/tags";
    } else {
      url = base + "/models";
      if (key && kind !== "anthropic") headers.Authorization = "Bearer " + key;
      if (kind === "anthropic") {
        headers["x-api-key"] = key;
        headers["anthropic-version"] = "2023-06-01";
      }
    }
    return fetchTimeout(url, { method: "GET", headers: headers }, 20000)
      .then(function (res) {
        if (!res.ok) {
          return { ok: false, error: "Il motore ha risposto con errore " + res.status + " (" + url + ")." };
        }
        return res
          .json()
          .catch(function () { return null; })
          .then(function (data) {
            var models = parseModelList(kind, data);
            return { ok: true, models: models.slice(0, 40) };
          });
      })
      .catch(function (err) {
        return { ok: false, error: netHint(err) };
      });
  }

  // ---------------------------------------------------------------------------
  // UI: rilevamento automatico + test connessione
  // ---------------------------------------------------------------------------

  /** Mostra la guida «Sblocca Ollama» e la porta in primo piano: è la cura
   *  per il 403 (Ollama rifiuta le richieste dell'estensione finché non
   *  compare OLLAMA_ORIGINS tra le variabili d'ambiente). */
  function revealUnlock() {
    if (!unlockCard) return;
    unlockCard.classList.remove("mf-hidden");
    try {
      unlockCard.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (_e) {
      /* scroll non disponibile: la sezione è comunque a pagina */
    }
  }

  // Pulsanti «Copia» della guida (valore OLLAMA_ORIGINS).
  Array.prototype.forEach.call(document.querySelectorAll(".mf-copy"), function (btn) {
    btn.addEventListener("click", function () {
      var src = document.getElementById(btn.getAttribute("data-copy"));
      var val = src ? src.textContent : "";
      var done = function () {
        btn.textContent = "Copiato!";
        setTimeout(function () {
          btn.textContent = "Copia";
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).then(done, done);
      } else {
        done();
      }
    });
  });

  function setModelOptions(models) {
    modelList.textContent = "";
    (models || []).forEach(function (m) {
      var o = document.createElement("option");
      o.value = m;
      modelList.appendChild(o);
    });
  }

  var detecting = false;

  function runDetect(fromLoad) {
    if (detecting) return;
    detecting = true;
    detectBtn.disabled = true;
    testRes.className = "test-result";
    testRes.textContent = fromLoad
      ? "Cerco un motore locale (Ollama, LM Studio, llama.cpp, vLLM…)…"
      : "Ricerca in corso: sondo le porte dei motori noti…";
    directAutodetect().then(function (resp) {
      detecting = false;
      detectBtn.disabled = false;
      if (!resp.ok) {
        testRes.className = "test-result err";
        testRes.textContent = resp.error || "Nessun motore locale trovato.";
        return;
      }
      var best = resp.best;
      kindEl.value = best.kind;
      baseEl.value = normalizeBase(best.kind, best.baseUrl);
      modelEl.value = best.model || "";
      refreshVisibility();
      setModelOptions(best.models);
      save();
      var others = (resp.found || []).filter(function (f) {
        return !(f.kind === best.kind && f.baseUrl === best.baseUrl);
      });
      testRes.className = "test-result ok";
      testRes.textContent =
        "Trovato: " + best.label + " a " + best.baseUrl +
        (best.model ? " — modello: " + best.model : "") +
        (best.models && best.models.length ? " (" + best.models.join(", ") + ")" : "") +
        (others.length
          ? " — anche: " + others.map(function (f) { return f.label + " (" + f.baseUrl + ")"; }).join(", ")
          : "");
      // Ollama trovato: controllo SUBITO anche il blocco estensioni (403),
      // così l'utente lo scopre in fase di configurazione e non al primo
      // riassunto fallito. La sonda è un POST leggero: niente caricamenti.
      if (best.kind === "ollama" && MF && MF.originProbe) {
        MF.originProbe({ kind: "ollama", baseUrl: best.baseUrl }).then(function (probe) {
          if (probe && probe.blocked) {
            revealUnlock();
            testRes.className = "test-result err";
            testRes.textContent =
              "Trovato: " + best.label + " a " + best.baseUrl +
              " — ma Ollama BLOCCA le richieste dell'estensione (errore 403): il riassunto non funzionerà finché non lo sblocchi. Segui i tre passi della guida «Sblocca Ollama» qui sotto (variabile OLLAMA_ORIGINS + riavvio completo di Ollama).";
          }
        });
      }
    });
  }

  /** Porta in primo piano la guida completa «Non riesco a connettermi»
   *  (sempre presente in pagina: il messaggio di errore ci arriva). */
  function revealTroubleshoot() {
    var card = $("mf-troubleshoot");
    if (!card) return;
    try {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (_e) {
      /* scroll non disponibile: la sezione è comunque a pagina */
    }
  }

  // ---------------------------------------------------------------------------
  // v1.2.2 — AUTO-CORREZIONE DELL'ENDPOINT (porta sbagliata)
  // ---------------------------------------------------------------------------

  function localKind(kind) {
    return kind === "ollama" || kind === "openai-compat";
  }

  /** true se l'esito del test dice «rete assente» (fetch rifiutato, timeout):
   *  l'unico caso in cui ha senso cercare il motore su una porta vicina.
   *  I 403 (CORS) e gli errori di modello hanno ciascuno la loro cura. */
  function isNetworkFailure(resp) {
    return (
      !!resp &&
      !resp.ok &&
      (resp.isNetwork ||
        /raggiungibile|Failed to fetch|NetworkError|refused|non ha risposto in tempo/i.test(resp.error || ""))
    );
  }

  /** Cerca un server dello STESSO tipo sulle porte vicine; se ce n'è UNO solo
   *  corregge endpoint (e modello, se vuoto), salva e chiama onDone(baseUrl).
   *  Con «quiet» non lascia messaggi se non trova nulla (motore semplicemente
   *  spento: niente allarmi all'apertura della pagina). */
  function applyEndpointAutofix(engine, onDone, quiet) {
    var MFc = globalThis.MindFlowEngineClient;
    if (!MFc || !MFc.scanAlternateEngines) {
      if (onDone) onDone(null);
      return;
    }
    testRes.className = "test-result";
    testRes.textContent =
      "Endpoint " + engine.baseUrl + " non raggiungibile: cerco il motore sulle porte vicine…";
    MFc.scanAlternateEngines(engine).then(function (found) {
      var current = normalizeBase(engine.kind, engine.baseUrl);
      var alts = (found || []).filter(function (f) {
        return normalizeBase(engine.kind, f.baseUrl) !== current;
      });
      if (!alts.length) {
        if (!quiet) {
          revealTroubleshoot();
          testRes.className = "test-result err";
          testRes.textContent =
            "Nessun server " +
            (engine.kind === "ollama" ? "Ollama" : "OpenAI-compatibile") +
            " attivo sulle porte provate (LM Studio 1234–1237 e affini, Ollama 11434–11437, più le vicine della porta scritta). " +
            "Avvia il motore (LM Studio: scheda Developer → Start Server; Ollama: `ollama serve`), poi premi di nuovo «Test connessione»: la porta si corregge da sola. " +
            "La guida «Non riesco a connettermi» qui sotto accompagna ogni passaggio.";
        }
        if (onDone) onDone(null);
        return;
      }
      if (alts.length > 1) {
        revealTroubleshoot();
        testRes.className = "test-result err";
        testRes.textContent =
          "L'endpoint " + engine.baseUrl + " non risponde, ma ho trovato più server attivi: " +
          alts
            .map(function (f) {
              return f.baseUrl;
            })
            .join(", ") +
          ". Scegli la porta VERA (LM Studio la mostra nella scheda Developer), incollala nel campo Endpoint e riprova.";
        if (onDone) onDone(null);
        return;
      }
      var nb = normalizeBase(engine.kind, alts[0].baseUrl);
      baseEl.value = nb;
      if (!modelEl.value && alts[0].models && alts[0].models.length) {
        var pick = MFc.suggestModel ? MFc.suggestModel(alts[0].models, "") : alts[0].models[0];
        if (pick) modelEl.value = pick;
      }
      setModelOptions(alts[0].models);
      save();
      testRes.className = "test-result ok";
      testRes.textContent =
        "Endpoint corretto automaticamente: " + current + " non rispondeva, il motore è attivo su " + nb +
        (modelEl.value ? " — modello: " + modelEl.value : "") +
        ". Ora premi «Test connessione» o «Prova riassunto».";
      if (onDone) onDone(nb);
    });
  }

  /** Verifica silenziosa quando l'endpoint (o il tipo di motore) viene
   *  impostato la prima volta e all'apertura della pagina: se la rete dice
   *  «non raggiungibile» parte l'AUTO-CORREZIONE della porta. */
  function verifyConfiguredEndpoint(fromUserEdit) {
    var MFc = globalThis.MindFlowEngineClient;
    var engine = collect().engine;
    if (!MFc || !MFc.testEngine || !localKind(engine.kind) || !engine.baseUrl || !engine.model) return;
    MFc.testEngine(engine).then(function (resp) {
      if (!resp || resp.ok) return;
      if (!isNetworkFailure(resp)) return; // 403/modello: cura propria, dettata dal test
      applyEndpointAutofix(
        engine,
        function (fixed) {
          if (fixed || !fromUserEdit) return; // corretto (o apertura silenziosa)
          revealTroubleshoot();
          testRes.className = "test-result err";
          testRes.textContent =
            (resp.error || "Motore non raggiungibile.") +
            " La porta VERA la mostra il server stesso (LM Studio: scheda Developer; Ollama: 11434): " +
            "premi «Test connessione» e la correggo da solo, oppure segui la guida «Non riesco a connettermi» qui sotto.";
        },
        !fromUserEdit
      );
    });
  }

  kindEl.addEventListener("change", refreshVisibility);
  [kindEl, baseEl, modelEl, openaiEl, anthropicEl, compatEl].forEach(function (el) {
    el.addEventListener("change", save);
  });
  // v1.2.2 — ALLA PRIMA IMPOSTAZIONE dell'endpoint (o del tipo di motore) il
  // collegamento si verifica SUBITO: se l'endpoint scritto non risponde ma un
  // server identico è attivo su una porta vicina (LM Studio parte sulla 1234
  // e sale a 1235/1236 se la trova occupata), il campo si corregge DA SOLO.
  [kindEl, baseEl].forEach(function (el) {
    el.addEventListener("change", function () {
      verifyConfiguredEndpoint(true);
    });
  });

  detectBtn.addEventListener("click", function () {
    runDetect(false);
  });

  testBtn.addEventListener("click", function () {
    runConnectionTest(false, "");
  });

  function runConnectionTest(autoFixed, fixNote) {
    var engine = collect().engine;
    save();
    testBtn.disabled = true;
    testRes.className = "test-result";
    testRes.textContent = "Verifica in corso…";
    // MF.testEngine (condiviso col pannello) include la sonda POST: rivela il
    // blocco estensioni di Ollama (403) che il solo GET /api/tags maschera.
    var tester = MF && MF.testEngine ? MF.testEngine : directEngineTest;
    tester(engine).then(function (resp) {
      testBtn.disabled = false;
      if (resp && resp.originBlocked) {
        revealUnlock();
        testRes.className = "test-result err";
        testRes.textContent =
          "Connesso, ma Ollama BLOCCA le richieste dell'estensione (errore 403): il riassunto non passerà finché non lo sblocchi. Segui i tre passi della guida «Sblocca Ollama» qui sotto (variabile OLLAMA_ORIGINS + riavvio completo di Ollama), poi premi di nuovo «Test connessione».";
        return;
      }
      if (!resp.ok) {
        // v1.2.2 — AUTO-CORREZIONE della PORTA: endpoint non raggiungibile? Se
        // un server dello stesso tipo risponde su una porta vicina, il campo
        // si corregge da solo e il test riparte UNA volta (una sola, per non
        // girare in tondo se anche il nuovo endpoint non risponde).
        if (!autoFixed && isNetworkFailure(resp) && localKind(engine.kind)) {
          applyEndpointAutofix(engine, function (fixed) {
            if (fixed) {
              runConnectionTest(
                true,
                "Endpoint corretto automaticamente (era " + normalizeBase(engine.kind, engine.baseUrl) +
                  "): il motore è attivo su " + fixed + ". "
              );
            }
          });
          return;
        }
        testRes.className = "test-result err";
        testRes.textContent =
          (resp.error || "Connessione non riuscita.") +
          " Suggerimento: premi «Rileva automaticamente».";
        if (isNetworkFailure(resp)) revealTroubleshoot();
        return;
      }
      // v1.2.1 — LM Studio (e i server OpenAI-compat) col CORS spento: il GET
      // /v1/models PASSA (endpoint collegato) ma il POST dell'estensione
      // riceve 403: ogni riassunto morirebbe. La sonda nel test lo scopre
      // ORA, con la cura precisa (interruttore CORS di LM Studio).
      if (resp.compatBlocked) {
        testRes.className = "test-result err";
        testRes.textContent = resp.error || "Il server locale rifiuta le richieste dell'estensione (403): attiva CORS nelle impostazioni del server.";
        return;
      }
      setModelOptions(resp.models);
      // ATENZIONE al falso positivo: la connessione può essere OK e il
      // MODELLO lo stesso vuoto — è esattamente la configurazione che porta
      // ai checkpoint rifiutati. Non passa inosservata.
      var needsModel = engine.kind === "ollama" || engine.kind === "openai-compat" ||
        (engine.kind === "openai" && engine.apiKey) ||
        (engine.kind === "anthropic" && engine.apiKey);
      if (needsModel && !engine.model) {
        // v1.2.1: prima di ammonire, si IMPOSTA da soli il modello migliore
        // disponibile (funziona con Ollama e LM Studio): un passaggio in meno.
        var pick = resp.models && resp.models.length && MF && MF.suggestModel ? MF.suggestModel(resp.models, "") : "";
        if (pick) {
          modelEl.value = pick;
          save();
          testRes.className = "test-result ok";
          testRes.textContent =
            fixNote + "Connesso. Modello impostato da solo: " + pick + " — ora verifica con «Prova riassunto».";
          return;
        }
        testRes.className = "test-result err";
        testRes.textContent =
          "Connesso, ma il campo MODELLO È VUOTO: senza modello i checkpoint vengono rifiutati. Scrivi o scegli un modello (es. " +
          ((resp.models && resp.models[0]) || "gemma3") + ") e riprova con «Prova riassunto».";
        return;
      }
      // v1.2.1 — AUTO-CORREZIONE del nome anche sui motori OpenAI-compat: le
      // chiavi LM Studio sono lunghe e con maiuscole («lmstudio-community/
      // Qwen3.5-9B-abliterated-GGUF») e il nome scritto a mano non combacia
      // mai alla lettera. Se il nome non c'è ma uno SIMILE sì, si corregge il
      // campo da solo: era la causa del «endpoint OK ma modello non rispondeva».
      var fixedNote = "";
      if (
        resp.models && resp.models.length && engine.model &&
        resp.models.indexOf(engine.model) === -1
      ) {
        var match = MF && MF.fuzzyFindModel ? MF.fuzzyFindModel(resp.models, engine.model) : "";
        if (!match && MF && MF.suggestModel) match = MF.suggestModel(resp.models, engine.model);
        if (match && match !== engine.model) {
          modelEl.value = match;
          save();
          fixedNote = " — modello corretto da solo: «" + match + "»";
        }
      }
      testRes.className = "test-result ok";
      testRes.textContent =
        fixNote + "Connesso." +
        (resp.models && resp.models.length
          ? " Modelli disponibili: " + resp.models.slice(0, 6).join(", ") + (resp.models.length > 6 ? "…" : "")
          : " (lista modelli non disponibile)") +
        fixedNote +
        " — ora verifica il riassunto con «Prova riassunto».";
    });
  }

  // ---------------------------------------------------------------------------
  // Prova riassunto END-TO-END (v0.9.2)
  //
  // 1. PRIMA il collegamento DIRETTO al motore (engine-client.js): è lo
  //    STESSO percorso che userà il pannello dentro le chat. Il riassunto
  //    vive con la pagina aperta, non col service worker: se funziona qui,
  //    funziona anche là.
  // 2. Se il fetch diretto non parte PER RETE, il lavoro gira nel service
  //    worker (ACK immediato + polling di job-status): la riserva ora
  //    auto-riprende i lavori interrotti.
  // 3. Gli errori di modello/JSON sono la verità del motore e restano tali:
  //    nessun ritentativo che non cambierebbero nulla, nessun fallback.
  // ---------------------------------------------------------------------------

  var tryBtn = $("btn-try");
  var MF = globalThis.MindFlowEngineClient || null;

  tryBtn.addEventListener("click", function () {
    if (!contextAlive()) {
      testRes.className = "test-result err";
      testRes.textContent = "Pagina orfana: premi F5 e riprova.";
      return;
    }
    var engine = collect().engine;
    save();
    tryBtn.disabled = true;
    testRes.className = "test-result";
    testRes.textContent =
      "Riassunto di prova via " + engine.kind + (engine.model ? " (" + engine.model + ")" : "") +
      "… collegamento DIRETTO al motore: la prima generazione può metterci un minuto (caricamento del modello in RAM).";
    var segment = [
      { role: "user", text: "Progettiamo una dashboard delle spese mensili in Python. Da dove parto?" },
      { role: "assistant", text: "Parti da tre pilastri: modello dati minimale (data, categoria, importo, note), caricamento CSV con pandas, vista aggregata per mese con groupby. Deciso: la UI resta separata dalla logica." },
    ];
    var finished = false;
    var finish = function (ok, msg) {
      if (finished) return;
      finished = true;
      tryBtn.disabled = false;
      testRes.className = ok ? "test-result ok" : "test-result err";
      testRes.textContent = msg;
    };
    setTimeout(function () {
      if (!finished) {
        testRes.textContent = "Ancora in attesa del modello (la prima generazione carica il modello in RAM: pazienta)…";
      }
    }, 20000);

    // --- Risorsa: lavoro nel service worker (ACK + polling) -------------------
    var sendJob = function (cb) {
      try {
        chrome.runtime.sendMessage({ type: "mindflow:summarize", engine: engine, segment: segment, prevTitle: "" }, function (resp) {
          void chrome.runtime.lastError;
          cb(resp || null);
        });
      } catch (_e) {
        cb(null);
      }
    };
    var startPolling = function (jobId) {
      var misses = 0;
      var startedAt = Date.now();
      var timer = setInterval(function () {
        if (Date.now() - startedAt > 8 * 60 * 1000) {
          clearInterval(timer);
          finish(false, "Il motore non ha completato il riassunto entro 8 minuti: riprova (il primo caricamento del modello può essere lento) o usa un modello più piccolo.");
          return;
        }
        try {
          chrome.runtime.sendMessage({ type: "mindflow:job-status", jobId: jobId }, function (st) {
            void chrome.runtime.lastError;
            if (!st || !st.ok) {
              misses++;
              if (misses >= 6) {
                clearInterval(timer);
                finish(false, "Riassunto NON riuscito: service worker non raggiungibile dopo sei sondaggi. Nota: il pannello nelle chat usa il collegamento DIRETTO al motore, non il worker — i checkpoint non dipendono da questo esito.");
              }
              return;
            }
            misses = 0;
            if (!st.done) return;
            clearInterval(timer);
            if (st.status === "done" && st.result) {
              finish(true, "RIASSUNTO OK dal modello (riserva via service worker): “" + (st.result.title || "") + "”. I checkpoint useranno comunque il collegamento diretto.");
            } else {
              finish(false, "Riassunto NON riuscito: " + (st.error || "motore senza risposta") + " Controlla che il motore sia avviato e riprova.");
            }
          });
        } catch (_e) {
          misses++;
          if (misses >= 6) {
            clearInterval(timer);
            finish(false, "Riassunto NON riuscito: service worker non raggiungibile. Il pannello nelle chat usa il collegamento DIRETTO al motore: i checkpoint non dipendono da questo esito.");
          }
        }
      }, 2000);
    };
    var runViaServiceWorker = function (why) {
      testRes.className = "test-result";
      testRes.textContent = "Collegamento diretto non riuscito" + (why ? " (" + why + ")" : "") + ": provo il lavoro nel service worker…";
      sendJob(function (resp) {
        if (resp && resp.ok && resp.jobId) {
          startPolling(resp.jobId);
          return;
        }
        // Secondo invio: il service worker può essere solo appena svegliato.
        setTimeout(function () {
          sendJob(function (resp2) {
            if (resp2 && resp2.ok && resp2.jobId) {
              startPolling(resp2.jobId);
              return;
            }
            finish(false, "Riassunto NON riuscito: né il collegamento diretto né il service worker raggiungono il motore. Avvia il motore (es. `ollama serve`), controlla URL e modello, poi riprova.");
          });
        }, 800);
      });
    };

    if (!MF) {
      runViaServiceWorker("client motore non caricato");
      return;
    }

    // --- 1) Collegamento DIRETTO: lo stesso percorso del pannello -------------
    MF.summarize(engine, segment, "").then(
      function (mem) {
        if (mem && mem.recoveredModel && mem.recoveredModel !== engine.model) {
          modelEl.value = mem.recoveredModel;
          save();
        }
        finish(
          true,
          "RIASSUNTO OK dal modello" +
            (mem && mem.recoveredModel ? " “" + mem.recoveredModel + "” (nome corretto da solo)" : engine.model ? " “" + engine.model + "”" : "") +
            ": “" + ((mem && mem.title) || "") + "”. Questo è lo STESSO collegamento diretto che userà il pannello in chat." +
            (mem && mem.summary ? " — " + mem.summary.slice(0, 90) + "…" : "")
        );
      },
      function (err) {
        var msg = err && err.message ? err.message : "motore senza risposta";
        if (err && err.isOriginBlocked) {
          // 403: la connessione c'è, è Ollama che rifiuta le estensioni.
          // La cura è la guida qui sotto, non un cambio di modello/URL.
          revealUnlock();
          finish(
            false,
            "Riassunto NON riuscito: Ollama è collegato ma BLOCCA le richieste dell'estensione (errore 403). Segui la guida «Sblocca Ollama» qui sotto — variabile OLLAMA_ORIGINS + riavvio completo di Ollama — poi riprova."
          );
          return;
        }
        if (err && err.isCompatBlocked) {
          // 403 di LM Studio / server OpenAI-compat: CORS spento. La cura è
          // l'interruttore CORS del server, non un cambio di modello/URL.
          finish(false, "Riassunto NON riuscito: " + msg);
          return;
        }
        if (err && err.isNetwork) {
          // Il fetch diretto non parte: ha senso provare l'altro punto di rete.
          runViaServiceWorker(msg);
          return;
        }
        // Errore di MOTORE (modello, output, chiave): la verità, senza giri.
        finish(false, "Riassunto NON riuscito: " + msg + " — il problema è il MOTORE o il suo output, non la connessione: controlla modello e stato del motore e riprova.");
      }
    );
  });

  // All'apertura: se il modello non è ancora impostato, proviamo subito a
  // individuare il motore locale da soli (installazione «un gioco da ragazzi»).
  // Concatenato al load per evitare che i due callback si sovrascrivano i campi.
  // v1.2.2: se invece il motore è GIÀ configurato, si verifica subito anche
  // il collegamento (in silenzio): endpoint spento ma server attivo su una
  // porta vicina → l'endpoint si corregge da solo, senza premere nulla.
  load(function () {
    if (!modelEl.value) runDetect(true);
    else verifyConfiguredEndpoint(false);
  });
})();
