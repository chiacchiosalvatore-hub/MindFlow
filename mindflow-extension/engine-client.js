/**
 * MindFlow Companion — Client del motore condiviso (v1.2.2).
 *
 * UNA sola implementazione del dialogo col motore di riassunto (Ollama
 * nativo, server OpenAI-compatibile locale, OpenAI, Anthropic), usata dal
 * pannello dentro le chat e dalla pagina impostazioni. Parla in fetch
 * DIRETTO dalla pagina dell'estensione: il pannello è una pagina
 * dell'estensione incorporata nella chat e ha gli stessi host_permissions
 * verso il motore, quindi il riassunto vive e muore con il pannello APERTO
 * — non più col service worker, che Chrome può spegnere a metà lavoro
 * (era la causa di «Riassunto NON riuscito: service worker non
 * raggiungibile» e dei checkpoint lasciati in pausa).
 *
 * Nessun fallback euristico o estrattivo: se il motore non produce un
 * checkpoint valido, l'errore restituito è quello VERO (rete, modello,
 * JSON) e sta al chiamante mostrarlo.
 *
 * Contratto (globalThis.MindFlowEngineClient):
 *   normalizeBase(kind, raw)                       -> endpoint ripulito
 *   netHint(err)                                   -> messaggio di rete umano
 *   chat(engine, {system, user, maxTokens, temperature, timeoutMs}) -> testo
 *   testEngine(engine)                             -> {ok, models[]?, error?, isNetwork?}
 *   scanAlternateEngines(engine)                  -> [{baseUrl, models}] (auto-correzione porta)
 *   candidateAltBases(kind, rawBase)              -> endpoint alternativi da sondare
 *   summarize(engine, segment, prevTitle)          -> {title, summary, keyDecisions, recoveredModel?}
 *   planChapters(engine, msgs)                     -> [{title, from, to}] (mappa semantica)
 *   normalizeChapters(raw, total)                  -> capitoli ripuliti | null
 *   exchangeChapters(msgs)                         -> capitoli per scambio (riserva dichiarata)
 *   suggestModel(models, wanted)                   -> modello consigliato ("" se nessuno)
 *   normalizeModelKey(name)                        -> chiave normale del nome modello
 *   fuzzyFindModel(models, wanted)                 -> modello corrispondente ("" se nessuno)
 *   parseLenientJson(text)                         -> oggetto | null
 *
 * Gli errori di RETE (fetch rifiutato, timeout) sono marcati err.isNetwork:
 * il chiamante sa che può riprovare per un'altra via (es. il lavoro nel
 * service worker) senza nascondere l'errore vero all'utente.
 */

(function () {
  "use strict";

  var ENGINE_META = {
    ollama: { defaultBase: "http://127.0.0.1:11434" },
    "openai-compat": { defaultBase: "http://127.0.0.1:1234/v1" },
    openai: { defaultBase: "https://api.openai.com/v1" },
    anthropic: { defaultBase: "https://api.anthropic.com/v1" },
  };

  function normalizeBase(kind, raw) {
    var base = (raw || "").trim().replace(/\/+$/, "");
    if (!base) base = ENGINE_META[kind] ? ENGINE_META[kind].defaultBase : "";
    if (!base) return "";
    if (kind === "ollama") {
      // L'utente può aver incollato .../v1 (abitudine da altre app): l'API
      // nativa di Ollama vive alla radice, quindi lo rimuoviamo.
      base = base.replace(/\/v1$/i, "");
    } else if (kind === "openai-compat") {
      // LM Studio / llama.cpp / vLLM espongono sotto /v1: aggiungilo se manca.
      if (!/\/v\d+$/i.test(base)) base += "/v1";
    }
    return base;
  }

  function netHint(err) {
    var msg = err instanceof Error ? err.message : String(err || "errore di rete");
    if (/Failed to fetch|fetch failed|NetworkError|ERR_CONNECTION_REFUSED|Load failed/i.test(msg)) {
      return "Motore non raggiungibile. Controlla che sia avviato (es. `ollama serve`) e che URL e porta siano corretti. Per LM Studio la porta VERA è quella mostrata nella scheda Developer (se la 1234 è occupata sale a 1235/1236…): apri le impostazioni (ingranaggio) e premi «Test connessione», la porta si corregge da sola.";
    }
    if (/aborted|Timeout|timed out/i.test(msg)) {
      return "Il motore non ha risposto in tempo (timeout). Un modello locale grande può metterci minuti alla prima richiesta: riprova o usa un modello più piccolo.";
    }
    return msg;
  }

  function NetworkError(msg) {
    var e = new Error(msg);
    e.isNetwork = true;
    return e;
  }

  /** Ollama, per sicurezza, accetta dal browser solo le pagine su localhost:
   *  le ESTENSIONI partono da un'origine diversa (chrome-extension://…,
   *  moz-extension://…) e Ollama risponde 403 al POST /api/chat. Il GET
   *  /api/tags invece parte senza intestazione Origin e PASSA anche con
   *  Ollama bloccato: è il motivo per cui la connessione risultava OK e ogni
   *  riassunto moriva con «Errore 403 dal motore» (corpo vuoto, nessun
   *  dettaglio). Sblocco: variabile d'ambiente OLLAMA_ORIGINS + riavvio
   *  COMPLETO di Ollama. */
  var ORIGIN_BLOCKED_HINT =
    "Ollama \u00e8 raggiungibile ma BLOCCA le richieste dell'estensione (errore 403): per sicurezza accetta dal browser solo le pagine su localhost. " +
    "Si sblocca una volta per tutte: apri le impostazioni di MindFlow (ingranaggio nel pannello) e segui la sezione \u00abSblocca Ollama\u00bb \u2014 variabile OLLAMA_ORIGINS + riavvio completo di Ollama.";

  function OriginBlockedError(msg) {
    var e = new Error(msg || ORIGIN_BLOCKED_HINT);
    e.isOriginBlocked = true;
    return e;
  }

  /** LM Studio (e i server OpenAI-compatibili locali in generale) parte con
   *  CORS SPENTO: il GET /v1/models passa (nessuna intestazione Origin) e fa
   *  sembrare il motore collegato, ma il POST /chat/completions dell'estensione
   *  porta l'origine chrome-extension://… e il server risponde 403 — endpoint
   *  OK, ogni chiamata KO. E' il gemello esatto del 403 di Ollama, con un'altra
   *  cura: l'interruttore CORS dentro LM Studio. */
  var COMPAT_BLOCKED_HINT =
    "Il server locale (LM Studio) \u00e8 raggiungibile ma RIFIUTA le richieste dell'estensione (errore 403): \u00e8 il CORS del server, spento per impostazione predefinita. " +
    "Si sblocca una volta per tutte: apri LM Studio \u2192 scheda Developer (Sviluppo) \u2192 impostazioni del server \u2192 attiva \u00abEnable CORS\u00bb (Llama.cpp/vLLM: avvia il server con gli header CORS), poi premi di nuovo \u00abTest connessione\u00bb.";

  function CompatBlockedError(msg) {
    var e = new Error(msg || COMPAT_BLOCKED_HINT);
    e.isCompatBlocked = true;
    return e;
  }

  /** Sonda il blocco estensioni di Ollama SENZA caricare modelli: un POST
   *  /api/chat con nome modello inesistente. Se l'origine \u00e8 bloccata Ollama
   *  risponde subito 403 (il middleware CORS scatta prima di tutto); se \u00e8
   *  sbloccata risponde 404 \u00abmodel not found\u00bb in pochi millisecondi, senza
   *  toccare la RAM. E' lo STESSO tipo di richiesta che poi crea i checkpoint:
   *  se la sonda passa, passa anche il riassunto. */
  async function originProbe(engine) {
    if (!engine || engine.kind !== "ollama") return { blocked: false };
    var base = normalizeBase("ollama", engine.baseUrl);
    try {
      var res = await fetchTimeout(
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
        12000
      );
      if (res && res.status === 403) return { blocked: true };
      return { blocked: false };
    } catch (_e) {
      return { blocked: false, unreachable: true };
    }
  }

  /** Sonda il CORS del server OpenAI-compatibile locale SENZA toccare modelli:
   *  un POST /chat/completions con nome modello inesistente. CORS attivo → il
   *  server risponde subito 400/404 «model not found» (la richiesta PASSA);
   *  CORS spento → 403 prima ancora di guardare il corpo. E' lo STESSO tipo di
   *  richiesta che poi crea i checkpoint: se la sonda passa, passa anche il
   *  riassunto. */
  async function compatOriginProbe(engine) {
    if (!engine || engine.kind !== "openai-compat") return { blocked: false };
    var base = normalizeBase("openai-compat", engine.baseUrl);
    try {
      var res = await fetchTimeout(
        base + "/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "mindflow-sonda-collegamento",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        },
        12000
      );
      if (res && res.status === 403) return { blocked: true };
      return { blocked: false };
    } catch (_e) {
      return { blocked: false, unreachable: true };
    }
  }

  /** Diagnosi di una risposta Ollama 200 OK SENZA testo. Ollama allega a ogni
   *  risposta i contatori di lavoro: se il modello è vivo ma NON ha scritto
   *  nulla (0 token generati) la causa tipica è il FILE modello (corrotto o
   *  incompleto — tipico quando i modelli vengono spostati su disco esterno)
   *  oppure un disco in riposo; se il caricamento è durato secondi lunghi il
   *  modello è stato ripreso DAL DISCO (freddo). Il messaggio lo dice
   *  esplicitamente invece del generico «priva di contenuto». */
  function ollamaEmptyDiagnosis(data) {
    var d = data || {};
    var evalCount = typeof d.eval_count === "number" ? d.eval_count : null;
    var loadSec = typeof d.load_duration === "number" ? d.load_duration / 1e9 : null;
    var totalSec = typeof d.total_duration === "number" ? d.total_duration / 1e9 : null;
    var bits = [];
    if (evalCount === null) bits.push("nessun token conteggiato");
    else if (evalCount === 0) bits.push("0 token generati");
    else bits.push(evalCount + " token generati ma testo assente");
    if (loadSec !== null && loadSec >= 1)
      bits.push("modello caricato in " + loadSec.toFixed(1).replace(".", ",") + " s");
    if (totalSec !== null && totalSec >= 1)
      bits.push("risposta totale in " + totalSec.toFixed(1).replace(".", ",") + " s");
    if (d.done_reason) bits.push("done_reason: " + d.done_reason);
    var msg = "Risposta Ollama priva di contenuto (" + bits.join(", ") + ").";
    if (evalCount === 0 && loadSec !== null && loadSec >= 2) {
      msg += " Il motore ha caricato il modello dal disco e poi NON ha scritto nulla: se i modelli stanno su disco esterno controlla che il disco sia acceso e i file integri (nel terminale: ollama run <modello> \"ciao\" — se anche lì tace, ri-scarica il modello).";
    } else if (evalCount === 0) {
      msg += " Il modello ha risposto MA senza testo: verifica il modello nel terminale (ollama run <modello> \"ciao\") — file modello corrotti/incompleti o modello inadatto danno risposte vuote.";
    } else {
      msg += " Riprova; se persiste, verifica il modello nel terminale (ollama run <modello> \"ciao\").";
    }
    return msg;
  }

  /** PING di controllo (SOLO percorso d'errore, 12 token): dice se il modello
   *  è muto per QUALSIASI prompt (file modello corrotto, disco esterno spento,
   *  memoria insufficiente) o se il vuoto era un glitch del singolo prompt.
   *  Effetto collaterale utile: se il modello era a freddo, il ping lo carica
   *  in RAM (keep_alive 15m) e il riassunto riprovato subito parte caldo. */
  async function ollamaPing(engine) {
    try {
      var out = await chat(engine, {
        user: "Rispondi con esattamente una parola: OK",
        maxTokens: 12,
        temperature: 0,
        numCtx: 2048,
        timeoutMs: 120000,
        jsonMode: false,
      });
      return out && out.trim() ? "ok" : "empty";
    } catch (err) {
      if (err && err.isNetwork) return "timeout";
      return err instanceof Error ? err.message : String(err);
    }
  }

  function fetchTimeout(url, opts, timeoutMs) {
    var ctrl = new AbortController();
    var t = setTimeout(function () {
      ctrl.abort();
    }, timeoutMs);
    try {
      return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(function () {
        clearTimeout(t);
      });
    } catch (err) {
      // fetch può lanciare in modo sincrono in contesti senza rete
      clearTimeout(t);
      return Promise.reject(err);
    }
  }

  /** Completamento normalizzato -> testo. Gli errori di RETE sono marcati
   *  isNetwork: sono gli unici per cui ha senso ritentare per un'altra via. */
  async function chat(engine, opts) {
    var o = opts || {};
    var kind = engine.kind;
    var base = normalizeBase(kind, engine.baseUrl);
    var model = (engine.model || "").trim();
    var key = (engine.apiKey || "").trim();
    if (!model) throw new Error("Modello non impostato nelle impostazioni dell'estensione.");
    var t = Math.max(15000, o.timeoutMs || 120000);

    var url, init;
    if (kind === "ollama") {
      url = base + "/api/chat";
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model,
          stream: false,
          // "format": "json" vincola l'output del modello a un oggetto JSON
          // valido: con gemma e modelli piccoli elimina il problema
          // "risposta non interpretabile" (la causa tipica dei checkpoint rifiutati).
          // Disattivabile (jsonMode:false) per il 2° tentativo dopo una risposta
          // VUOTA: se la modalità JSON di Ollama tace, quella libera può
          // comunque produrre un JSON incorniciato che il parser tollerante legge.
          ...(o.jsonMode !== false ? { format: "json" } : {}),
          // Il modello resta caricato in memoria 15 minuti dopo la risposta:
          // il checkpoint successivo non paga di nuovo il caricamento a freddo.
          keep_alive: "15m",
          messages: [
            ...(o.system ? [{ role: "system", content: o.system }] : []),
            { role: "user", content: o.user || "" },
          ],
          options: {
            temperature: o.temperature != null ? o.temperature : 0.3,
            num_predict: o.maxTokens != null ? o.maxTokens : 700,
            // Finestra di contesto esplicita SOLO quando serve leggere molto
            // testo (la mappa dei capitoli): il default di Ollama è piccolo e
            // troncherebbe in silenzio la conversazione. Multi-motore: il
            // campo esiste solo per Ollama, gli altri motori lo ignorano.
            ...(o.numCtx ? { num_ctx: Math.max(2048, Math.round(o.numCtx)) } : {}),
          },
        }),
      };
    } else if (kind === "openai-compat" || kind === "openai") {
      if (kind === "openai" && !key) {
        throw new Error("Chiave API OpenAI mancante: inseriscila nelle impostazioni dell'estensione.");
      }
      url = base + "/chat/completions";
      var headers = { "Content-Type": "application/json" };
      if (key) headers.Authorization = "Bearer " + key;
      init = {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          model: model,
          temperature: o.temperature != null ? o.temperature : 0.3,
          max_tokens: o.maxTokens != null ? o.maxTokens : 700,
          stream: false,
          messages: [
            ...(o.system ? [{ role: "system", content: o.system }] : []),
            { role: "user", content: o.user || "" },
          ],
        }),
      };
    } else if (kind === "anthropic") {
      if (!key) {
        throw new Error("Chiave API Anthropic mancante: inseriscila nelle impostazioni dell'estensione.");
      }
      url = base + "/messages";
      init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: model,
          max_tokens: o.maxTokens != null ? o.maxTokens : 700,
          temperature: o.temperature != null ? o.temperature : 0.3,
          ...(o.system ? { system: o.system } : {}),
          messages: [{ role: "user", content: o.user || "" }],
        }),
      };
    } else {
      throw new Error("Tipo di motore sconosciuto: " + kind);
    }

    var res;
    try {
      res = await fetchTimeout(url, init, t);
    } catch (err) {
      throw NetworkError(netHint(err));
    }
    if (!res.ok) {
      // 403 + Ollama: il middleware CORS rifiuta l'origine dell'estensione
      // (risposta con corpo vuoto). Non \u00e8 un problema di motore spento n\u00e9 di
      // modello: ha una cura precisa (OLLAMA_ORIGINS) e la comunichiamo.
      if (res.status === 403 && kind === "ollama") {
        throw OriginBlockedError();
      }
      // 403 + OpenAI-compat locale (LM Studio & co.): il CORS del server rifiuta
      // l'origine dell'estensione. Cura precisa (interruttore CORS), non un
      // problema di modello né di motore spento.
      if (res.status === 403 && kind === "openai-compat") {
        throw CompatBlockedError();
      }
      var detail = "Errore " + res.status + " dal motore";
      try {
        var body = await res.json();
        var inner = body && body.error;
        if (typeof inner === "string") detail = inner;
        else if (inner && inner.message) detail = inner.message;
        else if (body && body.message) detail = body.message;
      } catch (_e) {
        /* corpo non JSON */
      }
      throw new Error(detail + ".");
    }

    var data = await res.json();
    if (kind === "ollama") {
      // Ollama risponde a volte 200 con {error: "..."} (es. modello che non
      // carica per memoria insufficiente): senza questo controllo l'errore
      // passava inosservato e il riassunto falliva senza un motivo chiaro.
      if (data && typeof data.error === "string" && data.error) {
        throw new Error("Ollama: " + data.error);
      }
      var c =
        data && data.message && typeof data.message.content === "string"
          ? data.message.content.trim()
          : "";
      if (!c) {
        // 200 OK ma NESSUN testo: leggiamo i METADATI allegati da Ollama per
        // dire COSA è andato storto (modello vivo ma muto, caricamento lungo
        // da disco esterno, ...) invece di un generico «priva di contenuto».
        var emptyErr = new Error(ollamaEmptyDiagnosis(data));
        emptyErr.isEmptyResponse = true;
        throw emptyErr;
      }
      return c;
    }
    if (kind === "anthropic") {
      var ca = Array.isArray(data.content) ? data.content.map(function (b) { return b.text || ""; }).join("") : "";
      if (!ca) throw new Error("Risposta Anthropic priva di contenuto.");
      return ca;
    }
    // Modelli "thinking" (Qwen3 & simili): il ragionamento viaggia in
    // reasoning_content e la risposta finale in content. Se il tetto di token
    // finisce mentre il modello PENSA, content resta vuoto con finish_reason
    // "length": lo si dichiara con la cura giusta invece del generico
    // «priva di contenuto» (era il destino tipico di qwen3 thinking via LM
    // Studio, che brucia centinaia di token prima di scrivere il JSON).
    var pick = data.choices && data.choices[0] ? data.choices[0] : null;
    var cc = pick && pick.message && typeof pick.message.content === "string" ? pick.message.content.trim() : "";
    if (!cc) {
      var reasoning =
        pick && pick.message && typeof (pick.message.reasoning_content || pick.message.reasoning) === "string"
          ? String(pick.message.reasoning_content || pick.message.reasoning).trim()
          : "";
      if (reasoning && pick && pick.finish_reason === "length") {
        throw new Error(
          "Il modello ha consumato tutti i token disponibili nel RAGIONAMENTO (thinking) senza scrivere la risposta finale: \u00e8 tipico dei modelli Qwen3 con thinking attivo. MindFlow riprova con pi\u00f9 token; se il problema resta, disattiva la modalit\u00e0 thinking del modello in LM Studio (o usa una variante senza thinking)."
        );
      }
      if (reasoning) return reasoning; // la risposta (forse col JSON dentro) \u00e8 finita tutta nel ragionamento
      if (pick && pick.finish_reason === "length") {
        throw new Error("Risposta del motore troncata dal limite di token prima di scrivere alcun testo: riprova o alza i token.");
      }
      throw new Error("Risposta del motore priva di contenuto.");
    }
    return cc;
  }

  // ---------------------------------------------------------------------------
  // Test di connessione (endpoint + lista modelli)
  // ---------------------------------------------------------------------------

  async function testEngine(engine) {
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
    var res;
    try {
      res = await fetchTimeout(url, { method: "GET", headers: headers }, 20000);
    } catch (err) {
      return { ok: false, error: netHint(err), isNetwork: true };
    }
    if (!res.ok) {
      if (res.status === 403 && kind === "ollama") {
        return { ok: false, originBlocked: true, error: ORIGIN_BLOCKED_HINT };
      }
      return { ok: false, error: "Il motore ha risposto con errore " + res.status + " (" + url + ")." };
    }
    var models = [];
    try {
      var data = await res.json();
      if (kind === "ollama" && Array.isArray(data.models)) {
        models = data.models.map(function (m) { return m.name || m.model; }).filter(Boolean);
      } else if (Array.isArray(data.data)) {
        models = data.data.map(function (m) { return m.id; }).filter(Boolean);
      } else if (Array.isArray(data.models)) {
        models = data.models.map(function (m) { return m.id || m.name; }).filter(Boolean);
      }
    } catch (_e) {
      /* lista modelli non disponibile: la connessione comunque funziona */
    }
    // Ollama: il solo GET /api/tags NON rivela il blocco estensioni (passa
    // anche con Ollama chiuso alle estensioni). La sonda POST dice la
    // verita' PRIMA che l'utente tenti un riassunto e riceva un 403 secco.
    if (kind === "ollama") {
      var probe = await originProbe(engine);
      if (probe.blocked) {
        return { ok: false, originBlocked: true, models: models.slice(0, 40), error: ORIGIN_BLOCKED_HINT };
      }
    }
    // OpenAI-compat locale (LM Studio, llama.cpp, vLLM…): il GET /models passa
    // anche col CORS spento — la sonda POST dice la verità PRIMA che l'utente
    // tenti un riassunto e riceva un 403 secco (stessa idea della sonda Ollama).
    if (kind === "openai-compat") {
      var cprobe = await compatOriginProbe(engine);
      if (cprobe.blocked) {
        return { ok: false, compatBlocked: true, models: models.slice(0, 40), error: COMPAT_BLOCKED_HINT };
      }
    }
    return { ok: true, models: models.slice(0, 40) };
  }

  // ---------------------------------------------------------------------------
  // v1.2.2 — AUTO-CORREZIONE della PORTA (endpoint giusto, porta sbagliata)
  // ---------------------------------------------------------------------------

  /** Porte note per tipo di motore locale. LM Studio parte sulla 1234 ma,
   *  se la trova occupata, sceglie DA SOLO la successiva (1235, 1236…): è
   *  il caso reale dell'utente («riconosceva endpoint sembrava ma non
   *  motore» con il server in realtà su 1235, mentre il campo diceva 1234).
   *  Ollama segue lo stesso schema (11434 → 11435…). */
  var LOCAL_KNOWN_PORTS = {
    ollama: [11434, 11435, 11436, 11437],
    "openai-compat": [1234, 1235, 1236, 1237, 8080, 8000, 1337, 5001, 4891, 5000, 8081],
  };

  /** Elenco degli endpoint alternativi da sondare per l'AUTO-CORREZIONE:
   *  porte note del tipo di motore + la porta scritta dall'utente e le sue
   *  adiacenti (±2, il classico errore di battitura), sull'host
   *  dell'endpoint. Se l'host è 127.0.0.1 o localhost si provano ENTRAMBI
   *  (macOS/IPv6 a volte risponde solo su uno dei due). */
  function candidateAltBases(kind, rawBase) {
    var out = [];
    if (kind !== "ollama" && kind !== "openai-compat") return out;
    var base = normalizeBase(kind, rawBase);
    var host = "127.0.0.1";
    var port = kind === "ollama" ? 11434 : 1234;
    if (base) {
      try {
        var u = new URL(base);
        if (u.hostname) host = u.hostname;
        if (u.port && /^\d+$/.test(u.port)) port = Number(u.port);
      } catch (_e) {
        /* base non parseabile: si restano sui predefiniti */
      }
    }
    var ports = (LOCAL_KNOWN_PORTS[kind] || []).slice(0);
    for (var d = -2; d <= 2; d++) ports.push(port + d);
    var seen = {};
    ports = ports
      .filter(function (p) {
        if (p <= 0 || seen[p]) return false;
        seen[p] = true;
        return true;
      })
      .sort(function (a, b) {
        return a - b;
      });
    var hosts =
      host === "localhost" ? ["localhost", "127.0.0.1"]
        : host === "127.0.0.1" ? ["127.0.0.1", "localhost"]
          : [host];
    ports.forEach(function (p) {
      hosts.forEach(function (h) {
        out.push({
          baseUrl: normalizeBase(kind, "http://" + h + ":" + p),
          probeUrl: "http://" + h + ":" + p + (kind === "ollama" ? "/api/tags" : "/v1/models"),
        });
      });
    });
    return out;
  }

  /** Sonda in parallelo gli endpoint alternativi dello STESSO tipo di motore
   *  e torna quelli che rispondono con una lista modelli valida:
   *  [{baseUrl, models}]. Vuoto = nessun altro server attivo. È il cuore
   *  dell'AUTO-CORREZIONE: l'endpoint salvato non risponde ma un server
   *  identico vive su una porta vicina → il campo si corregge da solo. */
  async function scanAlternateEngines(engine) {
    var kind = engine && engine.kind;
    if (kind !== "ollama" && kind !== "openai-compat") return [];
    var key = (engine.apiKey || "").trim();
    var headers = {};
    if (key && kind !== "ollama") headers.Authorization = "Bearer " + key;
    var candidates = candidateAltBases(kind, engine.baseUrl);
    var results = await Promise.all(
      candidates.map(function (c) {
        return fetchTimeout(c.probeUrl, { method: "GET", headers: headers }, 4000)
          .then(function (res) {
            return res.ok
              ? res.json().catch(function () {
                  return null;
                })
              : null;
          })
          .then(function (data) {
            if (!data) return null;
            var models = [];
            if (kind === "ollama" && Array.isArray(data.models)) {
              models = data.models.map(function (m) {
                return m.name || m.model;
              }).filter(Boolean);
            } else if (Array.isArray(data.data)) {
              models = data.data.map(function (m) {
                return m.id;
              }).filter(Boolean);
            } else if (Array.isArray(data.models)) {
              models = data.models.map(function (m) {
                return m.id || m.name;
              }).filter(Boolean);
            } else if (Array.isArray(data.model_list)) {
              models = data.model_list.map(function (m) {
                return m.id || m.name || (m.meta && m.meta.alias);
              }).filter(Boolean);
            }
            if (kind === "ollama" && !Array.isArray(data.models)) return null;
            if (!models.length) return null;
            return { baseUrl: c.baseUrl, models: models.slice(0, 40) };
          })
          .catch(function () {
            return null;
          });
      })
    );
    var seen = {};
    return results.filter(function (r) {
      if (!r) return false;
      var k = r.baseUrl.replace("localhost", "127.0.0.1");
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Riassunto checkpoint (stesso contratto del service worker)
  // ---------------------------------------------------------------------------

  var SUMMARIZER_PROMPT =
    'Sei il motore di memoria di MindFlow Companion. Analizza un segmento di contenuto: può venire da una chat con un assistente AI (ChatGPT, Claude, Gemini) oppure da una pagina web (voce wiki, articolo, documentazione).\n' +
    'Rispondi con SOLO un oggetto JSON valido, senza markdown, in questo formato:\n' +
    '{"title": "...", "summary": "...", "keyDecisions": ["...", "..."]}\n\n' +
    "Regole:\n" +
    '- "title": massimo 6 parole, il sotto-argomento del segmento (stessa lingua del contenuto).\n' +
    '- "summary": massimo 50 parole, un checkpoint COMPATTO e denso. Ciò che conta sono le informazioni CONSEGNATE: spiegazioni, fatti, definizioni, nomi e numeri dell\u2019assistente o del documento. Le domande dell\u2019utente sono solo contesto: NON riassumere le domande.\n' +
    '- "keyDecisions": 0-3 conclusioni o punti chiave espliciti del segmento. Array vuoto se non ci sono.\n' +
    "- Non inventare nulla che non sia nel segmento.";

  /** Errori «modello non trovato» di QUALSIASI motore: Ollama («model … not
   *  found, try pulling»), LM Studio/llama.cpp («model xyz not found»), vLLM
   *  («The model `xyz` does not exist»). Sono l'indizio per l'auto-riparazione
   *  del nome (es. «qwen3.5 9b abliterated» → la chiave vera di LM Studio). */
  var MODEL_NOT_FOUND_RE =
    /not found|try pulling|no such model|unknown model|does not exist|failed to find|modello (non trovato|inesistente|sconosciuto)/i;

  /** Finestra di contesto ADATTIVA (v1.1.2): prima era fissa (8192 compressione /
   *  12288 mappa) e allocava memoria per il caso MASSIMO anche con input
   *  piccoli — con un modello locale 7B questo può spingere il contesto oltre
   *  la memoria e rallentare tutto (o mandare in swap) proprio sulle code corte
   *  di «Aggiorna grafo». Stima prudente dei token (1 token ≈ 2,5 caratteri:
   *  sovrastima le lingue latine, così il prompt non viene MAI troncato) +
   *  spazio per system e output, arrotondata a blocchi di 512. Mai sotto 2048,
   *  mai sopra il tetto storico della chiamata. */
  function ctxForChars(chars, outTokens, cap) {
    var need = Math.ceil((chars || 0) / 2.5) + (outTokens || 0) + 700;
    return Math.max(2048, Math.min(cap || 8192, Math.ceil(need / 512) * 512));
  }

  function parseLenientJson(text) {
    var cleaned = (text || "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch (_e) {
      var start = cleaned.indexOf("{");
      var end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(cleaned.slice(start, end + 1));
        } catch (_e2) {
          return null;
        }
      }
      return null;
    }
  }

  /** Chiave normale di un nome modello, per confrontarlo SENZA falsi
   *  negativi: LM Studio usa chiavi lunghe e con maiuscole
   *  («lmstudio-community/Qwen3.5-9B-abliterated-GGUF») mentre l'utente
   *  scrive «qwen3.5 9b abliterated». Si tiene l'ultimo tratto dopo «/», si
   *  tolgono i tag Ollama («:latest») e i suffissi tecnici (-gguf, -fim) e si
   *  unificano separatori e spazi (-_. e « » spariscono). */
  function normalizeModelKey(name) {
    var s = String(name || "").trim().toLowerCase();
    if (!s) return "";
    var slash = s.lastIndexOf("/");
    if (slash >= 0) s = s.slice(slash + 1);
    s = s.split(":")[0];
    s = s.replace(/-(gguf|fim)$/i, "");
    return s.replace(/[-_.\s]+/g, "");
  }

  /** Cerca tra i modelli presenti quello che l'utente ha voluto dire:
   *  identico → stessa chiave normale → contenimento (la chiave corta dentro
   *  la lunga o viceversa, minimo 4 caratteri). Vuoto se nulla di somigliante. */
  function fuzzyFindModel(models, wanted) {
    if (!models || !models.length || !wanted) return "";
    var target = String(wanted).trim();
    if (!target) return "";
    for (var i = 0; i < models.length; i++) {
      if (String(models[i]) === target) return models[i];
    }
    var key = normalizeModelKey(target);
    if (!key) return "";
    for (var j = 0; j < models.length; j++) {
      if (normalizeModelKey(models[j]) === key) return models[j];
    }
    var best = "";
    var bestLen = Infinity;
    for (var k = 0; k < models.length; k++) {
      var mk = normalizeModelKey(models[k]);
      if (!mk || mk.length < 4) continue;
      if (mk.indexOf(key) !== -1 || key.indexOf(mk) !== -1) {
        if (mk.length < bestLen) {
          best = models[k];
          bestLen = mk.length;
        }
      }
    }
    return best;
  }

  /** Suggerisce, tra i modelli realmente presenti nel motore, quello più
   *  vicino a quello richiesto (match fuzzy del nome — copre le chiavi lunghe
   *  di LM Studio e i tag Ollama —, poi il small/generalista preferito). */
  function suggestModel(models, wanted) {
    if (!models || !models.length) return "";
    var fuzzy = fuzzyFindModel(models, wanted || "");
    if (fuzzy) return fuzzy;
    var preferred = models.find(function (m) {
      return /gemma|llama|mistral|phi|qwen|granite|smol/i.test(String(m));
    });
    return preferred || models[0] || "";
  }

  /** Elenco modelli per l'auto-riparazione del nome, per QUALSIASI motore con
   *  lista leggibile: Ollama → GET /api/tags; OpenAI-compat (LM Studio,
   *  llama.cpp, vLLM) e OpenAI → GET /models. null se il motore non risponde. */
  async function listModels(engine) {
    try {
      if (!engine || engine.kind === "anthropic") return null;
      var base = normalizeBase(engine.kind, engine.baseUrl);
      var url = engine.kind === "ollama" ? base + "/api/tags" : base + "/models";
      var headers = {};
      var key = (engine.apiKey || "").trim();
      if (key && engine.kind !== "ollama") headers.Authorization = "Bearer " + key;
      var res = await fetchTimeout(url, { method: "GET", headers: headers }, 8000);
      if (!res.ok) return null;
      var data = await res.json();
      var models = [];
      if (Array.isArray(data.models)) {
        models = data.models.map(function (m) { return m.name || m.model || m.id; }).filter(Boolean);
      } else if (Array.isArray(data.data)) {
        models = data.data.map(function (m) { return m.id; }).filter(Boolean);
      }
      return models.length ? models : null;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Comprime un segmento in una memory node. Due tentativi (il secondo con
   * l'istruzione dura "solo JSON" per i modelli piccoli che commentano
   * l'output) e auto-riparazione del nome modello su Ollama (es. "gemma3"
   * invece di "gemma3:latest"). NIENTE fallback locale: il risultato esce
   * dal motore o l'errore è quello vero.
   */
  /** Trascritto del segmento per la COMPRESIONE. v1.1.0: le RISPOSTE
   *  dell'assistente sono il contenuto che conta (il menu è «quasi al
   *  contrario» della domanda) → cap 1500 caratteri a risposta contro 450 a
   *  domanda. Il totale resta su ~12000 caratteri: con la finestra di
   *  contesto esplicita (8192) ogni chiamata è veloce e il modello NON
   *  tronca in silenzio il prompt (era il motivo della fatica su ChatGPT). */
  function segmentTranscript(segment) {
    var lines = [];
    var total = 0;
    for (var i = 0; i < segment.length; i++) {
      var m = segment[i];
      var cap = m.role === "assistant" ? 1500 : 450;
      var t = String(m.text || "").replace(/\s+/g, " ").trim();
      if (t.length > cap) t = t.slice(0, cap) + "…";
      if (total + t.length > 12000) {
        var rest = 12000 - total;
        if (rest < 80) break;
        t = t.slice(0, rest) + "…";
      }
      total += t.length;
      lines.push("[" + (m.role === "user" ? "UTENTE" : "ASSISTENTE") + "]: " + t);
      if (total >= 12000) break;
    }
    return lines.join("\n\n");
  }

  async function summarize(engine, segment, prevTitle) {
    var transcript = segmentTranscript(segment);
    var baseUser =
      (prevTitle ? 'Checkpoint precedente: "' + prevTitle + '".\n\n' : "") +
      "Segmento da comprimere:\n\n" +
      transcript;
    var call = function (eng, extra, freeMode, tokens) {
      return chat(eng, {
        system: SUMMARIZER_PROMPT + (extra || ""),
        user: baseUser,
        // Checkpoint compatto: titolo + 50 parole + 3 punti chiave ci stanno
        // larghi. Meno token generati = risposta più rapida del modello locale.
        // tokens: dal 2° tentativo sui motori OpenAI-compatibili si sale a 900
        // per i modelli «thinking» che sprecano il budget nel ragionamento.
        maxTokens: tokens || 420,
        temperature: 0.2,
        // Finestra ADATTIVA alla lunghezza reale del segmento (v1.1.2): la
        // coda corta di un aggiornamento non paga più il contesto massimo.
        numCtx: ctxForChars(baseUser.length + SUMMARIZER_PROMPT.length, 420, 8192),
        // Il caricamento a freddo di un modello locale può superare il minuto:
        // 180 s evita che un riassunto VALIDO muoia per timeout.
        timeoutMs: 180000,
        // 2° tentativo (dopo risposta VUOTA): senza modalità JSON forzata —
        // se la grammar JSON di Ollama produce vuoto, la modalità libera può
        // dare comunque un JSON che il parser tollerante sa leggere.
        jsonMode: !freeMode,
      });
    };

    var used = engine;
    var recoveredModel = "";
    var parsed = null;
    var lastRaw = "";
    var lastError = "";
    var networkErr = null;
    var originErr = null;
    for (var attempt = 0; attempt < 2 && !parsed; attempt++) {
      if (attempt > 0 && lastError) {
        await new Promise(function (r) {
          setTimeout(r, 1200);
        });
      }
      var raw;
      try {
        raw = await call(
          used,
          attempt >= 1
            ? "\n\nIMPORTANTE: l'output deve essere il SOLO oggetto JSON richiesto, senza testo prima, dopo o attorno, senza blockquote e senza fence markdown."
            : "",
          attempt >= 1,
          attempt >= 1 && (used.kind === "openai-compat" || used.kind === "openai") ? 900 : 420
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (err && err.isNetwork) networkErr = err;
        // 403 di Ollama: blocco DETERMINISTICO dell'origine. Riprovare non
        // cambia nulla e l'auto-riparazione del modello non c'entra: si esce
        // subito con l'errore giusto (e il flag per chi lo mostra).
        if (err && err.isOriginBlocked) {
          originErr = err;
          break;
        }
        // AUTO-RIPARAZIONE del modello (Ollama E OpenAI-compat locali): se il
        // nome impostato non esiste nel motore (es. "gemma" invece di
        // "gemma3:latest", o "qwen3.5 9b abliterated" invece della chiave
        // lunga "lmstudio-community/Qwen3.5-9B-abliterated-GGUF" di LM
        // Studio), lo si sostituisce con il modello installato più adatto e si
        // riparte. Senza questo, il cambio provider a LM Studio sembrava
        // «endpoint OK ma modello morto» per un semplice NOME diverso.
        if ((used.kind === "ollama" || used.kind === "openai-compat") && MODEL_NOT_FOUND_RE.test(lastError)) {
          var models = await listModels(used);
          var rec = models ? suggestModel(models, used.model || "") : "";
          if (rec && rec !== used.model) {
            recoveredModel = rec;
            used = Object.assign({}, used, { model: rec });
            attempt = -1; // il giro col modello giusto riparte dal primo tentativo
            continue;
          }
        }
        continue; // errore di motore: riprova (fino a esaurire i tentativi)
      }
      lastRaw = raw;
      parsed = parseLenientJson(raw);
      if (parsed && (typeof parsed !== "object" || !parsed.title)) parsed = null;
    }
    if (!parsed) {
      // Blocco estensioni di Ollama (403): la cura e' OLLAMA_ORIGINS, non un
      // nuovo tentativo. L'errore conserva il flag per il chiamante.
      if (originErr) throw originErr;
      // Mai arrivati a un output del modello per colpa della RETE: rilancia
      // l'errore marcato, così il chiamante può provare l'altra via (il
      // lavoro nel service worker) senza nascondere la verità.
      if (networkErr && !lastRaw) throw networkErr;
      var head = (lastRaw || "").replace(/\s+/g, " ").slice(0, 160);
      var reason = lastError
        ? lastError.replace(/[.\s]+$/, "")
        : lastRaw
          ? 'risposta non interpretabile come JSON ("' + head + '…")'
          : "nessuna risposta dal motore";
      // PING di controllo (solo Ollama, solo se non è MAI arrivato testo):
      // distingue «il modello è muto per TUTTI» (file corrotti, disco esterno
      // spento/in riposo) da un glitch transitorio del singolo prompt. Costa
      // una chiamata piccola SOLO dopo il fallimento dei due tentativi.
      var probeSuffix = "";
      if (used.kind === "ollama" && !lastRaw && /priva di contenuto/.test(lastError)) {
        var verdict = await ollamaPing(used);
        if (verdict === "ok") {
          probeSuffix = " Ping di controllo riuscito: il modello GENERA normalmente — il vuoto era transitorio: riprova ORA il riassunto (il modello è caldo in RAM).";
        } else if (verdict === "empty") {
          probeSuffix = " Ping di controllo VUOTO: il modello non scrive per NESSUN prompt — file modello corrotti/incompleti o disco esterno spento/in riposo (nel terminale: ollama run <modello> \"ciao\" e ollama ps).";
        } else if (verdict === "timeout") {
          probeSuffix = " Ping di controllo senza risposta in tempo: il modello impiega troppo a caricarsi (disco esterno lento o memoria piena) — riprova tra poco o usa un modello più piccolo.";
        } else {
          probeSuffix = " Ping di controllo fallito: " + verdict;
        }
      }
      throw new Error(
        "Checkpoint non creato: " + reason + ". Controlla lo stato del motore in alto e riprova." + probeSuffix
      );
    }
    return {
      title: String(parsed.title).slice(0, 80),
      summary: String(parsed.summary || "").slice(0, 1200),
      keyDecisions: Array.isArray(parsed.keyDecisions)
        ? parsed.keyDecisions.filter(function (d) { return typeof d === "string" && d.trim(); }).slice(0, 6)
        : [],
      ...(recoveredModel ? { recoveredModel: recoveredModel } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Mappa dei capitoli (v1.0.0 — il cuore della pipeline unica)
  //
  // PRIMA: i checkpoint nascevano da un taglio meccanico a caratteri
  // (1400/3600), ogni pezzo riassunto da solo: titoli scollegati, ripetizioni,
  // grafi illeggibili. ORA: il motore legge TUTTA la conversazione (in forma
  // ridotta, per stare nei limiti di contesto di QUALSIASI modello) e decide
  // lui i capitoli semantici. La compressione per capitolo resta al prompt
  // dello summarizer. Funziona con ogni motore: Ollama riceve format:"json"
  // + num_ctx esplicito, gli altri motori ricevono solo il prompt severo e
  // il parser tollerante.
  // ---------------------------------------------------------------------------

  var PLANNER_PROMPT =
    "Sei il pianificatore dei capitoli di MindFlow. Ricevi dei contenuti NUMERATI (1., 2., 3., ...): i turni di una conversazione (ChatGPT, Claude, Gemini) oppure le sezioni di un documento o di una pagina web.\n" +
    "Compito: raggruppa i contenuti in CAPITOLI tematici consecutivi — nessun salto, nessuna sovrapposizione, copertura completa da 1 a N.\n" +
    "Rispondi con SOLO un oggetto JSON valido, senza testo prima o dopo, in questo formato:\n" +
    '{"chapters":[{"title":"...","from":1,"to":3}]}\n\n' +
    "Regole:\n" +
    '- "title": massimo 6 parole, il tema del capitolo, nella STESSA lingua dei contenuti.\n' +
    '- "from" e "to": NUMERI dei contenuti (tra 1 e N), con from <= to. Il primo capitolo inizia a 1, ogni capitolo inizia subito dopo la fine del precedente, l\'ultimo finisce a N.\n' +
    '- Numero di capitoli: da 1 a 8, in base ai temi DAVVERO presenti. Contenuto breve o unico: anche 1 solo capitolo.\n' +
    '- I temi vivono nelle RISPOSTE dell\'assistente e nelle sezioni del documento: le brevi domande dell\'utente sono solo il filo che le collega. Raggruppa intorno a ciò che viene spiegato.\n' +
    "- Non inventare nulla: i capitoli vivono solo sui contenuti forniti.";

  var PLANNER_HARD_REMINDER =
    "\n\nIMPORTANTE: l'output deve essere il SOLO oggetto JSON richiesto " +
    '(es. {"chapters":[{"title":"Impostazione del progetto","from":1,"to":4}]}), ' +
    "senza testo attorno, senza fence markdown, con from/to NUMERICI e consecutivi.";

  /** Trascritto RIDOTTO per la mappa: numerato da 1 a N. v1.1.0 — pesi
   *  INVERTITI rispetto a prima: le risposte dell'assistente (il contenuto
   *  che conta, sezioni di pagina comprese) ricevono fino a 1600 caratteri,
   *  le domande dell'utente fino a 450. Due passate: se il totale sfora il
   *  budget si stringono i cap. Estremo caso (oltre 26000 caratteri anche alla
   *  seconda passata) si conservano primo e ultimo blocco e si nota nel prompt
   *  che i numeri restano quelli della conversazione INTERA. */
  function reducedTranscript(msgs) {
    var n = msgs.length;
    function build(userCap, asstCap) {
      var lines = [];
      for (var i = 0; i < n; i++) {
        var m = msgs[i];
        var cap = m.role === "user" ? userCap : asstCap;
        var t = String(m.text || "").replace(/\s+/g, " ").trim();
        if (t.length > cap) t = t.slice(0, cap) + "…";
        lines.push((i + 1) + ". [" + (m.role === "user" ? "UTENTE" : "ASSISTENTE") + "] " + t);
      }
      return lines.join("\n");
    }
    var pass1 = build(Math.max(90, Math.min(450, Math.floor(7000 / n))), Math.max(140, Math.min(1600, Math.floor(15000 / n))));
    if (pass1.length <= 26000) return pass1;
    var pass2 = build(110, 240);
    if (pass2.length <= 26000) return pass2;
    // Oltre ogni limite (centinaia di messaggi): taglio CENTRALE, non di coda,
    // così la mappa vede l'inizio e la fine vera della storia. I numeri restano
    // quelli reali: normalizeChapters assegna i messaggi mancanti ai capitoli
    // vicini (la copertura resta continua da 1 a N).
    var half = Math.floor(n / 2);
    var keepHead = Math.min(half, 140);
    var keepTail = Math.min(n - keepHead, 140);
    var head = msgs.slice(0, keepHead);
    var tail = msgs.slice(n - keepTail);
    var lines = [];
    head.forEach(function (m, i) {
      var capHead = m.role === "user" ? 120 : 240;
      var t = String(m.text || "").replace(/\s+/g, " ").trim();
      if (t.length > capHead) t = t.slice(0, capHead) + "…";
      lines.push((i + 1) + ". [" + (m.role === "user" ? "UTENTE" : "ASSISTENTE") + "] " + t);
    });
    lines.push("[… messaggi " + (keepHead + 1) + "–" + (n - keepTail) + " omessi qui: i numeri restano quelli della conversazione intera …]");
    for (var j = n - keepTail; j < n; j++) {
      var m2 = msgs[j];
      var capTail = m2.role === "user" ? 120 : 240;
      var t2 = String(m2.text || "").replace(/\s+/g, " ").trim();
      if (t2.length > capTail) t2 = t2.slice(0, capTail) + "…";
      lines.push((j + 1) + ". [" + (m2.role === "user" ? "UTENTE" : "ASSISTENTE") + "] " + t2);
    }
    return lines.join("\n");
  }

  /** Ripulisce la mappa grezza del modello in capitoli SICURI:
   *  clamp entro [1, N], scambio from/to invertiti, ordinamento, fusioni di
   *  sovrapposizioni, chiusura dei buchi (copertura continua 1..N), massimo
   *  10 capitoli (fusione della coppia adiacente più piccola). Restituisce
   *  null se non c'è nulla di utilizzabile: il chiamante riprova o dichiara
   *  la riserva — MAI capitoli inventati. */
  function normalizeChapters(raw, total) {
    if (!raw || typeof raw !== "object" || !total || total < 1) return null;
    var arr = Array.isArray(raw.chapters) ? raw.chapters : Array.isArray(raw) ? raw : null;
    if (!arr) return null;
    var items = [];
    arr.forEach(function (c) {
      if (!c || typeof c !== "object") return;
      var from = Math.round(Number(c.from));
      var to = Math.round(Number(c.to));
      if (!isFinite(from) || !isFinite(to)) return;
      if (from > to) { var t = from; from = to; to = t; }
      from = Math.max(1, Math.min(total, from));
      to = Math.max(1, Math.min(total, to));
      var title = String(c.title || "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!title) title = "Capitolo " + (items.length + 1);
      items.push({ title: title, from: from, to: to });
    });
    if (!items.length) return null;
    items.sort(function (a, b) { return a.from - b.from || a.to - b.to; });
    var out = [];
    items.forEach(function (c) {
      var last = out.length ? out[out.length - 1] : null;
      if (last && c.from <= last.to) {
        // sovrapposto o contenuto: estendi il precedente se aggiunge copertura
        if (c.to > last.to) last.to = c.to;
        return;
      }
      out.push({ title: c.title, from: c.from, to: c.to });
    });
    if (!out.length) return null;
    if (out[0].from > 1) out[0].from = 1;
    for (var i = 1; i < out.length; i++) {
      // buco tra i capitoli: il successivo lo copre (partita anticipata)
      if (out[i].from > out[i - 1].to + 1) out[i].from = out[i - 1].to + 1;
    }
    if (out[out.length - 1].to < total) out[out.length - 1].to = total;
    while (out.length > 10) {
      var best = 0;
      var bestSize = Infinity;
      for (var j = 0; j < out.length - 1; j++) {
        var sz = (out[j].to - out[j].from + 1) + (out[j + 1].to - out[j + 1].from + 1);
        if (sz < bestSize) { bestSize = sz; best = j; }
      }
      out[best].to = out[best + 1].to;
      out.splice(best + 1, 1);
    }
    return out;
  }

  /** Riserva DICHIARATA (mai silenziosa): il modello non è riuscito a mappare
   *  i capitoli — si segmenta per scambi (un capitolo ogni 1–2 risposte,
   *  chiuso sempre su un messaggio dell'assistente). Il contenuto dei
   *  checkpoint resta COMUNQUE generato dal motore: cambia solo il confine. */
  function exchangeChapters(msgs) {
    var out = [];
    var from = 1;
    var assistants = 0;
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i] && msgs[i].role === "assistant") assistants++;
      var isLast = i === msgs.length - 1;
      if (assistants >= 2 || isLast) {
        out.push({ title: "", from: from, to: i + 1 });
        from = i + 2;
        assistants = 0;
      }
    }
    out.forEach(function (c, idx) {
      c.title = "Parte " + (idx + 1);
    });
    return out.length ? out : [{ title: "Conversazione", from: 1, to: msgs.length }];
  }

  /**
   * Mappa semantica dei capitoli. 3 tentativi (dal secondo con l'esempio
   * incorporato per i modelli piccoli), auto-riparazione del nome modello su
   * Ollama come nello summarize, num_ctx esplicito (16384) perché il
   * trascritto ridotto è più grande di un segmento normale. Fallisce DURE:
   * l'errore è vero e dichiarato, il chiamante decide la riserva.
   */
  async function planChapters(engine, msgs) {
    if (!Array.isArray(msgs) || !msgs.length) {
      throw new Error("Nessun messaggio da mappare.");
    }
    var n = msgs.length;
    var user =
      "Contenuti da " + n + " messaggi/sezioni (numerati). Dividi in capitoli tematici consecutivi.\n\n" +
      reducedTranscript(msgs);
    var used = engine;
    var lastError = "";
    var lastRaw = "";
    var originErr = null;
    var networkErr = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0 && lastError) {
        await new Promise(function (r) { setTimeout(r, 1200); });
      }
      var raw;
      try {
        raw = await chat(used, {
          system: PLANNER_PROMPT + (attempt >= 1 ? PLANNER_HARD_REMINDER : ""),
          user: user,
          maxTokens: attempt >= 1 && (used.kind === "openai-compat" || used.kind === "openai") ? 1300 : 600,
          temperature: 0.2,
          // Finestra ADATTIVA (v1.1.2): cresce solo se la conversazione è
          // davvero lunga; resta sotto il tetto storico 12288.
          numCtx: ctxForChars(user.length + PLANNER_PROMPT.length, 600, 12288),
          timeoutMs: 240000,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (err && err.isOriginBlocked) { originErr = err; break; }
        if (err && err.isNetwork && !lastRaw) networkErr = err;
        // Auto-riparazione del nome modello (Ollama E OpenAI-compat), come
        // nello summarize: match fuzzy sulla lista vera del motore.
        if ((used.kind === "ollama" || used.kind === "openai-compat") && MODEL_NOT_FOUND_RE.test(lastError)) {
          var models = await listModels(used);
          var rec = models ? suggestModel(models, used.model || "") : "";
          if (rec && rec !== used.model) {
            used = Object.assign({}, used, { model: rec });
            attempt = -1; // il giro col modello giusto riparte dai 3 tentativi
            continue;
          }
        }
        continue;
      }
      lastRaw = raw;
      var parsed = parseLenientJson(raw);
      var chapters = normalizeChapters(parsed, n);
      if (chapters) return chapters;
      lastError = lastError || "mappa non interpretabile";
    }
    if (originErr) throw originErr;
    if (networkErr) throw networkErr;
    var head = (lastRaw || "").replace(/\s+/g, " ").slice(0, 160);
    throw new Error(
      (lastError ? lastError.replace(/[.\s]+$/, "") : 'risposta non interpretabile come mappa ("' + head + '…")')
    );
  }

  globalThis.MindFlowEngineClient = {
    normalizeBase: normalizeBase,
    netHint: netHint,
    fetchTimeout: fetchTimeout,
    chat: chat,
    testEngine: testEngine,
    scanAlternateEngines: scanAlternateEngines,
    candidateAltBases: candidateAltBases,
    originProbe: originProbe,
    compatOriginProbe: compatOriginProbe,
    summarize: summarize,
    planChapters: planChapters,
    normalizeChapters: normalizeChapters,
    exchangeChapters: exchangeChapters,
    reducedTranscript: reducedTranscript,
    ctxForChars: ctxForChars,
    suggestModel: suggestModel,
    normalizeModelKey: normalizeModelKey,
    fuzzyFindModel: fuzzyFindModel,
    parseLenientJson: parseLenientJson,
    SUMMARIZER_PROMPT: SUMMARIZER_PROMPT,
    PLANNER_PROMPT: PLANNER_PROMPT,
    ORIGIN_BLOCKED_HINT: ORIGIN_BLOCKED_HINT,
    COMPAT_BLOCKED_HINT: COMPAT_BLOCKED_HINT,
  };
})();
