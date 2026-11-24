# Audit di sicurezza statico — MindFlow Companion v1.2.2

Data: 24 novembre 2026 · Ambito: intero repository (`mindflow-extension/`, `scripts/`, documenti)
Motivazione: apertura del repository al pubblico e preparazione della pubblicazione su Chrome Web Store.
Metodo: analisi statica pattern-based su **tutti** i file sorgente (JS/HTML/CSS/MD/SH/PY) + revisione manuale dei componenti critici (`manifest.json`, `background.js`, `engine-client.js`, `net-capture.js`, `content.js`, `panel.js`, `options.js`, `popup.js`).

## 1. Sintesi degli esiti

| # | Controllo | Esito | Note |
| --- | --- | --- | --- |
| 1 | Segreti nel codice (chiavi API, token, password, Bearer) | ✅ PASS | Nessuna occorrenza in alcun file; le chiavi vivono solo in `chrome.storage.local` |
| 2 | Dati personali nei documenti (email, telefono, indirizzi) | ✅ PASS | Nessuna occorrenza nei file `.md` del repository |
| 3 | Esecuzione dinamica di codice (`eval`, `new Function`, `document.write`, `setTimeout(stringa)`) | ✅ PASS | Zero occorrenze; conforme alla politica MV3 «no remote code» |
| 4 | Script inline negli HTML | ✅ PASS | I tre HTML (popup, panel, options) caricano solo `<script src="…">` esterni e locali |
| 5 | Rischio XSS via DOM | ✅ PASS | 4 usi di `innerHTML`, tutti con stringhe statiche (logo SVG, banner, defs SVG, hint da dizionario interno): nessun dato utente o pagina interpolato |
| 6 | Validazione dei messaggi in entrata | ✅ PASS | `content.js` accetta solo `event.source === window` (cattura rete) e `event.source === iframe.contentWindow` (pannello): anti-spoofing da pagina/iframes |
| 7 | Destinazioni di rete | ✅ PASS | Il traffico parte **solo** verso l'endpoint configurato dall'utente (default: motori su `127.0.0.1`); endpoint fissi solo `api.openai.com`/`api.anthropic.com`, opzionali e con chiave dell'utente |
| 8 | Archiviazione delle chiavi | ✅ PASS | `chrome.storage.local` esclusivamente; nessun uso di `storage.sync` |
| 9 | Cattura di rete | ✅ PASS | `net-capture.js`: clone **read-only** degli stream, solo URL ChatGPT/Claude/GLM, cap 24 KB per messaggio, invio solo al content script via `window.postMessage`; la pagina usa la risposta originale intatta |
| 10 | Permessi manifest | ✅ PASS | Minimi e giustificati (vedi §3); nessuna autorizzazione superflua |
| 11 | Script di build/QA | ⚠ → ✅ FIX | 3 script con percorsi assoluti dell'ambiente di sviluppo: resi relativi (commit di questo audit) |

Nessuna vulnerabilità sfruttabile individuata. Due osservazioni di trasparenza (non vulnerabilità) in §4.

## 2. Metodologia in dettaglio

### 2.1 Pattern analizzati (su tutto il repository)

- **Segreti**: `sk-…`, `Bearer …`, assegnazioni `api[_-]?key|secret|password|token = "…"` con valori lunghi ≥ 8 caratteri — **0 risultati**.
- **Esecuzione dinamica**: `eval(`, `new Function(`, `document.write`, `setTimeout/setInterval` con argomento stringa, `import()` dinamico — **0 risultati**.
- **DOM XSS**: `innerHTML`, `outerHTML`, `insertAdjacentHTML` — **5 occorrenze** (4 codice + 1 documentazione), tutte revisionate una a una:
  - `content.js:487` — logo SVG statico del launcher;
  - `panel.js:160` — banner fisso «MindFlow è stato aggiornato»;
  - `panel.js:503` — defs SVG (gradienti) statici;
  - `options.js:79` — `BASE_HINTS[kind]`: lookup su dizionario interno a chiave enum; chiave arbitraria → stringa vuota. Nessun input di pagina o utente raggiunge il DOM via HTML.
- **URL**: inventario completo di `https?://` — solo namespace SVG W3C, endpoint motori locali (`127.0.0.1`/`localhost` su porte Ollama/LM Studio/llama.cpp/vLLM/Jan/KoboldCpp/GPT4All/text-generation-webui) e i due endpoint cloud opzionali dichiarati.
- **Messaggi**: audit di tutti gli `addEventListener("message")` — le due finestre di ricezione verificano la sorgente (vedi esito 6).
- **HTML**: nessun `<script>` inline, nessuna risorsa remota, `manifest_version: 3` senza `content_security_policy` personalizzata (default MV3 sicuri), `web_accessible_resources` limitati ai 4 file del pannello.

### 2.2 Componenti critici revisionati manualmente

- **`manifest.json`**: permessi `storage`, `clipboardWrite`, `scripting`; host `localhost/127.0.0.1` (motori locali), `api.openai.com`, `api.anthropic.com` (opzionali), domini chat (ChatGPT/Claude/Gemini) e `*/*` per i content script (modalità pagina). Motivazioni complete in [`PUBBLICAZIONE.md`](../PUBBLICAZIONE.md) §5.
- **`background.js`** (service worker): nessun token, nessun endpoint hardcoded di terzi, `fetchTimeout` con `AbortController` verso URL derivati dalle impostazioni utente; messaggi diagnostici senza contenuti sensibili nei log.
- **`engine-client.js`**: costruzione URL da `normalizeBase(kind, engine.baseUrl)`; chiave letta dalle impostazioni e usata **solo** negli header della richiesta al motore scelto; gestione errori senza esporre la chiave.
- **`net-capture.js`**: hook `fetch`/XHR che intercetta **solo** gli URL di stream classificati (`streamKind`); legge un clone della risposta; emette eventi con testo limitato a 24 KB; il canale verso il content script è `window.postMessage` con sorgente `mindflow-net` e il content script verifica `event.source === window`.
- **`content.js`**: il pannello è un iframe `chrome-extension://` che parla solo con il suo content script (`event.source !== iframe.contentWindow → return`).

## 3. Permessi: giustificazioni per la revisione CWS

| Permesso | Perché serve | Nota |
| --- | --- | --- |
| `storage` | Impostazioni motore, grafi e checkpoint nel browser | Solo locale, mai `sync` |
| `clipboardWrite` | «Copia» del contesto compilato | Solo su click dell'utente |
| `scripting` | Iniezione MAIN world della cattura dove il CSP della pagina blocca lo `<script src>` | Path alternativo alla cattura DOM |
| Content script `*/*` | La «modalità pagina» opera su wiki, articoli, documentazione di qualunque dominio | Lettura nel browser; nessun invio tranne al motore configurato |
| Host `localhost` + porte | Motori LLM locali (Ollama, LM Studio, llama.cpp, vLLM…) | Solo `127.0.0.1`/`localhost` |
| Host cloud + siti chat | API cloud opzionali con chiave dell'utente; chat da osservare | Chiavi solo in `storage.local` |

## 4. Trasparenza (da conoscere, non vulnerabilità)

1. **MAIN world e postMessage**: la cattura degli stream gira nella pagina (world MAIN). Gli script della pagina visitata possono tecnicamente leggere i messaggi `mindflow-net` che MindFlow scambia su quella pagina — si tratta del testo della conversazione che la pagina stessa ha già inviato e mostrato all'utente. Dichiarato nell'[informativa privacy](privacy-policy.html) §7.
2. **Superficie content script ampia**: i content script girano su tutti i siti http/https per la modalità pagina. Il codice non invia nulla fuori dal browser salvo l'endpoint configurato; la superficie di lettura resta comunque ampia per progetto (giustificazione CWS già predisposta).

## 5. Interventi correttivi eseguiti con questo audit

- `scripts/build-extension.sh` — percorsi assoluti `/home/z/…` sostituiti con percorsi relativi alla posizione dello script; la copia in `public/` ora avviene solo se la cartella esiste nel clone. Verificato: genera `mindflow-extension-v1.2.2.zip` e la variante Firefox senza adattamenti.
- `scripts/make-extension-icons.py` — cartella di output relativa alla radice del repository (override opzionale via `MINDFLOW_ICONS_DIR`). Verificato: rigenera le 4 icone.
- `scripts/shot_panel_graph.py` — sorgente pannello relativa al repository (gli output restano in `/tmp/render`, fuori dal repository).
- Nota sui percorsi assoluti rimossa da README e ROADMAP (non più necessaria).

## 6. Controlli raccomandati alle prossime release

1. Ri-eseguire questa checklist pattern-based a **ogni release** prima del tag (costo: minuti).
2. A ogni nuovo permesso nel manifest: aggiornare tabella §3 e informativa privacy, poi re-inviare la revisione CWS.
3. Le segnalazioni esterne seguono [`SECURITY.md`](../SECURITY.md) (disclosure privata via GitHub Security Advisories).
4. Dopo la pubblicazione CWS: verificare che l'artefatto caricato corrisponda al tag (il bundle `build-extension.sh` firma di fatto il contenuto via SHA nei CHECKPOINT).
