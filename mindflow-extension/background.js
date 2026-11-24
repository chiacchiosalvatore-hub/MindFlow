/**
 * MindFlow Companion — Service worker (background).
 *
 * Unico punto di rete dell'estensione: parla con il motore scelto
 * (Ollama nativo, server OpenAI-compatibile locale, OpenAI, Anthropic).
 * Il service worker gira sul computer dell'utente, quindi gli endpoint
 * localhost sono raggiungibili direttamente: è esattamente il motivo per
 * cui l'integrazione dei modelli locali funziona qui e non nell'app cloud.
 *
 * Messaggi gestiti (da panel/options):
 *   mindflow:ping         -> { ok, version }
 *   mindflow:engine-test  -> { ok, models?, error? }
 *   mindflow:autodetect   -> { ok, found?: [{kind, baseUrl, label, models}], best?, error? }
 *   mindflow:summarize    -> { ok, jobId }  (ACK immediato: il lavoro gira in
 *                            background, lo stato si legge con job-status)
 *   mindflow:job-status   -> { ok, jobId, done, status?, result?, error? }
 *   mindflow:open-url     -> { ok } (apre un chatbot in una nuova scheda)
 *
 * RUOLO NELLA v0.9.2: pannello e impostazioni parlano col motore in fetch
 * DIRETTO (engine-client.js), quindi il riassunto NON dipende più da questo
 * worker. Restano qui il test/rilevamento del motore su richiesta e il
 * percorso di RISERVA per il riassunto (usato solo se il fetch diretto del
 * pannello fosse bloccato). I lavori di riserva sopravvivono al riavvio del
 * worker: parametri in storage.session e AUTO-RIPRESA allo svegliarsi, così
 * un worker spento a metà non lascia più i checkpoint in pausa.
 */

"use strict";

// Versione UNICA dal manifest: niente più disallineamento tra manifest e
// risposta del ping (il test job-flow confronta proprio questa).
const VERSION =
  (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version
    : "1.0.0";

// ---------------------------------------------------------------------------
// Motori
// ---------------------------------------------------------------------------

const ENGINE_META = {
  ollama: { label: "Ollama (nativo)", needsKey: false, defaultBase: "http://127.0.0.1:11434" },
  "openai-compat": { label: "OpenAI-compatibile locale", needsKey: false, defaultBase: "http://127.0.0.1:1234/v1" },
  openai: { label: "OpenAI", needsKey: true, defaultBase: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic", needsKey: true, defaultBase: "https://api.anthropic.com/v1" },
};

function normalizeBase(kind, raw) {
  let base = (raw || "").trim().replace(/\/+$/, "");
  if (!base) base = ENGINE_META[kind] ? ENGINE_META[kind].defaultBase : "";
  if (!base) return "";
  if (kind === "ollama") {
    // L'utente può aver incollato .../v1 (abitudine dall'app): l'API nativa
    // di Ollama vive alla radice, quindi lo rimuoviamo.
    base = base.replace(/\/v1$/i, "");
  } else if (kind === "openai-compat") {
    // LM Studio / llama.cpp / vLLM espongono sotto /v1: aggiungilo se manca.
    if (!/\/v\d+$/i.test(base)) base += "/v1";
  }
  return base;
}

function netHint(err) {
  const msg = err instanceof Error ? err.message : String(err || "errore di rete");
  if (/Failed to fetch|fetch failed|NetworkError|ERR_CONNECTION_REFUSED|Load failed/i.test(msg)) {
    return "Motore non raggiungibile. Controlla che sia avviato (es. `ollama serve`) e che l'URL e la porta siano corretti nelle impostazioni.";
  }
  if (/aborted|Timeout|timed out/i.test(msg)) {
    return "Il motore non ha risposto in tempo (timeout). Un modello locale grande può metterci minuti alla prima richiesta: riprova o usa un modello più piccolo.";
  }
  return msg;
}

async function fetchTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Ollama, per sicurezza, accetta dal browser solo le pagine su localhost:
 *  le ESTENSIONI partono da un'origine diversa (chrome-extension://…,
 *  moz-extension://…) e Ollama risponde 403 al POST /api/chat. Il GET
 *  /api/tags invece parte senza intestazione Origin e PASSA anche con
 *  Ollama bloccato. Cura: variabile OLLAMA_ORIGINS + riavvio COMPLETO. */
const ORIGIN_BLOCKED_HINT =
  "Ollama è raggiungibile ma BLOCCA le richieste dell'estensione (errore 403): per sicurezza accetta dal browser solo le pagine su localhost. " +
  "Si sblocca una volta per tutte: apri le impostazioni di MindFlow (ingranaggio nel pannello) e segui la sezione «Sblocca Ollama» — variabile OLLAMA_ORIGINS + riavvio completo di Ollama.";

function OriginBlockedError(msg) {
  const e = new Error(msg || ORIGIN_BLOCKED_HINT);
  e.isOriginBlocked = true;
  return e;
}

/** LM Studio (e i server OpenAI-compatibili locali) parte con CORS SPENTO:
 *  il GET /v1/models passa e fa sembrare il motore collegato, ma il POST
 *  /chat/completions dell'estensione (origine chrome-extension://…) riceve
 *  403. E' il gemello del 403 di Ollama, con cura diversa: l'interruttore
 *  CORS dentro LM Studio. */
const COMPAT_BLOCKED_HINT =
  "Il server locale (LM Studio) \u00e8 raggiungibile ma RIFIUTA le richieste dell'estensione (errore 403): \u00e8 il CORS del server, spento per impostazione predefinita. " +
  "Si sblocca una volta per tutte: apri LM Studio \u2192 scheda Developer (Sviluppo) \u2192 impostazioni del server \u2192 attiva \u00abEnable CORS\u00bb (Llama.cpp/vLLM: avvia il server con gli header CORS), poi premi di nuovo \u00abTest connessione\u00bb.";

function CompatBlockedError(msg) {
  const e = new Error(msg || COMPAT_BLOCKED_HINT);
  e.isCompatBlocked = true;
  return e;
}

/** Sonda il blocco estensioni di Ollama SENZA caricare modelli: POST
 *  /api/chat con nome modello inesistente. 403 = origine bloccata (il
 *  middleware CORS scatta subito); 404 "model not found" = sbloccata. */
async function originProbe(engine) {
  if (!engine || engine.kind !== "ollama") return { blocked: false };
  const base = normalizeBase("ollama", engine.baseUrl);
  try {
    const res = await fetchTimeout(
      `${base}/api/chat`,
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

/** Sonda il CORS del server OpenAI-compatibile locale senza toccare modelli:
 *  POST /chat/completions con nome modello inesistente. CORS attivo →
 *  400/404 «model not found» (la richiesta PASSA); CORS spento → 403 subito. */
async function compatOriginProbe(engine) {
  if (!engine || engine.kind !== "openai-compat") return { blocked: false };
  const base = normalizeBase("openai-compat", engine.baseUrl);
  try {
    const res = await fetchTimeout(
      `${base}/chat/completions`,
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

/** Diagnosi di una risposta Ollama 200 OK SENZA testo: legge i contatori
 *  allegati da Ollama (token generati, tempo di caricamento del modello) e
 *  dice COSA è andato storto — stesso messaggio del client diretto
 *  (engine-client.js). */
function ollamaEmptyDiagnosis(data) {
  const d = data || {};
  const evalCount = typeof d.eval_count === "number" ? d.eval_count : null;
  const loadSec = typeof d.load_duration === "number" ? d.load_duration / 1e9 : null;
  const totalSec = typeof d.total_duration === "number" ? d.total_duration / 1e9 : null;
  const bits = [];
  if (evalCount === null) bits.push("nessun token conteggiato");
  else if (evalCount === 0) bits.push("0 token generati");
  else bits.push(`${evalCount} token generati ma testo assente`);
  if (loadSec !== null && loadSec >= 1) bits.push(`modello caricato in ${loadSec.toFixed(1).replace(".", ",")} s`);
  if (totalSec !== null && totalSec >= 1) bits.push(`risposta totale in ${totalSec.toFixed(1).replace(".", ",")} s`);
  if (d.done_reason) bits.push(`done_reason: ${d.done_reason}`);
  let msg = `Risposta Ollama priva di contenuto (${bits.join(", ")}).`;
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
 *  è muto per QUALSIASI prompt (file corrotto, disco esterno spento, memoria
 *  insufficiente) o se il vuoto era un glitch del singolo prompt. Se il
 *  modello era a freddo, il ping lo carica in RAM: il riassunto riprovato
 *  subito dopo parte caldo. */
async function ollamaPing(engine) {
  try {
    const out = await engineChat(engine, {
      user: "Rispondi con esattamente una parola: OK",
      maxTokens: 12,
      temperature: 0,
      numCtx: 2048,
      timeoutMs: 120000,
      jsonMode: false,
    });
    return out && out.trim() ? "ok" : "empty";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err && err.isNetwork) return "timeout";
    if (/raggiungibile/i.test(msg)) return "unreachable";
    if (/timeout|in tempo/i.test(msg)) return "timeout";
    return msg;
  }
}

/** Una chiamata di completamento normalizzata -> testo. */
async function engineChat(engine, { system, user, maxTokens, temperature, timeoutMs, numCtx, jsonMode }) {
  const kind = engine.kind;
  const base = normalizeBase(kind, engine.baseUrl);
  const model = (engine.model || "").trim();
  const key = (engine.apiKey || "").trim();
  if (!model) throw new Error("Modello non impostato nelle impostazioni dell'estensione.");
  const t = Math.max(15000, timeoutMs || 120000);

  let url, init;
  if (kind === "ollama") {
    url = `${base}/api/chat`;
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        // "format": "json" vincola l'output del modello a un oggetto JSON
        // valido: con gemma e modelli piccoli elimina il problema "risposta
        // non interpretabile" (la causa tipica dei checkpoint rifiutati).
        // Disattivabile (jsonMode:false) nel 2° tentativo dopo una risposta
        // VUOTA: stessa difesa del client diretto (engine-client.js).
        ...(jsonMode !== false ? { format: "json" } : {}),
        // Il modello resta caricato in memoria 15 minuti dopo la risposta:
        // il checkpoint successivo non paga di nuovo il caricamento a freddo.
        keep_alive: "15m",
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: user },
        ],
        options: {
          temperature: temperature ?? 0.3,
          num_predict: maxTokens ?? 700,
          // Finestra di contesto esplicita: senza, Ollama usa il suo default
          // piccolo e TRONCA IN SILENZIO prompt lunghi (le risposte sparivano
          // dal contesto — la fatica di riassunto su ChatGPT).
          ...(numCtx ? { num_ctx: Math.max(2048, Math.round(numCtx)) } : {}),
        },
      }),
    };
  } else if (kind === "openai-compat" || kind === "openai") {
    if (kind === "openai" && !key) {
      throw new Error("Chiave API OpenAI mancante: inseriscila nelle impostazioni dell'estensione.");
    }
    url = `${base}/chat/completions`;
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;
    init = {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: temperature ?? 0.3,
        max_tokens: maxTokens ?? 700,
        stream: false,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: user },
        ],
      }),
    };
  } else if (kind === "anthropic") {
    if (!key) {
      throw new Error("Chiave API Anthropic mancante: inseriscila nelle impostazioni dell'estensione.");
    }
    url = `${base}/messages`;
    init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens ?? 700,
        temperature: temperature ?? 0.3,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: user }],
      }),
    };
  } else {
    throw new Error(`Tipo di motore sconosciuto: ${kind}`);
  }

  let res;
  try {
    res = await fetchTimeout(url, init, t);
  } catch (err) {
    throw new Error(netHint(err));
  }
  if (!res.ok) {
    // 403 + Ollama: il middleware CORS rifiuta l'origine dell'estensione
    // (corpo vuoto). Cura precisa: OLLAMA_ORIGINS. Non è il motore spento.
    if (res.status === 403 && kind === "ollama") {
      throw OriginBlockedError();
    }
    // 403 + OpenAI-compat locale (LM Studio & co.): il CORS del server rifiuta
    // l'origine dell'estensione. Cura: l'interruttore CORS di LM Studio.
    if (res.status === 403 && kind === "openai-compat") {
      throw CompatBlockedError();
    }
    let detail = `Errore ${res.status} dal motore`;
    try {
      const body = await res.json();
      const inner = body && body.error;
      if (typeof inner === "string") detail = inner;
      else if (inner && inner.message) detail = inner.message;
      else if (body && body.message) detail = body.message;
    } catch (_e) {
      /* corpo non JSON */
    }
    throw new Error(detail + ".");
  }

  const data = await res.json();
  if (kind === "ollama") {
    // Ollama risponde a volte 200 con {error: "..."} (es. modello che non
    // carica per memoria insufficiente): senza questo controllo l'errore
    // passava inosservato e il riassunto falliva senza un motivo chiaro.
    if (data && typeof data.error === "string" && data.error) {
      throw new Error("Ollama: " + data.error);
    }
    const c =
      data && data.message && typeof data.message.content === "string"
        ? data.message.content.trim()
        : "";
    if (!c) {
      // 200 OK ma nessun testo: i metadati allegati da Ollama (token generati,
      // tempo di caricamento) dicono COSA è andato storto — diagnosi identica
      // a quella del client diretto.
      const e = new Error(ollamaEmptyDiagnosis(data));
      e.isEmptyResponse = true;
      throw e;
    }
    return c;
  }
  if (kind === "anthropic") {
    const c = Array.isArray(data.content)
      ? data.content.map((b) => b.text || "").join("")
      : "";
    if (!c) throw new Error("Risposta Anthropic priva di contenuto.");
    return c;
  }
  // Modelli "thinking" (Qwen3 & simili): il ragionamento viaggia in
  // reasoning_content e la risposta finale in content. Se il tetto di token
  // finisce mentre il modello PENSA, content resta vuoto con finish_reason
  // "length": stessa difesa del client diretto (engine-client.js).
  const pick = data.choices && data.choices[0] ? data.choices[0] : null;
  let c = pick && pick.message && typeof pick.message.content === "string" ? pick.message.content.trim() : "";
  if (!c) {
    const reasoning =
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
  return c;
}

// ---------------------------------------------------------------------------
// Test connessione
// ---------------------------------------------------------------------------

async function engineTest(engine) {
  const kind = engine.kind;
  const base = normalizeBase(kind, engine.baseUrl);
  const key = (engine.apiKey || "").trim();
  let url = base;
  const headers = {};
  if (kind === "ollama") {
    url = `${base}/api/tags`;
  } else {
    url = `${base}/models`;
    if (key && kind !== "anthropic") headers.Authorization = `Bearer ${key}`;
    if (kind === "anthropic") {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    }
  }
  let res;
  try {
    res = await fetchTimeout(url, { method: "GET", headers }, 20000);
  } catch (err) {
    return { ok: false, error: netHint(err) };
  }
  if (!res.ok) {
    if (res.status === 403 && kind === "ollama") {
      return { ok: false, originBlocked: true, error: ORIGIN_BLOCKED_HINT };
    }
    return { ok: false, error: `Il motore ha risposto con errore ${res.status} (${url}).` };
  }
  let models = [];
  try {
    const data = await res.json();
    if (kind === "ollama" && Array.isArray(data.models)) {
      models = data.models.map((m) => m.name || m.model).filter(Boolean);
    } else if (Array.isArray(data.data)) {
      // OpenAI / LM Studio: [{ id: "..." }]
      models = data.data.map((m) => m.id).filter(Boolean);
    } else if (Array.isArray(data.models)) {
      // Anthropic: { data: [...] } è già gestito sopra; qui fallback generico
      models = data.models.map((m) => m.id || m.name).filter(Boolean);
    }
  } catch (_e) {
    /* lista modelli non disponibile: la connessione comunque funziona */
  }
  // AUTO-CORREZIONE del nome modello (Ollama E OpenAI-compat locali): se
  // quello impostato non esiste nel motore (es. "gemma3" invece di
  // "gemma3:latest", o "qwen3.5 9b abliterated" invece della chiave lunga di
  // LM Studio) lo si sostituisce con l'equivalente installato e lo si salva.
  // Senza questo il pannello resta su "modello assente" e ogni riassunto
  // falliva per un NOME sbagliato.
  if ((kind === "ollama" || kind === "openai-compat") && models.length) {
    const wanted = (engine.model || "").trim();
    if (wanted && models.indexOf(wanted) === -1) {
      const alt = fuzzyFindModel(models, wanted) || pickDefaultModel(models);
      if (alt && alt !== wanted) {
        persistEngineModel(alt);
        return { ok: true, models: models.slice(0, 40), fixedModel: alt };
      }
    }
  }
  // Ollama: il solo GET /api/tags NON rivela il blocco estensioni. La sonda
  // POST (stessa forma delle richieste di riassunto) dice la verità PRIMA
  // che l'utente tenti un checkpoint e becca il 403.
  if (kind === "ollama") {
    const probe = await originProbe(engine);
    if (probe.blocked) {
      return { ok: false, originBlocked: true, models: models.slice(0, 40), error: ORIGIN_BLOCKED_HINT };
    }
  }
  // OpenAI-compat locale (LM Studio, llama.cpp, vLLM…): il GET /models passa
  // anche col CORS spento — la sonda POST dice la verità PRIMA del riassunto.
  if (kind === "openai-compat") {
    const cprobe = await compatOriginProbe(engine);
    if (cprobe.blocked) {
      return { ok: false, compatBlocked: true, models: models.slice(0, 40), error: COMPAT_BLOCKED_HINT };
    }
  }
  return { ok: true, models: models.slice(0, 40) };
}

// ---------------------------------------------------------------------------
// Riassunto checkpoint
// ---------------------------------------------------------------------------

const SUMMARIZER_PROMPT = `Sei il motore di memoria di MindFlow Companion. Analizza un segmento di contenuto: può venire da una chat con un assistente AI (ChatGPT, Claude, Gemini) oppure da una pagina web (voce wiki, articolo, documentazione).
Rispondi con SOLO un oggetto JSON valido, senza markdown, in questo formato:
{"title": "...", "summary": "...", "keyDecisions": ["...", "..."]}

Regole:
- "title": massimo 6 parole, il sotto-argomento del segmento (stessa lingua del contenuto).
- "summary": massimo 50 parole, un checkpoint COMPATTO e denso. Ciò che conta sono le informazioni CONSEGNATE: spiegazioni, fatti, definizioni, nomi e numeri dell’assistente o del documento. Le domande dell’utente sono solo contesto: NON riassumere le domande.
- "keyDecisions": 0-3 conclusioni o punti chiave espliciti del segmento. Array vuoto se non ci sono.
- Non inventare nulla che non sia nel segmento.`;

/** Riconosce gli errori "modello non trovato" di QUALSIASI motore: Ollama
 *  («model … not found, try pulling»), LM Studio/llama.cpp («model xyz not
 *  found»), vLLM («The model `xyz` does not exist»). */
const MODEL_NOT_FOUND_RE =
  /not found|try pulling|no such model|unknown model|does not exist|failed to find|modello (non trovato|inesistente|sconosciuto)/i;

/** Chiave normale di un nome modello (stessa logica del client diretto):
 *  LM Studio usa chiavi lunghe e con maiuscole («lmstudio-community/
 *  Qwen3.5-9B-abliterated-GGUF») mentre l'utente scrive «qwen3.5 9b
 *  abliterated»: si tiene l'ultimo tratto dopo «/», si tolgono i tag Ollama e
 *  i suffissi tecnici (-gguf, -fim) e si unificano i separatori. */
function normalizeModelKey(name) {
  let s = String(name || "").trim().toLowerCase();
  if (!s) return "";
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  s = s.split(":")[0];
  s = s.replace(/-(gguf|fim)$/i, "");
  return s.replace(/[-_.\s]+/g, "");
}

/** Cerca tra i modelli presenti quello che l'utente ha voluto dire:
 *  identico → stessa chiave normale → contenimento (minimo 4 caratteri). */
function fuzzyFindModel(models, wanted) {
  if (!models || !models.length || !wanted) return "";
  const target = String(wanted).trim();
  if (!target) return "";
  if (models.some((m) => String(m) === target)) {
    return models.find((m) => String(m) === target);
  }
  const key = normalizeModelKey(target);
  if (!key) return "";
  const same = models.find((m) => normalizeModelKey(m) === key);
  if (same) return same;
  let best = "";
  let bestLen = Infinity;
  for (const m of models) {
    const mk = normalizeModelKey(m);
    if (!mk || mk.length < 4) continue;
    if (mk.includes(key) || key.includes(mk)) {
      if (mk.length < bestLen) {
        best = m;
        bestLen = mk.length;
      }
    }
  }
  return best;
}

function parseLenientJson(text) {
  const cleaned = (text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
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

/** Trascritto del segmento per la COMPRESIONE (v1.1.0): le RISPOSTE
 *  dell'assistente valgono più delle domande — cap 1500 caratteri a risposta
 *  contro 450 a domanda — e il totale resta su ~12000 caratteri, perché la
 *  chiamata usa num_ctx 8192 e il modello NON deve troncare in silenzio. */
function segmentTranscript(segment) {
  const lines = [];
  let total = 0;
  for (const m of segment) {
    const cap = m.role === "assistant" ? 1500 : 450;
    let t = String(m.text || "").replace(/\s+/g, " ").trim();
    if (t.length > cap) t = t.slice(0, cap) + "…";
    if (total + t.length > 12000) {
      const rest = 12000 - total;
      if (rest < 80) break;
      t = t.slice(0, rest) + "…";
    }
    total += t.length;
    lines.push(`[${m.role === "user" ? "UTENTE" : "ASSISTENTE"}]: ${t}`);
    if (total >= 12000) break;
  }
  return lines.join("\n\n");
}

async function summarize(engine, segment, prevTitle) {
  const transcript = segmentTranscript(segment);
  const baseUser = `${prevTitle ? `Checkpoint precedente: “${prevTitle}”.\n\n` : ""}Segmento da comprimere:\n\n${transcript}`;
  const call = (eng, extra, freeMode, tokens) =>
    engineChat(eng, {
      system: SUMMARIZER_PROMPT + (extra || ""),
      user: baseUser,
      // Checkpoint compatto: meno token generati, risposta più rapida.
      // tokens: dal 2° tentativo sui motori OpenAI-compatibili si sale a 900
      // per i modelli «thinking» che sprecano il budget nel ragionamento.
      maxTokens: tokens || 420,
      temperature: 0.2,
      numCtx: 8192,
      // Il caricamento a freddo di un modello locale può superare il minuto:
      // 180 s evita che un riassunto VALIDO muoia per timeout. Il lavoro gira
      // comunque come job: non è più legato alla vita della risposta al
      // messaggio e il service worker non viene spento a metà.
      timeoutMs: 180000,
      // 2° tentativo dopo risposta VUOTA: senza modalità JSON forzata
      // (stessa difesa del client diretto engine-client.js).
      jsonMode: !freeMode,
    });

  let used = engine;
  let recoveredModel = "";
  let parsed = null;
  let lastRaw = "";
  let lastError = "";
  let originErr = null;
  // 2 tentativi: gli errori TRANSITORI (motore che si sveglia, rete locale in
  // ritardo) venivano rifiutati senza un solo tentativo. Se il modello non
  // produce JSON leggibile (tipico dei modelli piccoli che incorniciano o
  // commentano l'output) al secondo tentativo va l'istruzione dura.
  // L'auto-riparazione del modello (nome errato) riparte dal primo giro.
  // 180 s per richiesta: il freddo di un modello locale di solito finisce in
  // meno di un minuto; il lavoro girà comunque come job, non legato alla
  // vita della risposta al messaggio.
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    if (attempt > 0 && lastError) {
      await new Promise((r) => setTimeout(r, 1200)); // respiro tra i tentativi
    }
    let raw;
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
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      // 403 di Ollama: blocco DETERMINISTICO dell'origine. Riprovare non
      // cambia nulla e l'auto-riparazione del modello non c'entra: si esce
      // subito con l'errore giusto (e il flag per chi lo mostra).
      if (err && err.isOriginBlocked) {
        originErr = err;
        break;
      }
      // AUTO-RIPARAZIONE del modello (Ollama E OpenAI-compat locali): se il
      // nome impostato non esiste nel motore (es. "gemma" invece di
      // "gemma3:latest", o il nome corto invece della chiave lunga di LM
      // Studio), lo si sostituisce con il modello installato più adatto.
      if ((used.kind === "ollama" || used.kind === "openai-compat") && MODEL_NOT_FOUND_RE.test(msg)) {
        const rec = await recoverEngineModel(used);
        if (rec && rec !== used.model) {
          recoveredModel = rec;
          used = { ...used, model: rec };
          persistEngineModel(rec);
          attempt = -1; // il giro col modello giusto riparte dal primo tentativo
          continue;
        }
      }
      continue; // errore di rete/timeout: riprova (fino a esaurire i tentativi)
    }
    lastRaw = raw;
    parsed = parseLenientJson(raw);
    if (parsed && (typeof parsed !== "object" || !parsed.title)) parsed = null;
  }
  // NIENTE fallback locale: se il motore non produce un checkpoint valido lo
  // si dichiara e il grafo resta pulito (v0.9.0: il vecchio fallback estrattivo
  // riempiva il grafo di nodi tutti uguali e nascondeva lo stato reale del
  // motore dietro l'etichetta "euristico").
  if (!parsed) {
    // Blocco estensioni di Ollama (403): la cura è OLLAMA_ORIGINS, non un
    // nuovo tentativo. L'errore conserva il flag per il chiamante.
    if (originErr) throw originErr;
    const head = (lastRaw || "").replace(/\s+/g, " ").slice(0, 160);
    const reason = lastError
      ? lastError.replace(/[.\s]+$/, "")
      : lastRaw
        ? `risposta non interpretabile come JSON (“${head}…”)`
        : "nessuna risposta dal motore";
    // PING di controllo (solo Ollama, solo se non è mai arrivato testo):
    // stessa diagnosi profonda del client diretto — distingue «modello muto
    // per TUTTI» (file corrotti, disco esterno spento) da un glitch.
    let probeSuffix = "";
    if (used.kind === "ollama" && !lastRaw && /priva di contenuto/.test(lastError)) {
      const verdict = await ollamaPing(used);
      if (verdict === "ok") {
        probeSuffix = " Ping di controllo riuscito: il modello GENERA normalmente — il vuoto era transitorio: riprova ORA il riassunto (il modello è caldo in RAM).";
      } else if (verdict === "empty") {
        probeSuffix = " Ping di controllo VUOTO: il modello non scrive per NESSUN prompt — file modello corrotti/incompleti o disco esterno spento/in riposo (nel terminale: ollama run <modello> \"ciao\" e ollama ps).";
      } else if (verdict === "timeout") {
        probeSuffix = " Ping di controllo senza risposta in tempo: il modello impiega troppo a caricarsi (disco esterno lento o memoria piena) — riprova tra poco o usa un modello più piccolo.";
      } else if (verdict === "unreachable") {
        probeSuffix = " Ping di controllo: motore non raggiungibile — controlla che Ollama sia avviato (ollama serve) e riprova.";
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
      ? parsed.keyDecisions.filter((d) => typeof d === "string" && d.trim()).slice(0, 6)
      : [],
    ...(recoveredModel ? { recoveredModel } : {}),
  };
}

/** Trova nel motore (Ollama O OpenAI-compat: LM Studio, llama.cpp, vLLM…) il
 *  modello installato più adatto al nome voluto: match fuzzy sulla lista
 *  vera, poi preferenza small/generalista. Ritorna "" se non c'è nulla di
 *  utile da sostituire. */
async function recoverEngineModel(engine) {
  try {
    if (!engine || engine.kind === "anthropic") return "";
    const base = normalizeBase(engine.kind, engine.baseUrl);
    const url = engine.kind === "ollama" ? `${base}/api/tags` : `${base}/models`;
    const res = await fetchTimeout(url, { method: "GET" }, 8000);
    if (!res.ok) return "";
    const data = await res.json();
    let models = [];
    if (Array.isArray(data.models)) {
      models = data.models.map((m) => m.name || m.model || m.id).filter(Boolean);
    } else if (Array.isArray(data.data)) {
      models = data.data.map((m) => m.id).filter(Boolean);
    }
    if (!models.length) return "";
    const rec = fuzzyFindModel(models, engine.model || "") || pickDefaultModel(models);
    return rec && rec !== engine.model ? rec : "";
  } catch (_e) {
    return "";
  }
}

/** Salva il modello corretto nelle impostazioni: il pannello lo vede subito
 *  (ascolta chrome.storage.onChanged) e i checkpoint seguenti lo usano già. */
function persistEngineModel(model) {
  try {
    chrome.storage.local.get("mf.settings", (res) => {
      const s = (res && res["mf.settings"]) || {};
      s.engine = { ...(s.engine || {}), model };
      chrome.storage.local.set({ "mf.settings": s });
    });
  } catch (_e) {
    /* storage non disponibile: la correzione vale solo per questa chiamata */
  }
}

// ---------------------------------------------------------------------------
// Rilevamento automatico del motore locale
// ---------------------------------------------------------------------------

// Candidati noti, in ordine di preferenza. Per ogni candidato proviamo
// entrambe le varianti di host (127.0.0.1 e localhost): alcune installazioni
// (macOS, Docker, IPv6) rispondono solo su una delle due. v1.2.2: LM Studio
// sale di porta (1235–1237) quando la 1234 è occupata e Ollama idem
// (11435–11436) — il caso reale dell'utente con il server su 1235.
const PROBE_CANDIDATES = [
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

/** Interroga un endpoint e, se risponde, restituisce il motore individuato
 *  con la sua lista modelli. Tutto il resto: null (nessun errore lanciato). */
async function probeCandidate(c) {
  const url = c.baseUrl.replace(/\/+$/, "") + c.path;
  try {
    const res = await fetchTimeout(url, { method: "GET" }, 4000);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;
    let models = [];
    if (c.kind === "ollama" && Array.isArray(data.models)) {
      models = data.models.map((m) => m.name || m.model).filter(Boolean);
    } else if (Array.isArray(data.data)) {
      models = data.data.map((m) => m.id).filter(Boolean);
    } else if (Array.isArray(data.models)) {
      models = data.models.map((m) => m.id || m.name).filter(Boolean);
    } else if (Array.isArray(data.model_list)) {
      // LM Studio (API REST proprietaria) / Jan: [{ id | name }]
      models = data.model_list.map((m) => m.id || m.name || (m.meta && m.meta.alias)).filter(Boolean);
    }
    if (c.kind === "ollama" && !Array.isArray(data.models)) return null; // porta 11434 ma non Ollama
    if (c.kind !== "ollama" && !models.length) return null;
    return { kind: c.kind, baseUrl: c.baseUrl, label: c.label, models: models.slice(0, 40) };
  } catch (_e) {
    return null;
  }
}

/** Sonda tutti i candidati in parallelo e restituisce quelli che hanno
 *  risposto, ordinati per preferenza (Ollama nativo prima, poi i compatibili
 *  nell'ordine della lista; a parità di condizioni, il primo modello
 *  disponibile fa da selezione predefinita). */
async function autodetectEngine() {
  const results = (await Promise.all(PROBE_CANDIDATES.map(probeCandidate))).filter(Boolean);
  // Deduplica per (kind, baseUrl): 127.0.0.1 e localhost possono rispondere entrambi.
  const seen = new Set();
  const found = results.filter((r) => {
    const k = r.kind + "|" + r.baseUrl.replace("localhost", "127.0.0.1");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!found.length) {
    return {
      ok: false,
      scanned: PROBE_CANDIDATES.length,
      error:
        "Nessun motore locale trovato. Ho provato Ollama (11434–11437), LM Studio (1234–1237), llama.cpp (8080), vLLM (8000), Jan (1337), KoboldCpp (5001), GPT4All (4891), text-generation-webui (5000). Avvia il motore (es. `ollama serve`; LM Studio: scheda Developer → Start Server) e riprova, oppure compila i campi a mano.",
    };
  }
  const best = found[0];
  const model = pickDefaultModel(best.models);
  return { ok: true, found, best: { ...best, model } };
}

/** Sceglie il modello predefinito: preferisce uno small/generalista tra quelli
 *  installati (l'utente spesso ha anche modelli da coding specializzati). */
function pickDefaultModel(models) {
  if (!models.length) return "";
  const preferred = models.find((m) => /gemma|llama|mistral|phi|qwen2\.?5.*instruct|qwen3|granite|smol/i.test(m));
  return preferred || models[0];
}

// ---------------------------------------------------------------------------
// Lavori di riassunto (ACK immediato + polling)
// ---------------------------------------------------------------------------

const JOB_TTL_MS = 15 * 60 * 1000;      // i lavori finiti restano leggibili 15 min
const JOB_TIMEOUT_MS = 9 * 60 * 1000;   // limite di vita di un lavoro
const SESSION_JOBS_KEY = "mf.jobs";

const jobs = new Map();

/** Mentre c'è almeno un lavoro attivo il service worker si tiene vivo da solo:
 *  qualsiasi chiamata API resetta il timer di inattività (~30 s). Senza questo
 *  il worker veniva spento durante la chiamata lunga al motore, il canale del
 *  messaggio si chiudeva e i chiamanti vedevano «service worker
 *  non raggiungibile». */
let keepAliveTimer = null;
let keepAliveRefs = 0;

function keepAliveAcquire() {
  keepAliveRefs++;
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(function () {
    try {
      chrome.runtime.getPlatformInfo(function () {
        void chrome.runtime.lastError;
      });
    } catch (_e) {
      /* niente: il prossimo tick riprova */
    }
  }, 20000);
}

function keepAliveRelease() {
  keepAliveRefs = Math.max(0, keepAliveRefs - 1);
  if (keepAliveRefs === 0 && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function pruneJobs() {
  const now = Date.now();
  const gone = [];
  jobs.forEach(function (j, id) {
    if (now - j.updatedAt > JOB_TTL_MS) gone.push(id);
  });
  gone.forEach(function (id) {
    jobs.delete(id);
  });
  return gone.length > 0;
}

/** Specchia i lavori in storage.session: sopravvivono al riavvio del service
 *  worker (che svuota le variabili di modulo) e permettono di dire al pannello
 *  COSA è successo invece di lasciarlo in attesa per sempre. */
function persistJobs() {
  try {
    const out = [];
    jobs.forEach(function (j) {
      out.push(j);
    });
    chrome.storage.session.set(
      { [SESSION_JOBS_KEY]: out },
      function () {
        void chrome.runtime.lastError;
      }
    );
  } catch (_e) {
    /* storage.session non disponibile: i lavori restano solo in memoria */
  }
}

function startSummarizeJob(engine, segment, prevTitle) {
  pruneJobs();
  const id =
    "job-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const job = {
    id: id,
    status: "running",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    restarts: 0,
    // Parametri PERSISTITI: se il worker viene spento a metà, al riavvio il
    // lavoro riparte da solo invece di lasciare il chiamante in pausa.
    params: { engine: engine, segment: segment, prevTitle: prevTitle },
  };
  jobs.set(id, job);
  persistJobs();
  runSummarizeJob(job, engine, segment, prevTitle); // async, NON atteso
  return id;
}

/** Riavvia un lavoro «running» trovato in storage.session ma assente dalla
 *  mappa (il worker è stato spento e riacceso). Idempotente: se il lavoro è
 *  già in mappa non fa nulla. Ritorna true se il lavoro è (ri)partito.
 *  Massimo 2 riavvii e vita massima JOB_TIMEOUT_MS: poi si dichiara l'errore
 *  vero invece di girare in tondo per sempre. */
function tryResumeJob(j) {
  if (!j || j.status !== "running" || !j.params) return false;
  if (jobs.has(j.id)) return true; // già ripreso (o ancora vivo)
  const tooOld = Date.now() - (j.startedAt || Date.now()) > JOB_TIMEOUT_MS;
  const tooManyRestarts = (j.restarts || 0) >= 2;
  if (tooOld || tooManyRestarts) {
    jobs.set(j.id, {
      id: j.id,
      status: "error",
      startedAt: j.startedAt,
      updatedAt: Date.now(),
      params: j.params,
      error: tooOld
        ? "Il motore non ha completato il riassunto entro " +
          Math.round(JOB_TIMEOUT_MS / 60000) +
          " minuti (timeout). Un modello locale grande alla prima richiesta può metterci molto: riprova o usa un modello più piccolo."
        : "Il riassunto è stato interrotto più volte dal riavvio del service worker: riprova (il pannello ora usa il collegamento diretto al motore).",
    });
    persistJobs();
    return false;
  }
  const job = {
    id: j.id,
    status: "running",
    startedAt: j.startedAt,
    updatedAt: Date.now(),
    restarts: (j.restarts || 0) + 1,
    params: j.params,
  };
  jobs.set(j.id, job);
  runSummarizeJob(job, job.params.engine, job.params.segment, job.params.prevTitle);
  return true;
}

/** All'accensione del worker: riavvia tutti i lavori rimasti «running» in
 *  storage.session (il worker precedente è morto a metà). Chiamata anche
 *  da jobStatus: così un poll che sveglia il worker trova il lavoro già
 *  ripartito invece di un falso «interrotto». */
function resumeRunningJobs() {
  return new Promise(function (resolve) {
    try {
      chrome.storage.session.get(SESSION_JOBS_KEY, function (res) {
        void chrome.runtime.lastError;
        const arr = res && res[SESSION_JOBS_KEY];
        if (!Array.isArray(arr)) return resolve(false);
        let any = false;
        arr.forEach(function (j) {
          if (tryResumeJob(j)) any = true;
        });
        resolve(any);
      });
    } catch (_e) {
      resolve(false); // storage.session assente: niente da riprendere
    }
  });
}

async function runSummarizeJob(job, engine, segment, prevTitle) {
  keepAliveAcquire();
  try {
    const data = await summarize(engine, segment, prevTitle);
    if (jobs.get(job.id) !== job) return; // lavoro scaduto nel frattempo
    job.status = "done";
    job.result = data;
    job.updatedAt = Date.now();
    persistJobs();
  } catch (err) {
    if (jobs.get(job.id) !== job) return;
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.updatedAt = Date.now();
    persistJobs();
  } finally {
    keepAliveRelease();
  }
}

/** Stato di un lavoro per i chiamanti. Se il service worker è stato riavviato
 *  a metà lavoro (mappa svuotata) lo stato sopravvive in storage.session: un
 *  lavoro ancora «running» lì dentro è morto col vecchio worker e lo si
 *  dichiara, invece di lasciare il pannello in attesa all'infinito. */
function jobStatus(jobId) {
  if (!jobId || typeof jobId !== "string") {
    return Promise.resolve({ ok: false, error: "id lavoro mancante" });
  }
  const job = jobs.get(jobId);
  if (job) {
    if (job.status === "running" && Date.now() - job.startedAt > JOB_TIMEOUT_MS) {
      job.status = "error";
      job.error =
        "Il motore non ha completato il riassunto entro " +
        Math.round(JOB_TIMEOUT_MS / 60000) +
        " minuti (timeout). Un modello locale grande alla prima richiesta può metterci molto: riprova o usa un modello più piccolo.";
      job.updatedAt = Date.now();
      persistJobs();
    }
    return Promise.resolve({
      ok: true,
      jobId: jobId,
      done: job.status !== "running",
      status: job.status,
      result: job.status === "done" ? job.result : undefined,
      error: job.status === "error" ? job.error : undefined,
    });
  }
  // Lavoro assente dalla mappa: o scaduto o worker riavviato. Con l'AUTO-RIPRESA
  // un lavoro ancora «running» lì dentro viene RIATTIVATO qui (il poll che ha
  // svegliato questo worker trova il lavoro ripartito, non un falso errore);
  // solo se non è più ripartibile la risposta dice la verità.
  return new Promise(function (resolve) {
    (async function () {
      let stale = null;
      try {
        const res = await new Promise(function (r) {
          try {
            chrome.storage.session.get(SESSION_JOBS_KEY, function (out) {
              void chrome.runtime.lastError;
              r(out || {});
            });
          } catch (_e) {
            r({});
          }
        });
        const arr = res && res[SESSION_JOBS_KEY];
        stale = Array.isArray(arr)
          ? arr.find(function (j) {
              return j && j.id === jobId;
            }) || null
          : null;
      } catch (_e) {
        stale = null;
      }
      if (!stale) {
        resolve({ ok: false, error: "Lavoro di riassunto scaduto o perduto: riprova." });
        return;
      }
      if (stale.status === "running") {
        const resumed = tryResumeJob(stale);
        resolve(
          resumed
            ? { ok: true, jobId: jobId, done: false, status: "running" }
            : {
                ok: true,
                jobId: jobId,
                done: true,
                status: "error",
                error:
                  "Il riassunto è stato interrotto dal riavvio del service worker e non è più ripartibile: riprova (il pannello ora usa il collegamento diretto al motore).",
              }
        );
        return;
      }
      resolve({
        ok: true,
        jobId: jobId,
        done: true,
        status: stale.status,
        result: stale.status === "done" ? stale.result : undefined,
        error: stale.status === "error" ? stale.error : undefined,
      });
    })();
  });
}

// ---------------------------------------------------------------------------
// Router messaggi
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const type = msg && msg.type;
  if (type === "mindflow:ping") {
    sendResponse({ ok: true, version: VERSION });
    return;
  }
  if (type === "mindflow:engine-test") {
    engineTest(msg.engine || {})
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: netHint(err) }));
    return true;
  }
  if (type === "mindflow:autodetect") {
    autodetectEngine()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: netHint(err) }));
    return true;
  }
  if (type === "mindflow:summarize") {
    // ACK IMMEDIATO: la risposta porta solo l'id del lavoro, che gira in
    // background tenuto vivo dal keep-alive. Il canale dei messaggi non resta
    // più aperto per minuti (era la causa del service worker spento a metà e
    // del falso «service worker non raggiungibile»). Il chiamante legge lo
    // stato con mindflow:job-status.
    try {
      const jobId = startSummarizeJob(
        msg.engine || {},
        Array.isArray(msg.segment) ? msg.segment : [],
        msg.prevTitle || ""
      );
      sendResponse({ ok: true, jobId: jobId });
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (type === "mindflow:job-status") {
    Promise.resolve(jobStatus(msg.jobId))
      .then(sendResponse)
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (type === "mindflow:open-options") {
    try {
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
    return;
  }
  if (type === "mindflow:inject-net") {
    // Iniezione di net-capture.js nel MAIN world della scheda chiamante.
    // chrome.scripting NON è soggetto al CSP della pagina: è la via che
    // funziona anche quando chatgpt.com blocca i <script> esterni.
    // Il tabId arriva dal sender: la richiesta parte dal content script.
    const tabId = _sender && _sender.tab && _sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "Scheda non identificabile" });
      return;
    }
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      sendResponse({ ok: false, error: "chrome.scripting non disponibile (permessi mancanti)" });
      return;
    }
    chrome.scripting
      .executeScript({ target: { tabId }, files: ["net-capture.js"], world: "MAIN" })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true; // risposta asincrona
  }
  if (type === "mindflow:open-url") {
    const url = String((msg && msg.url) || "");
    if (/^https?:\/\//i.test(url)) {
      try {
        chrome.tabs.create({ url });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    } else {
      sendResponse({ ok: false, error: "URL non permesso" });
    }
    return;
  }
});

// AUTO-RIPRESA all'accensione: il worker può essere stato spento con lavori
// in corsa (Chrome li spegne dopo ~30 s di quiete). I parametri sono in
// storage.session: i lavori ripartono da soli prima ancora che un poll
// arrivi a chiederne lo stato.
resumeRunningJobs();

console.log("[MindFlow Companion] service worker attivo, v" + VERSION);
