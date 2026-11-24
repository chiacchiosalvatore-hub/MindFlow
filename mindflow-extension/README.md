# MindFlow Companion

Il grafo di memoria dei tuoi contenuti — **discretamente accanto a ChatGPT, Claude, Gemini e alla Chat GLM di MindFlow, e su QUALSIASI pagina web di testo** (voci wiki, articoli, documentazione), su Chrome, Edge, Brave, Arc, Firefox **e Safari (Mac)**.

MindFlow Companion legge la conversazione (o la pagina) e la comprime in **checkpoint semantici**
su un grafo interattivo e compila il **contesto minimo indispensabile** (catena di checkpoint +
solo i messaggi vivi dell'ultimo ramo) per aggirare l'esplosione di token delle chat lunghe.

Nessuna finestra di chat in più: il companion vive **accanto** alla pagina che stai già usando.

📖 **Guida completa passo-passo: [`INSTALLAZIONE.md`](INSTALLAZIONE.md)**

## Novità della v1.2.0 — «Grafo compatto, resa efficiente»

La resa grafica del grafo, ultimo fronte della roadmap:

1. **Scaletta a due colonne per le chat lunghe.** Il grafo di una conversazione
   letta per intero era una colonna verticale infinita: 20 capitoli = 20 righe
   da 84 px = 1.680 px da scorrere, con quasi tutta la larghezza del pannello
   sprecata. Ora i nodi scendono a **scaletta su due colonne alterne** (passo
   52 px, corridoio 36 px): la stessa catena occupa circa metà altezza — una
   chat di 8 capitoli sta visibile per intero senza toccare lo scroll — e gli
   archi tra le colonne diventano curve a S morbide. Se il grafo ha un bivio
   vero (checkpoint ri-agganciato), il layout resta l'albero classico di prima:
   zero rischi di sovrapposizioni tra i rami.
2. **Il pannello non ridisegna più il grafo a ogni poll.** Il content script
   consegna i messaggi ogni ~2,5 s e ogni consegna ricostruiva TUTTO l'SVG da
   zero: con 20 capitoli erano centinaia di elementi ricreati di continuo, CPU
   consumata anche da fermo. Ora il grafo ha una firma (nodi, titoli, capitoli,
   attivo, selezione): se nulla è cambiato il rebuild si salta del tutto; al
   primo cambiamento si ridisegna come sempre, con le animazioni d'ingresso
   solo per i nodi nuovi.

Verifica: nuovo test automatico `test-graph-layout.js` (13 asserzioni:
posizioni della scaletta, altezza dimezzata, firma anti-rebuild, click →
ridisegno, bivio → albero classico) + screenshot del pannello demo con catena
di 9 nodi validato visivamente.

## Novità della v1.1.0 — «Legge qualsiasi pagina, e le risposte prima di tutto»

Le tre correzioni uscite dalle prove pratiche (Wikipedia, Google, ChatGPT):

1. **Qualsiasi pagina web, non solo le chat.** Prima il content script esisteva SOLO su
   chatgpt/claude/gemini/localhost: su Wikipedia e Google non partiva proprio nulla.
   Ora il companion è attivo su ogni sito http/https: su un host non-chat entra in
   **modalità PAGINA** — un estrattore tipo reader individua il contenuto principale,
   scarta nav/footer/annunci/riferimenti e usa i titoli h2/h3 come confini di sezione
   (su Wikipedia sono già i capitoli). Le sezioni entrano nella STESSA pipeline dei
   capitoli: mappa del motore + checkpoint brevi. Su pagine quasi senza testo (es. la
   home di un motore di ricerca) il resoconto lo dice chiaro, senza grafi fantasma.
2. **Le RISPOSTE valgono più delle domande.** Nel trascritto della mappa i pesi erano
   INVERTITI (domande fino a 1200 caratteri, risposte accorciate a 380): il grafo
   nasceva dalle tue domande. Ora le risposte dell'assistente e le sezioni del documento
   ricevono fino a 1600 caratteri, le domande 450; i prompt di mappa e compressione
   danno priorità esplicita a ciò che viene spiegato/consegnato.
3. **Riassunto più veloce e checkpoint compatti.** La compressione inviava fino a
   60.000 caratteri per capitolo SENZA finestra di contesto esplicita: Ollama troncava
   in silenzio e sembrava bloccato. Ora: ~12.000 caratteri per segmento, `num_ctx`
   esplicito (8192 per la compressione, 12288 per la mappa), output corto (titolo ≤6
   parole, riassunto ≤50 parole, 0-3 punti chiave). E il log del progress mostra i
   **secondi trascorsi**: il pannello non sembra mai più «bloccato» mentre il modello
   locale pensa.

Nota permessi: per leggere qualsiasi pagina, Chrome chiede l'accesso «Legge i dati di
tutti i siti web» — è esattamente ciò che serve alla modalità PAGINA (la lettura resta
locale: nessun dato lascia il tuo computer, tranne i testi inviati al motore che tu
stesso hai configurato).

## Novità della v1.0.0 — «Il grafo in un click»

Una sola funzione, fatta bene, al posto delle mille. Premendo
**«Costruisci il grafo»** (il pulsante unico, che diventa «Aggiorna grafo» quando il
grafo esiste già) parte SEMPRE la stessa pipeline, per qualsiasi origine — pagina
collegata, testo incollato, file importato, coda della chat:

1. **Raccolta vera, al click.** Se la cattura passiva ha visto poco (es. solo la prima
   frase), il pulsante fa la raccolta completa con lo scorrimento della pagina e mostra il
   RESOCONTO («Raccolti 48 messaggi: 21 tuoi, 27 dell'assistente») prima di spendere il
   motore. Se la cattura ha preso poco, si vede subito e si può cambiare origine.
2. **Mappa dei capitoli (la rivoluzione).** Non si taglia più la conversazione a forbice
   (1400/3600 caratteri: era la causa dei «checkpoint a caso poco leggibili»): è il MOTORE
   (Ollama, LM Studio, OpenAI, Anthropic — qualsiasi modello) a leggere la conversazione e
   dividerla in **capitoli semantici**. Trascritto ridotto + `num_ctx` esplicito per stare
   nei limiti di contesto anche con chat lunghe e modelli piccoli.
3. **Compressione per capitolo.** Ogni checkpoint nasce sapendo DOVE sta nella storia
   («capitolo 3 di 7»): titoli coerenti, nessuna ripetizione, una catena leggibile come un
   indice di libro.

In più: chip del capitolo e intervallo messaggi su ogni nodo del grafo, tooltip con il
sommario, dettagli arricchiti («Vai al messaggio» di apertura del capitolo), rimozione
dell'auto-checkpoint e dell'auto-apertura del pannello (tu resti al comando), riserva
DICHIARATA a capitoli per scambio se un modello non sa mappare (il contenuto resta
sempre generato dal motore, mai finto).

## Novità della v0.9.3 — l'«Errore 403 dal motore» ha finalmente un nome e una cura

Con la v0.9.2 il canale pannello→motore era finalmente a posto: la connessione
risultava OK, ma ogni riassunto moriva con «Errore 403 dal motore» (e
l'importazione si fermava a «Catena interrotta al segmento 1/1»). Non era un bug
dell'estensione: **è Ollama che, per sicurezza, rifiuta le richieste provenienti
da un'estensione** — accetta dal browser solo le pagine su `localhost`. Il test
di connessione passava perché è un GET «semplice»; il riassunto è un POST con
JSON, che porta l'origine `chrome-extension://…`: 403, risposta senza dettagli.

- **Diagnosi automatica.** Ogni verifica del motore (pannello, impostazioni,
  popup) ora include una micro-sonda POST verso `/api/chat` con un nome modello
  inesistente: se Ollama è chiuso alle estensioni risponde subito 403 — senza
  caricare nulla. Lo stato passa PRIMA che tu tenti un checkpoint.
- **Pillola «Ollama blocca l'estensione»** nel pannello: cliccabile, apre le
  impostazioni sulla guida giusta. Niente più falsi «motore spento».
- **Guida «Sblocca Ollama» nelle impostazioni** (compare da sola quando serve):
  i tre passi esatti per Windows, macOS e Linux — variabile d'ambiente
  `OLLAMA_ORIGINS` = `chrome-extension://*,moz-extension://*,safari-web-extension://*`
  (copiabile con un clic) + riavvio COMPLETO di Ollama. Una volta sola, vale
  per Chrome, Edge, Firefox e Safari.
- **«Crea il grafo» non parte più per fallire:** se Ollama è bloccato, la catena
  lo dichiara subito con la cura, invece di morire al segmento 1 con un 403
  criptico.
- **Niente doppio punto e messaggi puliti** («Errore 403 dal motore..» →
  messaggio unico e sensato).

## Novità della v0.9.2 — il pannello parla DIRETTAMENTE col motore

La v0.9.1 aveva spostato il riassunto nei «lavori» del service worker, ma sul
campo il difetto è risultato più profondo: **finché il riassunto passava dal
service worker, Chrome poteva spegnerlo a metà** (i worker MV3 vivono ~30 s di
quiete) e il pannello interpretava quel silenzio come «estensione aggiornata →
ricarica la pagina». Nasceva il loop: avviso → ricarichi → sembra ok → il
riassunto successivo uccide il worker → l'avviso torna. La v0.9.2 elimina la
causa, non il sintomo.

- **`engine-client.js`: un solo client del motore, in fetch DIRETTO.** Il
  pannello (pagina dell'estensione incorporata nella chat) ha gli stessi
  `host_permissions` delle impostazioni e del popup: riassunto e verifica del
  motore ora partono dal pannello stesso. Il fetch vive con il pannello aperto
  — esattamente quanto serve — quindi «Riassunto NON riuscito: service worker
  non raggiungibile» e i checkpoint lasciati in pausa non esistono più come
  classe d'errore del percorso principale.
- **Il banner «ricarica la pagina» non può più tornare da solo.** Nasce SOLO
  dal contesto estensione invalidato VERO (estensione aggiornata con la chat
  aperta): il vecchio ping-3-volte e il test-motore-fallito non lo triggerano
  più. Dopo il ricaricamento un contesto fresco non può invalidarsi da solo.
- **Launcher che guarisce da solo:** se aggiorni l'estensione con la pagina
  aperta, la pillola MindFlow mostra un puntino rosso pulsante e UN CLIC
  ricarica la pagina (prima l'avviso viveva solo nel pannello, che però era
  già morto insieme al contesto).
- **Il service worker resta come RISERVA, e ora auto-riprende.** Se il fetch
  diretto del pannello fosse bloccato, il lavoro gira nel worker con i
  parametri PERSISTITI in `storage.session`: un worker spento a metà lo
  RIATTIVA da solo al riavvio (massimo 2 riavvii, poi l'errore vero).
- **«Prova riassunto» diretto-first:** prima il collegamento DIRETTO (lo
  stesso che userà il pannello), poi il worker solo come riserva; gli errori
  di modello/JSON restano la verità del motore, senza ritentativi inutili.
- **Auto-correzione del modello ovunque:** «gemma3» → «gemma3:latest» si
  sistema da solo anche via client diretto e l'etichetta in alto mostra il
  modello VERO letto dal motore.

## Novità della v0.9.1 — il lavoro di riassunto non tiene più occupato il canale

- **Il riassunto ora gira come LAVORO, non come risposta sospesa.** Prima il pannello e le
  impostazioni aspettavano minuti su UNA chiamata al service worker: con il modello a freddo
  (es. gemma3 che si carica in RAM alla prima richiesta) Chrome spegneva il service worker a
  metà lavoro, il canale dei messaggi si chiudeva e l'utente vedeva
  «Riassunto NON riuscito: service worker non raggiungibile». Ora `mindflow:summarize` risponde
  IMMEDIATAMENTE con l'id del lavoro, il riassunto gira in background e il pannello legge lo
  stato ogni 2 s (`mindflow:job-status`). Un lavoro tenuto vivo da un keep-alive interno non
  muore più durante il caricamento del modello, nemmeno se dura minuti.
- **Il banner «MindFlow è stato aggiornato» esce SOLO quando è vero.** Gli errori «message port
  closed» e «Receiving end does not exist» — che arrivano anche quando il worker è solo lento o
  riavviato — NON provano più un aggiornamento: non mostrano più il banner che restava fisso e
  che il ricaricamento non risolveva, perché il riassunto successivo ripresentava l'errore.
  Il banner resta per il solo contesto davvero invalidato, e un riuscito successivo lo nasconde da solo.
- **Niente più attese mute:** durante il primo caricamento del modello il pannello dice
  «ancora in attesa del motore (pazienta)…» invece di sembrare bloccato.
- **«Prova riassunto» nelle impostazioni dice LA VERITÀ:** se il service worker non risponde,
  la pagina fa una verifica DIRETTA del motore (senza passare dal worker) e separa i due casi:
  motore spento (`ollama serve`) o service worker da ricaricare (`chrome://extensions` ⟳).
- Se il service worker viene riavviato a metà riassunto, lo stato del lavoro sopravvive in
  `storage.session`: il pannello riceve «lavoro interrotto: riprova» invece di restare in attesa
  per sempre.

## Novità della v0.9.0 — addio "euristico", cattura che sopravvive a tutto

- **La modalità "euristico" è STATA RIMOSSA, come richiesto.** Non esiste più: né
  etichette "euristico" sui nodi, né chip, né strisce ambra, né avvisi "fallback estrattivo".
  Il grafo ora contiene SOLO checkpoint reali prodotti dal motore configurato (es. Ollama
  con gemma3). Se il motore non risponde, il checkpoint **non viene creato** e la riga di
  stato dice il motivo vero ("motore spento: avvia `ollama serve` e riprova") — niente più
  incoerenza tra avvisi e comportamento.
- **Nuova strategia di cattura primaria "turn-slots" per ChatGPT.** Legge la conversazione
  per CONTENITORE di turno (article, `[data-turn-key]`, sezioni `conversation-turn`)
  estraendo gli slot interni: bolla utente e prosa assistente separati. Se il sito rinomina
  TUTTE le classi e gli attributi noti, la riserva ASSOLUTA entra in gioco: il testo di una
  risposta è fatto di paragrafi, e i paragrafi li leggiamo a prescindere dal wrapper.
  Testato contro 5 forme di DOM (attuale, legacy, rinnovo totale, classi rinominate,
  contenitori annidati) — 52 test automatici tutti verdi.
- **Banner "MindFlow è stato aggiornato" con bottone "Ricarica la pagina"** che ricarica
  davvero la scheda (funziona anche con il pannello orfano di una versione precedente),
  e un secondo ping prima di dichiarare il contesto rotto: niente più falso banner per un
  service worker semplicemente lento a svegliarsi.
- **Pannello mai più bloccato.** La raccolta della pagina consegna il risultato anche se
  un errore interrompe lo scorrimento, con una rete di sicurezza a 60 s sulla barra di
  avanzamento; la costruzione del grafo verifica il motore PRIMA di partire e si interrompe
  con un messaggio chiaro al primo errore — i checkpoint già creati restano.
- **Auto-checkpoint reale.** Superata la soglia di risposte (impostazioni, default 4) il
  checkpoint nasce da solo, ma SOLO con il motore collegato e verificato: il grafo cresce
  da solo quando tutto funziona, e si ferma con un messaggio quando qualcosa non va.
- Verifica sorgente dei messaggi nel pannello (solo il content script ospite può inviare
  dati) e messaggio motore passo-through (l'errore vero del motore arriva all'utente senza
  riscritture).

## Novità della v0.8.0 — fine del "solo la prima frase" su ChatGPT reale

- **Cattura a livello di SLOT sul DOM ChatGPT 2025/2026.** Nelle varianti attuali ogni
  scambio è un contenitore (`[data-turn-key]` / sezione `conversation-turn`) che contiene
  DENTRO la bolla utente E la risposta: la versione precedente collassava l'intero scambio
  in un solo messaggio "user" e sopprimeva gli elementi interni — ecco perché arrivava solo
  la prima frase. Ora i contenitori non sono mai messaggi: si leggono gli slot interni
  (bolla utente, blocco risposta, holder `data-message-author-role`, unità di ricerca
  `…:user`/`…:assistant`) con doppioni fusi per prefisso.
- **Chat ANONIMA di ChatGPT (senza login) finalmente coperta.** Lo stream viaggia su
  `/backend-anon/f/conversation` (l'autenticata usa `/backend-api/…`): la cattura di rete ora
  intercetta entrambe, e le URL `/uc/<id>` delle chat anonime sono riconosciute.
- **Testo pulito senza pulsanti.** Il testo estratto cammina il DOM e butta Copia/Mostra
  altro/valutazioni, conservando i paragrafi e la parte "chiusa" dai messaggi lunghi.
- **Motore sempre sincronizzato.** Il test di connessione corregge da solo il nome del
  modello assente (es. `gemma3` → `gemma3:latest`), il riassunto riprova fino a 3 volte su
  errori transitori, e il motivo di ogni checkpoint "euristico" è scritto VISIBILE nei
  dettagli del checkpoint, non solo nel tooltip.
- **Banner "ricarica la pagina".** Se l'estensione viene aggiornata/ricaricata mentre la
  pagina della chat resta aperta, il contesto si invalida e TUTTE le chiamate al motore
  falliscono (era il falso "non raggiungibile"): ora il pannello lo riconosce e mostra un
  banner ambrato con l'istruzione esatta (Cmd/Ctrl+R sulla pagina della chat).
- Etichette motore brevi e chiare: `Ollama · gemma3:latest` (verde), `modello assente`,
  `motore non raggiungibile`, `ricarica la pagina`.

## Novità della v0.7.1 — il protocollo nuovo di ChatGPT e il modello che si ripara da solo

- **Cattura del protocollo ChatGPT 2025/2026 a patch JSON.** ChatGPT ora streama micro-patch
  (`{"p":"/message/content/parts/0","o":"append","v":"…"}` + continuation `{"v":"…"}`): il
  vecchio parser vedeva SOLO l'eco del primo messaggio utente — la causa del difetto "prende
  solo la prima frase". Il nuovo parser ricostruisce le risposte complete dallo stream e
  continua a leggere anche la forma vecchia.
- **Doppio canale anche nella Chat GLM di prova** (stream `/api/mindflow/chat` + DOM) e reset
  della traccia di rete al cambio di conversazione: niente mescolanze tra chat diverse.
- **Ollama più affidabile.** `format: "json"` (output sempre interpretabile), timeout 240 s,
  `keep_alive` 15 min, e **auto-riparazione del modello**: se il MODELLO impostato non esiste
  nel motore (es. "gemma" invece di "gemma3:latest"), l'estensione sceglie da sola il modello
  installato più adatto, riprova e salva la correzione — il checkpoint esce dal modello, non
  dall'euristico.

- **Cattura del nuovo DOM 2026-10 (riserve conservate).** Riserva strutturale che attraversa
  gli shadow root aperti per le varianti con `[data-conversation-role]` /
  `[data-markdown-text-style]`; e i turni consecutivi dello stesso ruolo non vengono più
  fusi in un unico messaggio.

## Novità della v0.7.0 — cattura robusta, motore verificato, popup

- **Cattura su due canali.** Oltre al DOM, ora è attiva la **cattura di rete**: un modulo
  iniettato nella pagina (`net-capture.js`) legge gli stream SSE con cui ChatGPT e Claude
  consegnano i messaggi (utente E assistente, nel vero ordine). Anche se il sito cambia
  markup o virtualizza i turni, la conversazione viene catturata comunque. I due canali
  si fondono in un registro della sessione che non perde più le frasi successive alla prima.
- **Fine del mistero "euristico".** Il punto motore del pannello ora mostra lo stato REALE:
  verde = collegato e verificato con una chiamata vera, ambra = impostato ma non raggiungibile
  (o verifica in corso), rosso = modello mancante. Il pannello rilegge le impostazioni in
  tempo reale: se configuri Ollama nelle opzioni, il pannello aperto lo vede subito. La pagina
  opzioni avvisa esplicitamente se la connessione è OK ma **il campo modello è vuoto** (era
  la trappola più frequente) e aggiunge **«Prova riassunto»**, una verifica end-to-end che
  chiede al motore di comprimere un segmento d'esempio. Ollama con risposta 200+errore e
  output non-JSON vengono riconosciuti e (nel secondo caso) ritentati una volta.
- **Popup dalla barra strumenti.** Clic sull'icona dell'estensione = stato motore + stato
  della chat corrente + azioni rapide (Impostazioni, apri il grafo qui, raccogli la chat
  intera). La rotella ora è raggiungibile ovunque, anche a pannello chiuso.
- Chiave conversazione ChatGPT aggiornata agli URL `/u/<id>` (oltre a `/c/<id>`) e titolo
  generico della nuova UI riconosciuto; i turni consecutivi dello stesso ruolo non vengono
  più fusi in un unico messaggio.

## Provarla subito, senza account: la Chat GLM nell'anteprima

L'app MindFlow include una **chat GLM reale** (`/chat`, bottone “Chat GLM” nell'header):
installa l'estensione su Chrome, apri quella pagina e il badge diventa verde “Estensione
attiva”. Puoi testare l'intero flusso — lettura, checkpoint, grafo, compilazione e iniezione
del contesto — prima ancora di aprire ChatGPT/Claude/Gemini. Nessuna chiave richiesta.

## Installazione (Chrome / Edge / Brave / Arc — Manifest V3)

1. Scarica e decomprimi lo ZIP (oppure clona la cartella `mindflow-extension/`).
2. Apri `chrome://extensions`.
3. Attiva **Modalità sviluppatore** (interruttore in alto a destra).
4. **Carica estensione non pacchettizzata** → seleziona la cartella decompressa.
5. Fissa l'estensione nella barra e apri una chat (ChatGPT, Claude o Gemini):
   sul bordo destro compare una pillola verde discreta — cliccala per aprire il pannello.

## Installazione su Firefox

Stesso codice, manifest adattato (event page + id gecko): usa lo ZIP dedicato
`mindflow-extension-firefox-v0.8.0.zip`. Apri `about:debugging#/runtime/this-firefox` →
**Carica componente aggiuntivo temporaneo…** → scegli il `manifest.json` della cartella
decompressa. Dettagli e note sui permessi localhost in [`INSTALLAZIONE.md`](INSTALLAZIONE.md).

## Installazione su Safari (Mac)

Safari richiede che le estensioni siano incapsulate in un'app: lo strumento di Apple
(incluso in **Xcode**, gratuito) converte questa stessa cartella senza modifiche al codice.
Il codice dell'estensione usa solo API che Safari supporta (MV3 service worker, storage,
iframe del pannello — pienamente funzionanti da **Safari 16.4**).

```bash
xcrun safari-web-extension-packager /percorso/mindflow-extension \
  --app-name "MindFlow Companion" \
  --bundle-identifier com.mindflow.companion \
  --macos-only --no-open
```

(Con Xcode più vecchi: `safari-web-extension-converter`, stessi argomenti.)

Poi: apri il progetto generato → target macOS → Signing & Capabilities → Team
("Personal Team", Apple ID gratuito) → **⌘R** → abilita l'estensione in
**Safari → Impostazioni → Estensioni** e concedi l'accesso a chatgpt.com, claude.ai,
gemini.google.com e all'indirizzo dell'anteprima. Per l'uso personale **non serve**
l'account Apple Developer a pagamento. Se Xcode dà problemi, la guida contiene
una tabella di risoluzione (spazio disco, download .xip diretto, Command Line Tools).

Passi dettagliati (e risoluzione dei problemi) in [`INSTALLAZIONE.md`](INSTALLAZIONE.md).

## Configurare il motore (riassunti e checkpoint)

Pannello → ingranaggio (in alto a destra) → **Tipo di motore**:

| Motore | Endpoint | Chiave |
| --- | --- | --- |
| **Ollama** (consigliato per i compiti di servizio) | `http://127.0.0.1:11434` | — |
| **OpenAI-compatibile locale** (LM Studio, llama.cpp, vLLM) | `http://127.0.0.1:1234/v1` | opzionale |
| **OpenAI** | fisso | `sk-…` |
| **Anthropic** | fisso | `sk-ant-…` |

- Per i checkpoint basta un modello **piccolo e veloce** (3B–8B): `qwen2.5:7b-instruct`,
  `llama3.2:3b`, `gemma3` — gratuito e privato. **Il campo modello è obbligatorio**: senza
  modello i riassunti cadono sul fallback euristico anche con la connessione perfetta.
- Premi **Test connessione** (verifica l'endpoint) e poi **Prova riassunto** (verifica la
  catena completa fino al JSON): se la prova va bene, il punto motore del pannello diventa
  verde e i checkpoint usano il modello.
- Le chiavi API restano nel `chrome.storage` **locale** del tuo browser; non esiste alcun
  server MindFlow: le richieste partono dal tuo computer direttamente verso il motore.

> Perché l'estensione e non l'app web? I modelli locali (`localhost`) non sono raggiungibili
> da un'app ospitata nel cloud: l'estensione invece gira **sulla tua macchina** e parla con
> Ollama/LM Studio direttamente, senza tunnel né configurazione CORS.

## Come si usa

1. **Legge in silenzio su due canali** — il badge mostra i messaggi letti (DOM + stream di
   rete; nessun dato lascia il browser). Il popup della barra strumenti mostra la stessa
   informazione per la scheda corrente.
2. **Nuovo checkpoint** — comprime il segmento corrente in una memory node (titolo, sommario,
   decisioni). Il pulsante lampeggia quando le risposte crescono oltre la soglia che hai
   impostato: suggerisce, ma crea solo tu. Se un checkpoint nasce "euristico", i dettagli
   del nodo ti dicono **perché** (motore spento, JSON non valido…).
3. **Grafo** — ogni checkpoint è un nodo; se "imposti attivo" un nodo più vecchio e crei un
   checkpoint, nasce un **ramo**: la memoria si ramifica senza perdere il contesto.
4. **Compila contesto** — costruisce il payload: catena dei checkpoint ancestrali + solo i
   messaggi dopo l'ultimo checkpoint. Token stimati sempre visibili.
5. **Copia** o **Incolla nella chat** — il testo compilato finisce nel prompt del sito
   (ChatGPT/Claude/Gemini): rileggi, premi invio, e la chat "ricorda" senza 40k token di storia.
6. **Modalità Studio** (icona frecce) — il pannello si allarga a ~60%: la chat resta a
   sinistra, il grafo diventa la scena a destra con zoom (Ctrl/Cmd + rotella), pan a
   trascinamento, hover che accende i collegamenti e click che porta al messaggio origine
   nella chat (bagliore verde).
7. **Import di chat passate** (icona freccia in giù) — costruisci il grafo da una conversazione
   che esiste già: raccogliendo la pagina aperta con auto-scroll, incollando il testo
   (etichette "You said:"/"Utente:"/"**[UTENTE]**" riconosciute automaticamente) o caricando
   l'export JSON di ChatGPT. Progress visibile, annullabile, tutto in locale. I grafi
   importati restano nel menu **sessioni** (icona cubo), dove trovi anche i collegamenti
   rapidi per aprire ChatGPT/Claude/Gemini/Chat GLM.

## Architettura

```
pagina chat (ChatGPT / Claude / Gemini)
 ├── adapters.js     → lettori DOM puri per sito (estrazione messaggi, input, inject)
 ├── content.js      → launcher + iframe pannello + fusione DOM↔rete (weave) + registro
 │                     della sessione + canale di controllo per il popup
 ├── net-capture.js  → (MAIN world) osserva gli stream SSE di ChatGPT/Claude: cattura
 │                     indipendente dal markup del sito, comunicata via postMessage
 └── content.css     → stili discrezionali con prefisso .mf-*
pannello (chrome-extension://…/panel.html)
 ├── adapters.js      → parser import (testo incollato, export ChatGPT) riusati dal pannello
 ├── panel.js         → sessioni per (sito, chat) in chrome.storage.local, grafo SVG animato
 │                     (zoom/pan/hover/burst), modalità Studio, pipeline import con progress,
 │                     compilazione contesto, messaggistica con il background, verifica
 │                     reale del motore (punto verde/ambra/rosso), ricarica impostazioni live
 └── panel.css
popup.html/js/css    → stato motore e chat corrente + azioni rapide dalla barra strumenti
background.js        → service worker: unica via di rete verso il motore (locale o API);
                       errori Ollama espliciti, retry sul JSON malformato
options.html         → configurazione motore + test connessione + prova riassunto end-to-end
```

## Limiti MVP noti

- La cattura DOM si basa su selettori correnti dei tre siti; se cambiano markup, la cattura
  di rete (ChatGPT/Claude) continua a funzionare e `Importa → Diagnostica pagina e copia`
  riporta i selettori guasti: aggiornare `adapters.js` (isolato in un unico file).
- L'iniezione del testo usa `execCommand("insertText")`: se un sito la blocca, il pannello
  avvisa e resta la copia manuale.
- Il service worker MV3 può dormire tra le chiamate: la prima compressione di un modello
  locale freddo può richiedere qualche secondo in più.
