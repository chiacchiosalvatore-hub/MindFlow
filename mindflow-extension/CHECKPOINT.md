# CHECKPOINT — MindFlow Companion

Registro vivo del progetto: stato, test superati e prossimi passi verso l'MVP.
Da aggiornare a ogni checkpoint di versione. **Ultimo aggiornamento: 24 novembre 2026.**

---

## Versione corrente: v1.2.2 «La porta si corregge da sola»

Chiusura del cerchio LM Studio, segnalata dall'utente il 24/11: la v1.2.1
funziona («ok ha funzionato») e il residuo era una **PORTA sbagliata**: l'utente
aveva «endpoint base http://127.0.0.1:1234/v1 ma era http://127.0.0.1:1235/v1»
— LM Studio parte sulla 1234 e, se la trova occupata, sceglie DA SOLO la
successiva (1235, 1236…): mappa, riassunto ed esposizione ora OK («map al
100%»). La v1.2.2 rende impossibile ripetere l'incidente:

1. **AUTO-CORREZIONE dell'endpoint** (engine-client.js, esportata e testata):
   `candidateAltBases` + `scanAlternateEngines` sondano in parallelo le porte
   vicine (±2 della porta scritta + porte note: LM Studio 1234–1237, Ollama
   11434–11437, llama.cpp/vLLM/Jan/… per i compat) sull'host dell'endpoint
   (127.0.0.1 E localhost: macOS/IPv6 a volte risponde solo su uno dei due).
   Risponde solo chi ha una LISTA MODELLI valida → nessun falso positivo
   (una pagina HTML su una porta non conta).
2. **Quando parte la correzione** (options.js): (a) alla modifica del campo
   endpoint/tipo (prima impostazione); (b) all'apertura delle impostazioni
   (silenziosa, se il motore è configurato); (c) nel «Test connessione»:
   endpoint non raggiungibile → scansione → UN solo server trovato → campo
   corretto e salvato da solo, test riparte una volta sola con nota «Endpoint
   corretto automaticamente (era …): il motore è attivo su …»; più server →
   elenco e scelta; nessuno → guida. Il campo modello si compila da solo se
   vuoto. Il pannello dice la porta giusta nella pillola «motore spento».
3. **Rilevamento automaticamente esteso**: PROBE_CANDIDATES (options.js E
   mirror del service worker) ora includono LM Studio 1235/1236/1237 e Ollama
   11435/11436: «Rileva automaticamente» trova il server anche sulla porta
   non predefinita.
4. **Guida «Non riesco a connettermi — completa»** nella pagina impostazioni
   (nuova card, si apre da sola sugli errori di rete): mappa degli errori
   (non raggiungibile → porta/spento; 403 → CORS; model not found → nome;
   vuoto → file modello), passi dettagliati LM Studio (Start Server, porta
   VERA della scheda Developer, Enable CORS, chiave lunga del modello),
   Ollama (`ollama serve`, `ollama list`, rinvio a «Sblocca Ollama») e
   controlli generali (http, /v1, firewall, 127.0.0.1 vs localhost, due
   motori insieme). Stesse informazioni in INSTALLAZIONE.md (righe nuove in
   «Problemi comuni») e nei messaggi di errore (netHint arricchito).

**Revisione sicurezza finale** (nessun comportamento toccato): zero eval /
   Function dinamici; innerHTML solo con stringhe statiche; nessuno script o
   CSS remoto (CSP MV3 rispettata); chiamate di rete SOLO verso localhost
   (motori) e le API cloud configurate dall'utente; storage tutto in
   chrome.storage.local (mai sync); chiavi mai loggate; net-capture comunica
   solo via postMessage alla pagina; localStorage solo in modalità demo.
   Permessi: storage, clipboardWrite, scripting — tutti giustificati e
   minimizzati; host_permissions localhost + API + siti chat.

Test: nuovo `test-port-autofix.js` **14 pass** (geometria candidati, caso
utente 1235, zero server, due server, Ollama 11435, cloud esclusi, risposta
non-modelli scartata); `test-autodetect.js` + scenario 4 (LM Studio su 1235);
`check-options-dom.js` esteso (guida presente, 12 controlli OK, nessun
overflow/errore JS). Regressione completa verde: engine-client 20, planner 13,
parallel-pipeline 13, build-flow 9, job-flow 21, net-capture 30, panel-boot 8,
integration 4, graph-layout 13, adapters-dom 71, autodetect (4 scenari),
ollama-403, toc-minimale. Build: `download/mindflow-extension-v1.2.2.zip` +
variante Firefox.

### Prove pratiche della v1.2.2 (checklist utente)

1. LM Studio acceso su una porta NON standard (1235): nelle impostazioni
   incolla l'endpoint con la porta SBAGLIATA (1234) e guarda il campo
   correggersi da solo (al test, alla modifica o all'apertura).
2. «Rileva automaticamente» con LM Studio su 1235: lo trova subito.
3. Ollama spento → apri le impostazioni: nessun allarme; pillola nel pannello
   «motore spento» con l'indicazione della porta giusta.
4. Taglia la porta a caso e premi «Test connessione»: appare la scansione e
   la correzione (o la guida se non c'è nessun server).

### Repository GitHub e test memoria residua (24/11/2026, stesso giorno)

**Repository**: il codice sorgente completo (estensione + script + icone) è ora
versionato su GitHub (`chiacchiosalvatore-hub/MindFlow`): README, ROADMAP,
`.gitignore`, `mindflow-extension/` (19 file + 4 icone PNG) e `scripts/`
(22 test/utility) — allineamento verificato byte per byte con gli SHA git.

**Nuovo test**: `scripts/test-memoria-residua.js` — **24 pass** — chiude la
voce 3 della roadmap (memoria residua nelle conversazioni lunghe) con il
pannello REALE caricato in jsdom e uno storage finto che ricorda come
chrome.storage.local. Copre i cinque scenari: (A) conversazione lunga a 6
poll / 12 messaggi — una sola sessione, nessun nodo fantasma; (B) chiusura e
riapertura a metà conversazione — il grafo (root + 3 checkpoint) torna
identico, il nuovo poll non duplica nulla, e «Compila» copre SOLO i messaggi
dopo l'ultimo checkpoint (8 di 14: il primo messaggio, già compresso, non
riappare); (C) cambio scheda/convKey — il payload non si trascina nella nuova
chat e le due sessioni restano separate e integre al ritorno; (D) cambio
endpoint/modello via `storage.onChanged` — la verifica motore riparte verso
il nuovo endpoint e la memoria di sessione resta identica byte per byte;
(E) reset con doppio clic — sessione ridotta alla radice, NESSUN titolo/id
vecchio nello storage, l'altra chat non toccata, e i messaggi nuovi non
riportano in vita lo storico. Suite completa verde dopo l'aggiunta.

## Versione precedente: v1.2.1 «LM Studio riconosciuto al volo»

Segnalazione utente del 21/11 dopo le prove della v1.2.0 («siamo al 99% per
MVP»): il cambio provider a **LM Studio con qwen3.5 9b abliterated** non
funzionava — «riconosceva endpoint sembra ma non motore e la chiamata
falliva» anche con LM Studio acceso e modello caricato. CONFIRMATO il 24/11
dall'utente: la parte nome/CORS/thinking della v1.2.1 era GIUSTA («ok ha
funzionato»); la causa residua era la porta (1235 vs 1234), chiusa dalla
v1.2.2. CAUSE trovate nel codice: tre difese che per Ollama esistevano già
e per i server OpenAI-compatibili no (tutte e tre le cure sono gemelle di
quelle storiche).

1. **NOME modello (la causa principale)**: LM Studio identifica i modelli con
   CHIAVI LUNGHE e con maiuscole («lmstudio-community/Qwen3.5-9B-abliterated-
   GGUF»), non col nome breve scritto a mano. L'auto-riparazione del nome
   esisteva SOLO per Ollama (`used.kind === "ollama"`) e il pannello
   confrontava il nome alla lettera (indexOf): per LM Studio ogni chiamata
   moriva con «model not found» e la pillola restava su «modello assente».
   ORA: `normalizeModelKey` + `fuzzyFindModel` (chiave normale: ultimo tratto
   dopo «/», tag Ollama e suffissi -gguf/-fim via, separatori e maiuscole
   unificati — «qwen3.5 9b abliterated» ≡ «lmstudio-community/Qwen3.5-9B-
   abliterated-GGUF») e auto-riparazione estesa a openai-compat in summarize,
   planChapters ed engine-test (client diretto E mirror del service worker);
   nelle impostazioni il campo modello si corregge/compila DA SOLO dopo il
   test (anche quando era vuoto).
2. **CORS di LM Studio (il gemello del 403 di Ollama)**: il server OpenAI-compat
   con CORS spento accetta il GET /v1/models (endpoint «riconosciuto») ma
   risponde 403 al POST dell'estensione: test OK, riassunti tutti KO. ORA:
   sonda `compatOriginProbe` nel test di connessione (stesso trucco della
   sonda Ollama: POST leggero con modello inesistente — 403 = CORS spento,
   400/404 = richiesta che passa), errore `isCompatBlocked` con la cura
   precisa (LM Studio → Developer → **Enable CORS**), pillola nel pannello
   «LM Studio blocca l'estensione» cliccabile, e stesso riconoscimento nel
   flusso «Costruisci il grafo» (dichiarato SUBITO, prima di sprecare la mappa).
3. **Modelli «thinking» (Qwen3 e simili)**: il tetto di token poteva finire
   tutto nel ragionamento (reasoning_content) lasciando il contenuto finale
   VUOTO («Risposta del motore priva di contenuto»). ORA: se il ragionamento
   esiste lo si legge come risorsa di riserva (il JSON finisce spesso lì),
   diagnosi esplicita quando i token finiscono nel pensiero, e 2° tentativo
   con tetto di token più alto sui motori OpenAI-compat (900 compressione /
   1300 mappa contro 420/600).

Test: `test-engine-client.js` esteso con un «LM Studio» finto su /v1 (chiavi
lunghe, 400 model-not-found, 403 CORS, thinking): **20 pass** (12 precedenti +
8 nuove). Regressione completa verde: build-flow 9, planner 13,
parallel-pipeline 13, panel-boot 8, integration 4, job-flow 21, net-capture 30,
adapters-dom 71, graph-layout 13, autodetect, ollama-403, toc-minimale.
Build: `download/mindflow-extension-v1.2.1.zip` + variante Firefox.

### Prove pratiche della v1.2.1 (checklist utente — LM Studio)

1. Apri LM Studio, carica il modello e AVVIA il server con **Enable CORS**
   attivo (Developer → impostazioni del server): è il nuovo «Sblocca Ollama»
   di LM Studio, una volta sola.
2. Impostazioni → tipo «OpenAI-compatibile locale» → «Rileva automaticamente»
   o «Test connessione»: il campo modello si riempie/corregge da solo con la
   chiave lunga vera (si può anche scrivere «qwen3.5 9b abliterated» a mano).
3. «Prova riassunto»: deve uscire «RIASSUNTO OK dal modello».
4. In chat: «Costruisci il grafo» con LM Studio come motore — capitoli e
   checkpoint arrivano come con Ollama (il primo caricamento del modello è
   lento come sempre sui motori locali).
5. Se qualcosa non passa, la riga di stato dice la causa VERA (403 CORS con la
   cura, nome riparato, thinking esaurito) invece dell'errore generico.

## Versione precedente: v1.2.0 «Grafo compatto, resa efficiente»

Ultimo fronte tecnico della roadmap: la resa grafica del grafo «in maniera
efficiente» (richiesta utente). Base di partenza: v1.1.4 confermata dall'utente
(«varie prove ok, siamo vicini»). Due interventi mirati in `panel.js`, zero
ristrutturazione:

1. **SCALETTA a due colonne per le catene lunghe**: il grafo di una chat letta
   per intero (root → capitolo 1 → … → capitolo N, nessun bivio) era una colonna
   verticale infinita — 20 capitoli = 20 righe da 84 px = 1.680 px da scorrere,
   con quasi tutta la larghezza del pannello sprecata. Ora i nodi scendono a
   scaletta su due colonne alterne (passo 52 px, corridoio 36 px): la stessa
   catena occupa ~metà altezza (una chat di 8 capitoli sta VISIBILE per intero
   senza scroll) e gli archi tra le due colonne diventano curve a S morbide.
   Con UNA sola forcazione (bivi veri dei checkpoint ri-agganciati) si resta sul
   layout ad albero classico, identico a prima: zero rischi di sovrapposizioni
   tra i rami.
2. **FIRMA anti-rebuild**: il poll della chat (`mindflow:messages`, ogni ~2,5 s)
   chiama `renderAll` di continuo e il vecchio `renderGraph` ricostruiva TUTTO
   l'SVG a ogni giro (con 20 capitoli: centinaia di elementi ricreati ogni 2,5 s,
   CPU consumata anche da fermo). Ora il grafo ha una firma (nodi + titoli +
   intervalli capitoli + attivo + selezione): se nulla è cambiato, il rebuild si
   salta del tutto; al primo cambiamento (nuovo checkpoint, selezione, titoli)
   si ridisegna come sempre, con animazioni d'ingresso solo per i nuovi.

Verifica visiva: screenshot Playwright del pannello demo con catena di 9 nodi
+ controllo VLM (scaletta corretta, curve a S, nessuna sovrapposizione, 9 nodi
visibili per intero, pannello integro) — riproducibile con
`scripts/shot_panel_graph.py`.

Test: suite completa verde, incluso il NUOVO `test-graph-layout.js` (13 pass:
posizioni scaletta, altezza dimezzata 424↔606, firma identity sui poll, click →
ridisegno, bivio → layout classico). Totale: graph-layout 13, panel-boot 8,
parallel-pipeline 13, build-flow 9, engine-client 12, planner 13, integration 4,
job-flow 21, net-capture 30, adapters-dom 71, autodetect, ollama-403.
Build: `download/mindflow-extension-v1.2.0.zip` + variante Firefox
(+ `mindflow-grafo-v1.2.0.png`, anteprima della nuova resa).

### Prove pratiche della v1.2.0 (checklist utente)

1. **Chat lunga (10+ capitoli)** su ChatGPT/Claude/Gemini: il grafo deve scendere
   a scaletta su due colonne e stare VISIBILE per intero senza scroll; con una
   chat corta resta compatto come sempre.
2. **«Aggiorna grafo»** dopo nuove risposte: i nuovi capitoli entrano nella
   scaletta al posto giusto, gli archi vecchi non si ri-animano.
3. **Pannello fermo su chat aperta**: dopo qualche minuto il pannello deve restare
   leggero (nessun ri-disegno continuo del grafo a ogni poll).
4. **Bivio** (imposta un checkpoint precedente come attivo, poi aggiorna): il
   layout torna ad albero classico per quel grafo, con i due rami affiancati.

## Versione precedente: v1.1.4 «Nessun tasto senza via d'uscita»

Bug segnalato dall'utente il 18/11 dopo la v1.1.3: «se clicchi sugli altri tasti vicino
ad Aggiorna grafo poi non si torna più indietro e rimane bloccata l'interfaccia sotto».
Causa TROVATA: il tasto «Annulla» del dialogo di import impostava solo il flag di
cancellazione ma NON chiudeva il dialogo, che restava aperto a coprire il pannello
(l'interfaccia sotto sembrava congelata e l'unica uscita era la piccola X). In più:

1. **«Annulla» ora torna SEMPRE indietro**: il dialogo si chiude sempre; se una raccolta
   sta girando viene fermata DAVVERO (nuovo messaggio `mindflow:collect-cancel` verso il
   content script → lo scorrimento si ferma al giro successivo) e il risultato parziale
   che arriva dopo NON avvia più la pipeline fantasma (il gestore riconosce l'annullamento).
2. **Riga di stato con "pausa" di 3 secondi**: mentre la pipeline lavora, l'orologio dei
   secondi sovrascriveva ogni secondo QUALSIASI feedback (esiti di Compila/Copia/Inietta,
   errori) — i tasti sembravano morti. Ora un esito non-busy tiene la riga 3 s prima che
   l'orologio riprenda.
3. Flag di annullamento ripulito ai giusti confini: un nuovo avvio (raccolta o pipeline)
   ignora un annullamento precedente; nessun stato «bloccato» permanente.

Conferma utente del 21/11 dopo le prove: **«varie prove ok, siamo vicini»** — la v1.1.4
è il punto fermo da cui parte la v1.2.0. Test: suite completa verde (panel-boot 8,
parallel-pipeline 13, build-flow 9, adapters-dom 71, engine-client 12, net-capture 30,
job-flow 21, integration 4, planner 13); sintassi OK. Build v1.1.4 in `download/`
(sostituita dalla v1.2.0, che parte esattamente da questo codice).
Conferma utente del 21/11 anche sulla v1.2.0 («sento che ci siamo, varie prove ok,
siamo al 99% per MVP»): resta come base fissa da cui parte la v1.2.1 (stesso codice
più le difese LM Studio).

## Checkpoint stabile CONFERMATO: v1.1.3 «Diagnosi del modello muto»

Conferma utente del 18/11 dopo le prove sul Mac (modello su disco esterno mappato via
Ollama): **«risponde ollama e modello va molto meglio il riassunto e la raccolta sempre
un po' lenta ma comunque efficiente»** + «terrei questa versione punto fermo del nostro
progetto». La diagnosi dei metadati + il ping di controllo hanno chiuso il caso
«Risposta Ollama priva di contenuto» (nel terminale il modello rispondeva OK: era il
tag mancante nella cartella mappata che Ollama ri-scaricava — il mapping andrà
controllato se il problema torna). La v1.1.4 parte esattamente da questo codice.

### Cosa contiene la v1.1.3 (già registrato al momento del rilascio)

Obiettivo della versione (segnalazione utente del 18/11): la **Prova riassunto** (e i
checkpoint) falliva con «Risposta Ollama priva di contenuto» — Ollama risponde 200 OK
ma il modello non scrive nulla, due volte di fila, anche su un prompt cortissimo.
Contesto sospetto dichiarato dall'utente: **modelli spostati su disco esterno**, mappati
via Ollama.

1. **Diagnosi dai METADATI di Ollama**: ogni risposta di Ollama porta i contatori
   (`eval_count`, `load_duration`, `total_duration`, `done_reason`). Se il testo è vuoto
   il messaggio ora li legge e dice il VERO motivo: «0 token generati, modello caricato
   in X s» con la cura corrispondente (file modello corrotti/incompleti, disco esterno
   in riposo, ri-scaricare il modello) invece del generico «priva di contenuto».
2. **PING di controllo automatico**: se il riassunto fallisce 2 volte SENZA mai ricevere
   testo, MindFlow esegue da solo una chiamata da 12 token: ping OK → «riprova ORA (modello
   caldo)»; ping vuoto → «file modello o disco esterno»; ping senza risposta → «caricamento
   troppo lento».
3. **2° tentativo senza modalità JSON forzata**: se la `format:"json"` di Ollama produce
   vuoto, il retry parte in modalità libera (il parser tollerante legge comunque un JSON
   incorniciato).
4. Stesse difese nella **riserva service worker**.

## Versione precedente: v1.1.2 «Grafo veloce, nessun tasto bloccato»

Obiettivo della versione (richiesta utente del 18/11): risolvere la LENTEZZA di
rilevazione, creazione e riassunto del grafo e fare in modo che **nessun tasto
sembri bloccato**. (Build v1.1.2 sostituite in `download/` dalle successive, che
partono esattamente da questo codice.)

### Cosa è cambiato (solo velocità e risposta — zero ristrutturazione)

1. **Compressione dei capitoli in PARALLELO**: prima ogni capitolo aspettava il
   precedente solo per il suo titolo (`prevTitle`) — con 8-10 capitoli su un
   modello locale erano minuti di chiamate in fila. Ora il «checkpoint
   precedente» di ogni capitolo è il titolo che la MAPPA ha già dato al capitolo
   prima di lui (deterministico): i capitoli diventano indipendenti e partono
   **2 alla volta sui motori locali** (Ollama li parallelizza se può, altrimenti
   li accoda lui: mai peggio di prima) e **3 sulle API cloud**. I nodi entrano
   nel grafo IN ORDINE man mano che arrivano: catena, chapterIndex e contesto
   compilato restano identici a prima.
2. **Guardia unica anti-doppio-lancio** (il vero «collo di bottiglia» di
   Aggiorna grafo): prima, durante verifica motore + mappa dei capitoli, NESSUN
   flag era attivo e un secondo clic avviava una pipeline gemella che
   RADDOPPIAVA il carico su Ollama. Ora la pipeline si dichiara occupata dal
   primo istante (con `finally` che garantisce il rilascio su ogni uscita) e
   ogni clic extra riceve un messaggio visibile («Pipeline già in corso…»),
   mai il silenzio. Stessa guardia sulla raccolta della pagina.
3. **Orologio dei secondi sempre visibile**: il percorso «Aggiorna grafo»
   (senza dialog) ora mostra sulla riga di stato i secondi che crescono e il
   conteggio dei capitoli pronti — il pannello non sembra più congelato.
4. **Finestra di contesto (`num_ctx`) ADATTIVA** alla lunghezza reale del testo
   (prima fissa 8192/12288): una coda corta di aggiornamento non paga più
   l'allocazione massima — su GPU da 8 GB questo era ciò che spingeva qwen 7b
   fuori dalla memoria e rallentava TUTTO. Stima prudente (1 token ≈ 2,5
   caratteri) + margine per system e output, blocchi di 512, tetti invariati.
5. **Raccolta della pagina più svelta**: scorrimento a 300 ms per finestra
   (prima 380) e passo all'85% del viewport (prima 80%) — circa un quarto di
   tempo in meno sulle chat lunghe, margine anti-taglio ampio come prima.

### Test automatici superati (v1.1.2, `scripts/`)

| Test | Copertura | Esito |
| --- | --- | --- |
| `test-parallel-pipeline.js` (13 asserzioni) | P1 parallelismo reale (4 compressioni da 500 ms in ~1059 ms, picco concorrenza 2) · P2 catena dai titoli della mappa · P3 anti-doppio-lancio con messaggio · P4 fallimento a metà catena (il capitolo 1 resta, nessun nodo dopo il buco) · P5 orologio senza dialog + aggancio alla catena esistente · P6 num_ctx adattivo | 13 pass, 0 fail |
| `test-build-flow.js` | Pipeline end-to-end col rilevamento planner | 9 pass, 0 fail |
| `test-engine-client.js` (12 pass con le asserzioni risposta vuota) | Client motore diretto, errori veri, auto-riparazione, diagnosi modello muto | 12 pass, 0 fail |
| `test-planner.js` | Mappa, normalizzazione, num_ctx adattivo, multi-motore | 13 pass, 0 fail |
| `test-panel-boot.js` | Avvio pannello senza service worker | 8 pass, 0 fail |
| `test-adapters-dom.js` | Selettori DOM dei chatbot | 71 pass, 0 fail |
| `test-integration.js`, `test-job-flow.js`, `test-autodetect.js`, `test-net-capture.js`, `test-ollama-403.js` | Regressione completa | tutti verdi |

## Stato congelato precedente: v1.1.1 «ChatGPT legge anche le risposte»

Versione dichiarata STABILE il 16/11/2026. La v1.1.2 parte da questa base
senza toccare prompt, modello dati, storage, service worker, selettori.

### Cosa contiene la v1.1.1

- **Fix ChatGPT con due difese indipendenti** (le risposte dell'assistente tornano nel
  grafo):
  1. la cattura dello stream di rete si inietta anche via `chrome.scripting`
     (world MAIN) — supera i blocchi CSP di chatgpt.com;
  2. nuova rete DOM «prose-between-users»: ricostruisce le risposte dai paragrafi
     tra una domanda e la successiva, anche se OpenAI rinnova il markup.
- **Risparmio token visibile** (pulsante «Compila»): confronto diretto del tipo
  «Contesto compilato: X token (chat intera: Y) — porti in una nuova chat circa il
  Z% del testo» + azioni **Copia / Inietta** per portare la memoria compatta in
  ChatGPT, Claude o Gemini invece di incollare l'intera conversazione.
- (dalla v1.1.0) **Modalità PAGINA su qualsiasi sito**: estrattore tipo reader,
  titoli h2/h3 come confini di sezione, stessa pipeline a capitoli delle chat.
- **Compressione robusta**: ~12.000 caratteri per segmento, `num_ctx` esplicito,
  output corto (titolo ≤ 6 parole, riassunto ≤ 50 parole, 0-3 punti chiave),
  progress con secondi trascorsi.
- **Pesi corretti nel trascritto della mappa**: risposte e sezioni fino a 1600
  caratteri, domande 450.

## Test superati (prove pratiche dell'utente su pagine reali)

| Area | Prova | Esito |
| --- | --- | --- |
| Chat | **Claude (claude.ai)** | OK — 18/11/2026: «ho provato Claude e gemini e legge tutto» |
| Chat | **Gemini (gemini.google.com)** | OK — 18/11/2026: come sopra |
| Chat | ChatGPT: domande + risposte | OK — bug «legge solo il mio messaggio» risolto nella v1.1.1 |
| Pagine arbitrarie | Wikipedia, pagina lunga a caso (Okinawa) | OK — «bella analisi con tutta la pagina, buon testo e punto fermo» |
| Pagine arbitrarie | Google (AI mode) | OK — «riassunto delle informazioni ottimo» |
| Motore locale | qwen 7b via Ollama (model-agnostic) | OK — mappa più affidabile che con gemma |
| Motore locale | v1.1.3 su Mac con modelli su disco esterno | OK — «risponde ollama e modello va molto meglio il riassunto» (18/11) |
| Interfaccia | v1.1.4: tasti vicini ad «Aggiorna grafo», dialogo Import/Annulla | OK — «varie prove ok, siamo vicini» (21/11) |
| Grafo | v1.2.0: scaletta due colonne, anti-rebuild | OK — «varie prove va bene… siamo al 99% per MVP» (21/11) |
| Motore locale | **LM Studio + qwen3.5 9b abliterated** | OK v1.2.1/1.2.2 — «ok ha funzionato» (24/11); il residuo era la porta 1235, ora auto-corretta |
| Motore locale | **Ollama: riassunto + esposizione/mappa** | OK — «per ollama funziona bene anche riassunto ed esposizione… map al 100%» (24/11) |
| Pipeline | Raccolta → mappa → compressione in un click | OK |
| Sintesi | Checkpoint a capitoli brevi | OK su Wikipedia; da riverificare su chat lunghe |

## Prossimi passi (roadmap aggiornata al 24/11)

1. **MVP COMPLETO dal punto di vista tecnico**: tutte le voci della roadmap
   sono coperte e provate dall'utente (chat, pagine, Ollama, LM Studio, mappa,
   riassunto, esposizione, nessun tasto bloccato). Restano i punti 4–5 della
   lista utente (risparmio token: già visibile col tasto «Compila»;
   aggiornamento roadmap/roadmap doc: fatto nel CHECKPOINT).
2. **Piano di deploy e visibilità** (consegnato): pubblicazione Chrome Web
   Store / Edge / Firefox AMO, canali comunitari (r/LocalLLaMA, HN, Product
   Hunt), posizionamento privacy-first/local-first, opzioni freeware /
   open-source / Pro a pagamento — documento dedicato in `download/`.
3. Eventuali prove residue su chat lunghissime (sintesi a capitoli brevi)
   e sulla mappatura OLLAMA_MODELS su disco esterno, se il problema torna.

## Criterio MVP da produzione

- Le tre chat (ChatGPT, Gemini, Claude) + pagine web generiche funzionano in modo
  affidabile, senza interventi manuali extra.
- Checkpoint brevi e riusabili; contesto compilato nettamente più leggero della
  chat intera (confronto token visibile nel pannello).
- Percorso unico: apri la pagina → «Costruisci il grafo» → «Compila» → Copia/Inietta.
- Tempi accettabili: grafo completo su una conversazione lunga in tempi umani,
  mai pannello «bloccato» senza feedback.

## Rischi noti (mitigazioni già in codice o da tenere a mente)

- I siti cambiano markup → adapter con più selettori di riserva + cattura di rete
  indipendente dal markup (net-capture.js).
- Service worker MV3 si addormenta → lavoro come «job» con ripresa automatica
  (v0.9.1/0.9.2).
- Ollama blocca le richieste delle estensioni (403) → sonda di diagnosi + guida
  «Sblocca Ollama» (v0.9.3).
- Modelli locali freddi = attese lunghe → num_ctx adattivo (v1.1.2), output
  corto, compressioni parallele, progress con secondi trascorsi.
- Scorrimento più svelto (v1.1.2) → se un sito virtualizzato "mangia" messaggi,
  riportare 380 ms in content.js (`collectAll`) — intervento di una riga.
