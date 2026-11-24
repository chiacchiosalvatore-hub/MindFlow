# Installazione di MindFlow Companion — v1.2.2 «La porta si corregge da sola»

> **Novità v1.2.2 — la CONNESSIONE si sistema da sola**: il famoso caso «LM Studio
> attivo ma endpoint impostato male» (il server era sulla **1235** mentre il campo
> diceva 1234) non può più capitare. Ora: (1) alla prima impostazione dell'endpoint il
> collegamento si verifica SUBITO; (2) se la porta scritta non risponde ma un server
> identico è attivo su una porta vicina, l'endpoint si **corregge e si salva da solo**
> (LM Studio parte sulla 1234 e sale a 1235/1236 se la trova occupata; Ollama idem);
> (3) «Rileva automaticamente» sondea anche le porte 1235–1237 e 11435–11436;
> (4) nuova guida in pagina impostazioni **«Non riesco a connettermi — guida
> completa»**: mappa degli errori, passi LM Studio/Ollama/controlli generali. La
> pillola «motore spento» dice anche quale porta controllare.
>
> **Novità v1.2.1 — LM Studio riconosciuto al volo**: cambio provider a LM Studio
> e motore qwen3.5 9b abliterated: il nome si corregge da solo (chiavi lunghe
> `lmstudio-community/…-GGUF`), la sonda POST scopre il CORS spento (403) prima dei
> riassunti, i modelli «thinking» ricevono più token. v1.2.0: grafo a scaletta su due
> colonne per le chat lunghe, niente ri-disegno a ogni poll.
>
> **Novità v1.2.0 — il grafo delle chat lunghe finalmente LEGGIBILE**: il grafo di
> una chat letta per intero era una colonna verticale infinita da scorrere (20
> capitoli = 1.680 px). Ora i nodi scendono a **scaletta su due colonne** alterne
> (passo 52 px): la stessa catena occupa ~metà altezza e una chat di 8 capitoli
> sta VISIBILE per intero senza scroll; gli archi tra le colonne diventano curve
> a S morbide. Se crei un bivio (checkpoint ri-agganciato), il layout resta
> l'albero classico di prima. In più il pannello **non ridisegna più il grafo a
> ogni poll** della chat se nulla è cambiato: CPU a riposo anche con il pannello
> aperto da ore su una chat lunga.
>
> **Novità v1.1.4 — nessun tasto senza via d'uscita**: il tasto «Annulla» del
> dialogo di import ora CHIUDE davvero il dialogo e ferma la raccolta (prima
> restava aperto a coprire il pannello: l'interfaccia sotto sembrava congelata).
> La riga di stato tiene 3 secondi gli esiti di Compila/Copia/Inietta invece di
> farli sparire sotto l'orologio della pipeline.
>
> **Novità v1.1.3 — diagnosi del modello muto**: se Ollama risponde ma il modello
> non scrive nulla, il messaggio ora legge i METADATI della risposta (token
> generati, tempo di caricamento) e dice il vero motivo (file modello corrotti,
> disco esterno in riposo, caricamento lento) con la cura, invece del generico
> «Risposta priva di contenuto». Con un ping di controllo automatico da 12 token.
>
> **Novità v1.1.2 — grafo veloce**: capitoli compressi in PARALLELO (2 alla volta
> su Ollama), guardia anti-doppio-lancio, orologio dei secondi sempre visibile,
> `num_ctx` adattivo alla lunghezza del testo, raccolta della pagina più svelta.
>
> **Novità v1.1.1 — fix ChatGPT**: su chatgpt.com le RISPOSTE del modello tornano nel
> grafo (prima arrivavano solo le tue domande). Due difese indipendenti: (1) la cattura
> dello stream di rete ora si inietta anche via `chrome.scripting` (world MAIN), così
> supera i blocchi CSP di chatgpt.com; (2) una nuova rete DOM («prose-between-users»)
> ricostruisce le risposte dai paragrafi tra una domanda e la successiva, anche se
> OpenAI rinnova il markup. **Nota permessi**: al ricaricamento Chrome chiede di
> confermare i nuovi permessi per chatgpt.com / claude.ai / gemini.google.com —
> premi «Conferma»: servono SOLO per iniettare la cattura, la lettura resta locale.
>
> **Novità v1.1.1 — risparmio token visibile**: il pulsante «Compila» ora mostra il
> confronto diretto: «Contesto compilato: 0,9k token (chat intera: 21k) — porti in
> una nuova chat circa il 4% del testo». La memoria compatta si porta in ChatGPT,
> Claude o Gemini con «Copia» (o «Inietta» che la scrive nel prompt) invece di
> incollare l'intera conversazione: è QUESTO il risparmio token del grafo.
>
> **Novità v1.1.0**: la pillola verde ora compare su **OGNI sito web**. Sulle chat
> (ChatGPT, Claude, Gemini, Chat GLM) legge la conversazione come sempre; su qualsiasi
> altra pagina (Wikipedia, articoli, documentazione) entra in **modalità PAGINA**:
> individua il contenuto principale, scarta nav/footer/riferimenti e usa i titoli h2/h3
> come confini di sezione — poi la solita pipeline: mappa dei capitoli + checkpoint
> brevi. Nota permessi: Chrome mostrerà «Legge i dati di tutti i siti web» — è ciò che
> serve alla modalità PAGINA; la lettura resta locale, nessun dato lascia il computer
> tranne i testi mandati al motore che tu stesso hai configurato.
>
> Da v1.0.0: UNA sola funzione, il pulsante **«Costruisci il grafo»** (diventa
> «Aggiorna grafo» quando il grafo esiste). Raccoglie il contenuto vero al click
> (resoconto prima di spendere il motore), poi il MOTORE divide in capitoli semantici
> e comprime ogni capitolo in un checkpoint. Funziona con qualunque motore: Ollama,
> LM Studio, llama.cpp, vLLM, OpenAI, Anthropic.

Tre percorsi, dal più rapido al più laborioso. **Chrome resta il modo più semplice**;
Safari richiede un passaggio una tantum con lo strumento di Apple.

> Tempo richiesto: **2 min** su Chrome/Edge/Brave/Arc · **3 min** su Firefox ·
> **10-15 min** su Safari (una sola volta).

---

## A. Chrome / Edge / Brave / Arc (2 minuti)

1. **Scarica** `mindflow-extension-v0.8.0.zip` (bottone "Estensione" nell'app, o dalla
   pagina Chat GLM) e **decomprimilo**. Non cancellare la cartella dopo l'installazione:
   il browser la legge a ogni avvio.
2. Apri `chrome://extensions` (Edge: `edge://extensions`).
3. Attiva la **Modalità sviluppatore** (interruttore in alto a destra).
4. Clicca **Carica estensione non pacchettizzata** → seleziona la **cartella
   decompressa** (quella che contiene `manifest.json`, non lo zip).
5. Apri una chat: **ChatGPT, Claude, Gemini** oppure la **Chat GLM** di MindFlow
   (anteprima o `http://localhost:3000/chat`) — oppure **qualsiasi pagina di testo**
   (Wikipedia, un articolo, la documentazione). Sul bordo destro compare la
   **pillola verde** discreta: cliccala per aprire il pannello.

> **Permessi**: ricaricando l'estensione (v1.1.0) Chrome mostra il consenso
> «Legge e modifica i dati su tutti i siti web»: è il permesso che permette alla
> modalità PAGINA di leggere qualsiasi sito. Se l'estensione era già caricata,
> dopo il cambio permessi Chrome può disattivarla: riattivala da
> `chrome://extensions` (interruttore), poi ricarica le pagine aperte.

## B. Firefox (3 minuti)

Firefox usa "event pages" al posto del service worker: per questo esiste lo ZIP
dedicato `mindflow-extension-firefox-v0.8.0.zip` (stesso codice, manifest adattato).

1. Scarica e decomprimi lo ZIP **Firefox**.
2. Apri `about:debugging#/runtime/this-firefox`.
3. Clicca **Carica componente aggiuntivo temporaneo…** → scegli il file
   `manifest.json` della cartella decompressa.
4. Apri una chat supportata: la pillola compare come su Chrome.

Note Firefox:
- Il caricamento è **temporaneo**: si perde riavviando il browser (va ricaricato).
  Per un'installazione permanente serve la firma AMO (Mozilla Add-ons): possibile
  pubblicarla in futuro direttamente da noi.
- Se il motore locale non risponde: apri `about:addons` → MindFlow Companion →
  **Permessi** → assicurati che l'accesso a `localhost` sia concesso (Firefox MV3
  chiede l'assenso esplicito per i permessi host).

## C. Safari su Mac (10-15 minuti, una volta sola)

Safari non carica cartelle sparse: ogni estensione vive dentro un'app firmata.
Lo strumento ufficiale di Apple converte questa stessa estensione senza modifiche.
Serve **Xcode** (gratuito) **una sola volta**: dopo la conversione, gli
aggiornamenti dell'estensione si applicano senza rifare il procedimento.

**Requisiti:** Safari 16.4+ (macOS 12.4+; il pannello usa iframe di pagine
dell'estensione e service worker MV3), Xcode 15+ , Apple ID gratuito.
**Per uso personale NON serve** l'account Apple Developer a pagamento.

1. Installa Xcode (vedi il troubleshooting qui sotto se l'installazione si blocca).
2. Nel Terminale:

   ```bash
   xcrun safari-web-extension-packager /percorso/della/cartella/decompressa \
     --app-name "MindFlow Companion" \
     --bundle-identifier com.mindflow.companion \
     --macos-only --no-open
   ```

   Su Xcode meno recenti il comando si chiama `safari-web-extension-converter`
   (identici gli argomenti). Lo strumento segnala eventuali chiavi del manifest
   non supportate dalla tua versione di Safari.
3. Apri il progetto generato (`MindFlow Companion.xcodeproj`).
4. Seleziona il target **MindFlow Companion (macOS)** → scheda **Signing &
   Capabilities** → **Team**: scegli il tuo *Personal Team* (il tuo Apple ID
   gratuito; Xcode propone di aggiungerlo se non c'è).
5. Premi **⌘R**. Parte la piccola app contenitore: da questo momento Safari
   "vede" l'estensione.
6. In Safari: **Impostazioni → Estensioni → MindFlow Companion** → attiva la
   spunta. Sempre lì, **consenti l'accesso** ai siti: chatgpt.com, claude.ai,
   gemini.google.com e l'indirizzo dell'anteprima (imposta "Consenti" oppure
   "Tutti i siti web").
7. Riavvia la pagina della chat: compare la pillola verde.

> **Nota per Ollama su Safari:** apri una volta `http://127.0.0.1:11434` in Safari
> (vedrai "Ollama is running"), così `localhost` compare nell'elenco dei siti:
> poi concedi all'estensione anche quell'accesso in Impostazioni → Estensioni.
> Per il riassunto via API non serve nulla di tutto ciò.

### Xcode non si installa? (casi comuni)

| Problema | Soluzione |
| --- | --- |
| "Spazio su disco insufficiente" | Xcode richiede **15-20 GB liberi**. Libera spazio o usa un disco esterno; controlla con  → Informazioni su questo Mac → Archiviaione. |
| Download da App Store lentissimo o bloccato | Scarica il `.xip` direttamente da developer.apple.com/download (Accedi con l'Apple ID → cerca l'ultima versione di Xcode). Spesso è più affidabile dell'App Store. |
| Vuoi provare senza Xcode completo | Installa i **Command Line Tools** (~1,5 GB): `xcode-select --install`, poi prova `xcrun safari-web-extension-packager`. Sui sistemi recenti può bastare; se risponde "unable to find utility" serve Xcode completo. |
| Installazione fallita a metà | Riavvia il Mac, elimina i download parziali (App Store → Account → ma anche `~/Library/Caches/com.apple.appstore`), riprova dal `.xip`. |
| Niente Xcode per ora | Usa Chrome/Edge/Brave/Arc (2 minuti): l'estensione è identica. Safari può aspettare. |

## D. Prova completa nell'anteprima (Chat GLM)

Il modo più rapido per verificare tutto il flusso senza account a pagamento:

1. Installa l'estensione su Chrome (percorso A).
2. Apri la pagina **Chat GLM** (bottone "Chat GLM" nell'header dell'app, o
   `/chat`): il badge in alto diventa verde **"Estensione attiva"** — se resta
   ambra, l'estensione non è caricata o non hai ricaricato la pagina.
3. Chatta con GLM (risponde davvero, via il server dell'anteprima).
4. Apri la pillola MindFlow: il contatore **"messaggi letti"** cresce in diretta.
5. **Nuovo checkpoint** → il grafo si anima e comprime la coda (senza motore
   configurato usa il fallback euristico; con Ollama fa riassunti veri).
6. **Compila contesto** → **Incolla nella chat**: il testo compilato finisce
   nella textarea di GLM, pronto da inviare. La chat "ricorda" senza la storia intera.
7. **Nuova chat** (nella pagina GLM) = grafo di memoria nuovo: verifichi che le
   sessioni restano separate.

## D2. Novità v0.5: pillola viva, avvio automatico e adattatore ChatGPT 2026

### La pillola ora mostra di essere viva

- **Contatore messaggi**: un piccolo numero verde compare sulla pillola e cresce
  mentre chatti (anche a pannello chiuso);
- **Pulsazione**: quando arriva una risposta nuova, la pillola pulsa due volte;
- **Avvio automatico**: alla prima risposta utile di una conversazione il
  pannello si apre da solo, una sola volta per conversazione e per scheda (se lo
  chiudi, non si riapre da solo). Si disattiva da **Impostazioni → Pannello →
  "Apri il pannello automaticamente"**.

### Adattatore ChatGPT rinnovato

ChatGPT riscrive il proprio DOM di continuo (e a fine 2025 ha introdotto
attributi nuovi e la virtualizzazione delle chat lunghe). L'adattatore ora usa
**quattro strategie combinate**: `data-message-author-role` (storica),
`data-user-message-bubble` + `data-markdown-text-style` (2025/2026), wrapper
`conversation-turn`, e `data-chatgpt-search-unit-key` (chat riaperte dalla
ricerca). I messaggi trovati da tutte le strategie vengono fusi in ordine di
documento, senza doppioni (un contenitore già coperto dal suo contenuto viene
scartato): così anche le pagine con markup misto — vecchio e nuovo nella
stessa conversazione — si leggono per intero. Il testo viene preso dal blocco
markdown interno, senza i pulsanti d'azione.

### Se qualcosa non va: Diagnostica pagina

Quando "Raccogli questa pagina" non trova messaggi, il dialogo di importazione
mostra l'errore e un bottone **"Diagnostica pagina e copia"**: produce un
report JSON (quali selettori trovano cosa, URL, titolo) già copiato negli
appunti. Incollalo in chat e l'adattatore viene corretto senza accesso al tuo
computer. Inoltre, se la chat collegata ha messaggi ma il grafo è vuoto, lo
stato vuoto propone **"Costruisci ora il grafo (N messaggi letti)"** con un click.

## D3. Novità v0.4: modalità Studio e import di chat passate

### Modalità Studio (l'area di lavoro "chat a sinistra, grafo a destra")

Pannello → **icona con le frecce** (in alto, tra le sessioni e l'ingranaggio):
il pannello si allarga a circa il 60% dello schermo. Risultato: la tua chat resta
utilizzabile a sinistra e il grafo diventa la scena principale a destra.
Lo stato viene memorizzato: alla riapertura il pannello torna largo.

Nel pannello a tutta larghezza il grafo supporta:

- **Zoom**: rotella del mouse tenendo **Ctrl/Cmd** (oppure i bottoni +/−/⤢ in basso a destra);
- **Pan**: trascina il grafo come una mappa;
- **Hover**: passando su un nodo si accendono i suoi collegamenti e il resto si attenua;
- **Click su un checkpoint**: i dettagli si aprono **e la chat scorre al messaggio**
  coperto dal checkpoint, evidenziato da un bagliore verde.

### Import: costruisci il grafo da una chat già fatta

Pannello → **icona con la freccia in giù** (o il link "Importa" nel grafo vuoto).
Tre vie, tutte locali:

1. **Raccogli questa pagina** — per la chat lunga che hai davanti: il pannello
   scorre la conversazione dall'inizio alla fine (auto-scroll) e comprime ogni
   segmento in una catena di checkpoint attaccata alla radice. Perfetto per le
   chat vecchie di settimane ancora aperte in una scheda.
2. **Incolla testo** — copi la chat da qualsiasi piattaforma e la incolli:
   riconosco le etichette più comuni ("You said:", "ChatGPT said:", "Utente:",
   "**[UTENTE]**", "Human:", "Assistant:"); senza etichette alterno i turni.
   Funziona anche per chatbot non supportati dall'estensione.
3. **Da file** — l'export ufficiale di ChatGPT (Impostazioni → Controlli dati →
   Esporta dati → `conversations.json`), oppure un `.txt`/`.md`. L'albero di
   rigenerazioni viene percorso scegliendo sempre l'ultima risposta.

Durante l'import vedi la **barra di progresso** ("Checkpoint 3/8: titolo…") e puoi
**annullare**: i checkpoint già creati restano nel grafo. I grafi importati vivono
nel menu **sessioni** (icona cubo): clic su una voce per rivederli, il riassunto
usa lo stesso motore configurato (Ollama locale = tutto sul tuo computer).

## D9. Novità v0.9.2: il pannello parla DIRETTAMENTE col motore (fine del loop «aggiorna la pagina»)

La v0.9.1 dava la colpa al canale dei messaggi, ma la diagnosi sul campo ha
mostrato che finché il riassunto passava dal **service worker**, Chrome poteva
spegnerlo a metà (vita ~30 s) e il pannello leggeva quel silenzio come
«estensione aggiornata → ricarica la pagina»: ricaricavi, sembrava ok, e al
riassunto successivo l'avviso TORNAVA. La v0.9.2 toglie il service worker dal
percorso principale:

- **Riassunto e verifica motore in fetch DIRETTO dal pannello** (nuovo
  `engine-client.js`, condiviso con le impostazioni): il fetch vive con il
  pannello aperto, quindi «service worker non raggiungibile» e i checkpoint
  «in pausa» spariscono dal percorso principale. Il pallino verde
  `Ollama · gemma3:latest` ora significa che IL PANNELLO ha interrogato il
  motore, non il worker.
- **Banner «ricarica la pagina» solo quando è VERO.** Nasce esclusivamente
  dal contesto estensione invalidato (aggiornamento con la chat aperta).
  Dopo il ricaricamento non può più tornare da solo: un contesto fresco non
  si invalida da solo.
- **Pillola con puntino rosso = un clic e guarisce.** Aggiornato
  l'estensione con la chat aperta? La pillola MindFlow sul bordo destro
  mostra un puntino rosso pulsante: un clic e la pagina si ricarica da sola.
- **Il worker resta come RISERVA e auto-riprende i lavori interrotti**
  (parametri salvati, massimo 2 riavvii, poi l'errore vero).
- **«Prova riassunto» diretto-first**: stesso identico percorso del pannello;
  il worker interviene solo se il collegamento diretto non parte per rete.

## D8. Novità v0.9.1: addio «service worker non raggiungibile» e al falso banner «aggiornato»

- **Il riassunto ora gira come LAVORO.** Prima il pannello e le impostazioni attendevano minuti
  su una sola chiamata al service worker: col modello a freddo (gemma3 che si carica in RAM alla
  prima richiesta) Chrome spegneva il service worker a metà lavoro — il canale si chiudeva e
  l'utente vedeva «Riassunto NON riuscito: service worker non raggiungibile» anche col motore
  collegato. Ora `mindflow:summarize` risponde IMMEDIATAMENTE con l'id del lavoro, il riassunto
  gira in background tenuto vivo da un keep-alive interno, e il pannello legge lo stato ogni
  2 s (`mindflow:job-status`). Il lavoro non muore più durante il caricamento del modello.
- **Il banner «MindFlow è stato aggiornato» esce SOLO se vero.** Gli errori «message port closed»
  e «Receiving end does not exist» arrivano anche con il worker solo lento o riavviato: non
  provano più un aggiornamento e non mostrano più il banner che restava fisso e che il
  ricaricamento non risolveva (perché il riassunto seguente ripresentava l'errore). Il banner
  resta per il solo contesto davvero invalidato; un riuscito successivo lo nasconde da solo.
- **Attese parlanti.** Durante il primo caricamento del modello il pannello dice «ancora in
  attesa del motore (pazienta)…» invece di sembrare bloccato.
- **«Prova riassunto» dice la verità.** Se il service worker non risponde, la pagina impostazioni
  fa una verifica DIRETTA del motore e separa i due casi: motore spento (`ollama serve`) o
  service worker da ricaricare (`chrome://extensions`, pulsante ⟳).
- **Riassunti interrotti dichiarati.** Se il service worker viene riavviato a metà riassunto, lo
  stato del lavoro sopravvive in `storage.session`: il pannello riceve «lavoro interrotto:
  riprova» invece di restare in attesa per sempre.

## D7. Novità v0.9.0: addio "euristico", cattura anti-rinnovo, pannello mai bloccato

- **La modalità "euristico" è stata RIMOSSA.** Come richiesto: più niente etichette,
  chip, strisce ambra o "fallback estrattivo" nel grafo. I checkpoint nascono SOLO dal
  motore configurato (es. Ollama con gemma3); se il motore non risponde, il checkpoint
  non viene creato e la riga di stato mostra il motivo vero. La coerenza è totale:
  se vedi il pallino verde "Ollama · gemma3:latest", ogni checkpoint è uscito da lì.
- **Cattura "turn-slots" con riserva assoluta.** La nuova strategia primaria legge ogni
  contenitore di turno e ne estrae i due slot (bolla utente + prosa assistente). Se
  chatgpt.com rinomina di nuovo TUTTO, la riserva finale legge i PARAGRAFI della risposta:
  il testo esiste sempre dentro blocchi, qualunque wrapper li contenga.
- **Banner aggiornato con bottone.** Il banner "MindFlow è stato aggiornato" ora ha il
  bottone **«Ricarica la pagina»** che ricarica la scheda da solo (funziona anche con il
  pannello collegato alla versione precedente), e prima di apparire viene fatto un secondo
  ping: niente falso banner per un service worker lento a svegliarsi.
- **Niente pannello bloccato.** Se la raccolta della pagina o la costruzione del grafo
  incontrano un errore, il risultato parziale viene consegnato comunque e la barra di
  avanzamento si chiude sempre (rete di sicurezza a 60 s). Il grafo verifica il motore
  PRIMA di comprimere: se il motore cade a metà, la catena si ferma con il messaggio vero
  e i checkpoint già creati restano.
- **Auto-checkpoint vero.** Superata la soglia di risposte (impostazioni, default 4) il
  checkpoint nasce da solo — solo con il motore collegato e verificato.

## D6. Novità v0.8.0: la cattura a livello di slot e la chat anonima di ChatGPT

La v0.7.1 funzionava sulle pagine di prova ma NON sulla chatgpt.com reale, dove restava
"solo la prima frase" e i checkpoint continuavano a nascere "euristico". La causa era
DOPPIA e entrambe le radici sono chiuse in questa versione:

- **Il DOM reale a scambi annidati.** Nelle varianti attuali di chatgpt.com ogni scambio è
  un contenitore (`[data-turn-key]` o la sezione `conversation-turn`) che contiene DENTRO
  sia la bolla utente sia la risposta. La strategia precedente accettava il contenitore
  intero come UN messaggio con ruolo del primo figlio (= utente) e, per deduzione,
  sopprimeva tutti gli elementi interni: la risposta spariva. Ora i contenitori NON sono
  mai messaggi: la strategia "turn-exchange" emette gli slot interni come messaggi separati
  (bolla utente / blocco risposta), insieme agli holder `data-message-author-role`, alle
  bolle `[data-user-message-bubble]`, ai blocchi `.markdown` e alle unità di ricerca con
  suffisso `…:user` / `…:assistant`. I doppioni (stesso testo o uno prefisso dell'altro,
  ≥ 24 caratteri) vengono fusi.
- **La chat ANONIMA (senza login).** Le chat senza account vivono su URL `/uc/<id>` e lo
  stream usa l'endpoint `/backend-anon/f/conversation` (l'autenticata usa `/backend-api/…`):
  la cattura di rete prima non si attivava mai su quella variante. Ora entrambe le forme sono
  intercettate e la chiave di conversazione riconosce `/uc/<id>`.
- **Testo pulito.** Il testo dei turni si legge camminando il DOM: via pulsanti (Copia,
  Mostra altro, valutazioni), etichette degli strumenti e blocchi interrotti; restano i
  paragrafi separati e la parte "chiusa" (Mostra altro) che textContent conserva anche
  quando è visivamente clampata.
- **Motore e "euristico" sotto controllo.** Il test di connessione corregge da solo il nome
  del modello assente (es. `gemma3` → `gemma3:latest`) salvandolo nelle impostazioni; il
  riassunto riprova fino a 3 volte su errori transitori (motore che si sveglia, rete lenta);
  e il motivo di ogni checkpoint "euristico" è scritto VISIBILE nei dettagli del checkpoint,
  non più solo nel tooltip del chip.
- **Banner "ricarica la pagina".** Se l'estensione viene aggiornata o ricaricata mentre la
  pagina della chat resta aperta, il contesto dell'estensione si invalida e TUTTE le
  chiamate al motore falliscono — era il falso "non raggiungibile". Il pannello ora lo
  riconosce e mostra un banner ambrato con l'istruzione esatta: **Cmd/Ctrl+R sulla pagina
  della chat**, poi riapri il pannello.
- **Etichette motore brevi**: `Ollama · gemma3:latest` (verde), `modello assente`,
  `motore non raggiungibile`, `ricarica la pagina`.

> **Dopo ogni aggiornamento dell'estensione: ricarica la pagina della chat** (Cmd/Ctrl+R,
> oppure un clic sulla pillola MindFlow quando mostra il puntino rosso). Il modulo di rete
> e la connessione al motore entrano a caricamento pagina.

## D5. Novità v0.7.1: il protocollo nuovo di ChatGPT e il modello che si ripara da solo

ChatGPT ha rinnovato in profondità sia il **trasporto di rete**; la v0.7.1
adattava la cattura al protocollo nuovo (patch JSON) e rendeva il modello auto-riparante:

- **Nuovo protocollo SSE a patch JSON.** ChatGPT non invia più messaggi completi ma
  micro-patch (`{"p":"/message/content/parts/0","o":"append","v":"…"}`, continuation
  `{"v":"…"}`, patch composite). Il vecchio parser vedeva solo l'eco del primo messaggio
  utente: per questo restava "la stessa prima frase". Il nuovo parser ricostruisce il
  testo streaming dai patch, ignora metadata/reasoning/tool e gestisce anche la forma
  vecchia (compatibilità totale).
- **Nuovo DOM 2026-10.** `data-message-author-role` non esiste più: i turni sono
  `[data-turn-key]`/`[data-talvt-turn-state]`/`[data-virtualized-turn-content]` e i
  messaggi si riconoscono con `[data-conversation-role]` e `[data-markdown-text-style]`.
  Le strategie nuove hanno la precedenza; le vecchie restano come riserva e c'è una
  riserva strutturale che attraversa anche gli **shadow root** aperti se un giorno il
  sito incapsula i turni.
- **Cattura anche nella Chat GLM di prova via rete.** Il pannello legge ora anche lo
  stream `/api/mindflow/chat` (request + delta), oltre al DOM: doppio canale anche nel
  banco di prova. Al cambio di conversazione ("Nuova chat") la traccia di rete vecchia
  viene scartata: i messaggi non si mescolano più tra chat diverse.
- **Ollama: JSON forzato + modello che si ripara da solo.** Le chiamate di riassunto usano
  `format: "json"` (niente più fallback "risposta non interpretabile" con gemma), il
  timeout sale a 240 s (caricamento a freddo) e il modello resta caldo 15 minuti
  (`keep_alive`). Se il MODELLO impostato non esiste nel motore (es. "gemma" invece di
  "gemma3:latest"), l'estensione lo scopre, sceglie da sola il modello installato più
  adatto, riprova e **salva la correzione nelle impostazioni**: il checkpoint esce dal
  modello, non dall'euristico.
- **Etichetta motore sempre visibile.** Accanto al punto di stato il pannello mostra ora
  il motore reale in chiaro: `Ollama · gemma3:latest` quando funziona; `modello assente →
  euristico` / `non raggiungibile → euristico` / `euristico: manca il MODELLO` quando il
  riassunto sta cadendo nel fallback, con il motivo completo nel tooltip (compresa la
  lista dei modelli realmente presenti).

## D4. Novità v0.7.0: cattura su due canali, motore verificato, popup dalla barra

### Cattura su due canali (fine del "prende solo la prima frase")

Ora la conversazione si legge con DUE canali indipendenti, fusi insieme:

1. **DOM** — gli adattatori aggiornati (nuovo URL ChatGPT `/u/<id>`, inferenza strutturale
   dei ruoli sui turni, e per prima volta la riserva strutturale anche per ChatGPT);
2. **RETE** — `net-capture.js` entra nella pagina e osserva gli stream SSE con cui
   ChatGPT e Claude consegnano i messaggi: contiene già autore e testo, nel vero ordine,
   indipendenti dal markup. È il canale che tiene il conteggio vivo anche quando il sito
   rinnova il proprio DOM o virtualizza i turni.

In più: i turni consecutivi dello stesso ruolo NON vengono più fusi in un unico messaggio
(era la ragione per cui, quando le risposte non venivano estratte, restava solo "1 messaggio");
e il registro della sessione accumula i turni visti, così la virtualizzazione delle chat
lunghe non fa più sparire messaggi già letti. Il popup e la riga di stato mostrano sempre
la composizione della cattura ("DOM 3 + rete 5").

### Il punto motore ora dice la verità (fine dell'"euristico" a sorpresa)

Il punto in alto nel pannello non si limita a guardare i campi: **verifica il motore con
una chiamata vera** appena il pannello si apre e ogni volta che le impostazioni cambiano:

- **verde** = collegato E verificato (modello impostato, motore raggiungibile);
- **ambra** = impostato ma non raggiungibile (avvia `ollama serve`) o verifica in corso;
- **rosso** = modello mancante/non configurato.

E tre protezioni nuove:

- il pannello **rilegge le impostazioni in tempo reale**: se configuri Ollama nelle opzioni
  mentre il pannello è aperto, lo vede subito (prima restava la config vecchia);
- le opzioni avvisano esplicitamente quando la connessione è OK ma **il campo MODELLO è
  vuoto** — la configurazione che non può produrre checkpoint veri passando il test;
- il bottone **«Prova riassunto»** fa una compressione d'esempio end-to-end con lo
  STESSO collegamento diretto del pannello (v0.9.2): se compare "RIASSUNTO OK dal
  modello", i checkpoint useranno il motore. Ollama che risponde 200 con un errore
  dentro (memoria insufficiente, modello assente) viene riconosciuto, il nome modello
  errato ("gemma3" invece di "gemma3:latest") si corregge da solo e un output non-JSON
  viene ritentato una volta con istruzione rigida. Se il riassunto non riesce, il
  messaggio è quello VERO del motore: nessun fallback, nessun checkpoint finto.

### Popup dalla barra strumenti (la rotella, ovunque)

Clic sull'icona MindFlow nella barra: un popup mostra lo stato REALE del motore (con il
bottone ↻ per riverificare), lo stato della chat nella scheda corrente (messaggi letti,
composizione della cattura) e tre azioni rapide: **Impostazioni**, **Apri il grafo qui**,
**Raccogli la chat intera**. Funziona anche a pannello chiuso: non serve più cercare
l'ingranaggio dentro il pannello.

## E. Configurare il motore (riassunti veri)

Pannello → **ingranaggio** in alto a destra.

**Scorciatoia:** premi **Rileva automaticamente**: l'estensione sonda in
parallelo le porte dei motori locali noti e compila i campi — tipo, endpoint e
modello — da sola. Prova Ollama (11434, su `127.0.0.1` e `localhost`), LM Studio
(1234), llama.cpp / Llamafile (8080), vLLM (8000), Jan (1337), KoboldCpp (5001),
GPT4All (4891) e text-generation-webui (5000). Se il modello non è ancora impostato,
la rilevazione parte anche da sola all'apertura della pagina impostazioni.

Configurazione manuale, se preferisci:

| Motore | Endpoint | Chiave |
| --- | --- | --- |
| **Ollama** (consigliato) | `http://127.0.0.1:11434` | — |
| **OpenAI-compatibile locale** (LM Studio, llama.cpp, vLLM) | `http://127.0.0.1:1234/v1` | opzionale |
| **OpenAI** | fisso | `sk-…` |
| **Anthropic** | fisso | `sk-ant-…` |

- Per i checkpoint basta un modello **piccolo e veloce** (3B–8B): `qwen2.5:7b-instruct`,
  `llama3.2:3b`, `gemma3` — gratuito e privato. **Il campo modello è obbligatorio.**
- Premi **Test connessione** (verifica l'endpoint) e poi **Prova riassunto** (verifica la
  catena completa: pannello → motore, in fetch diretto). Se la prova va bene, il
  punto motore diventa verde e i checkpoint usano il modello.
- **Se usi Ollama, c'è un passaggio una tantum: «Sblocca Ollama».** Per sicurezza
  Ollama accetta dal browser solo le pagine su `localhost`; un'estensione parte da
  un'origine diversa e Ollama risponde **403** ai riassunti (mentre il test di
  connessione passa: era il motivo per cui «si connette al motore» ma ogni
  checkpoint falliva). La v0.9.3 lo rileva da sola e apre la guida
  **«Sblocca Ollama»** nelle impostazioni: si imposta la variabile d'ambiente
  `OLLAMA_ORIGINS` a `chrome-extension://*,moz-extension://*,safari-web-extension://*`
  e si riavvia Ollama COMPLETAMENTE (Esci dalla tray, non solo chiudere la finestra).
  Un minuto, una volta sola, e vale per Chrome, Edge, Firefox e Safari.
- **Se usi LM Studio, due cose da sapere (v1.2.1):**
  1. **Attiva CORS nel server** (una tantum): LM Studio → scheda **Developer
     (Sviluppo)** → impostazioni del server → **«Enable CORS»** ON. Senza CORS il
     server accetta il test di connessione (il GET passa) ma rifiuta con **403**
     ogni riassunto dell'estensione — esattamente «endpoint riconosciuto ma il
     modello non rispondeva». MindFlow ora lo scopre col test e dice la cura.
  2. **Il nome del modello non si scrive a mano**: LM Studio identifica i modelli
     con chiavi lunghe (es. `lmstudio-community/Qwen3.5-9B-abliterated-GGUF`).
     Scrivi pure il nome come lo conosci («qwen3.5 9b abliterated»): dal test
     della v1.2.1 il campo si corregge DA SOLO con la chiave esatta, e anche a
     metà riassunto un nome sbagliato viene riparato al volo.
  Nota sui modelli **Qwen3 «thinking»**: se il modello spende tutto il tempo a
  ragionare, MindFlow ritenta automaticamente con un tetto di token più alto; se
  il problema resta, disattiva la modalità thinking del modello in LM Studio
  (interruttore nella chat del modello) o usa una variante senza thinking.
- Le chiavi restano nel `chrome.storage.local` del browser: nessun server MindFlow.

## F. Problemi comuni

| Problema | Soluzione |
| --- | --- |
| **«Errore 403 dal motore» / «Ollama blocca l'estensione»** | Non è un guasto: Ollama (per sicurezza) rifiuta le richieste che arrivano da un'estensione. La connessione risulta OK ma i riassunti ricevono 403. Cura una tantum: nelle impostazioni di MindFlow segui la sezione **«Sblocca Ollama»** — imposta la variabile d'ambiente `OLLAMA_ORIGINS` a `chrome-extension://*,moz-extension://*,safari-web-extension://*` ed ESCI da Ollama (tray → Quit) prima di riavviarlo: la variabile va letta ALL'AVVIO. Poi «Test connessione» → «Prova riassunto». La v0.9.3 lo rileva da sola (pillola «Ollama blocca l'estensione» cliccabile, guida che si apre automaticamente). |
| **I checkpoint non nascono / sono rifiutati nonostante Ollama collegato** | Quasi sempre: (1) il campo **MODELLO** nelle impostazioni è vuoto (il test connessione passa comunque: verifica l'endpoint, non il modello) — compila il campo e premi **Prova riassunto**; (2) il nome modello non coincide con `ollama list` (es. "gemma3" vs "gemma3:latest"): dalla v0.9.2 si corregge DA SOLO e la correzione viene salvata; (3) Ollama risponde con un errore interno (memoria insufficiente): il messaggio vero appare nella riga di stato del pannello. Niente fallback: il grafo resta pulito e il motivo è sempre visibile. | 
| **«Risposta Ollama priva di contenuto (0 token generati, modello caricato in X s…)»** | Dalla v1.1.3 il messaggio dice COSA è successo dai metadati di Ollama. 0 token generati + caricamento lungo = modello ripreso dal DISCO che poi non ha scritto nulla: tipico dei modelli su **disco esterno** (disco in riposo, USB lento, copia incompleta). Verifica nel terminale: `ollama ps` (il modello è caricato?), `ollama run <modello> "ciao"` (genera?), `ollama show <modello>` (file integri?). Se anche nel terminale non risponde: ri-scarica il modello (`ollama pull <modello>`) o ricopia i file sul disco esterno. Se il terminale risponde: premi di nuovo **Prova riassunto** subito — dopo due tentativi vuoti MindFlow esegue da solo un **ping di controllo**: se il ping risponde, il vuoto era transitorio e il modello è già caldo in RAM. |
| **LM Studio: test OK ma riassunti con 403 / «il modello non rispondeva»** | Due cause tipiche, entrambe gestite dalla v1.2.1: (1) **CORS spento** — il server accetta il GET del test ma rifiuta il POST dell'estensione con 403: apri LM Studio → Developer (Sviluppo) → impostazioni del server → **Enable CORS** ON, poi di nuovo «Test connessione»; la pillola nel pannello dice «LM Studio blocca l'estensione» proprio per questo. (2) **Nome modello** — LM Studio usa chiavi lunghe (`lmstudio-community/Qwen3.5-9B-abliterated-GGUF`): dalla v1.2.1 il campo si corregge da solo al test e un nome sbagliato si ripara al volo anche durante i riassunti (match fuzzy sul nome). Se hai più modelli caricati, «Rileva automaticamente» sceglie per te. |
| **LM Studio / Qwen3: «il modello ha consumato tutti i token nel ragionamento (thinking)»** | I modelli con thinking (Qwen3 e simili) possono bruciare il tetto di token nel ragionamento senza scrivere la risposta. MindFlow ritenta da solo con più token; se il messaggio torna, disattiva la modalità thinking del modello in LM Studio (interruttore nella chat del modello) oppure usa una variante senza thinking. |
| **La cattura prende solo la prima frase / le risposte di ChatGPT non arrivano** | Dalla v0.8.0 la cattura è su due canali (DOM + stream di rete). Aggiorna l'estensione e **ricarica la pagina della chat** (il modulo di rete entra a caricamento pagina). Se il DOM resta cieco ma la rete funziona, il conteggio cresce comunque: verifica nel popup ("cattura: DOM x + rete y") o con Importa → Diagnostica pagina. |
| La pillola verde non compare | Ricarica la pagina; controlla di essere su un URL supportato. Su Safari verifica il permesso del sito in Impostazioni → Estensioni. Sull'anteprima: la pillola compare solo nella pagina Chat GLM (è l'unica pagina "chat" dell'anteprima). |
| Il popup dalla barra strumenti è vuoto o non si apre | Dopo un aggiornamento dell'estensione: rimuovi e ricarica la cartella, poi riavvia il browser. |
| Badge "Estensione non rilevata" sulla Chat GLM | L'estensione non è installata/caricata, oppure è stata caricata PRIMA dell'aggiornamento a v0.6.1: riavvia il browser e ricarica la pagina (o rimuovi e ricarica la cartella aggiornata). |
| "Motore non raggiungibile" | Il motore locale è spento (`ollama serve`; LM Studio: Developer → Start Server) oppure **la porta è sbagliata**: LM Studio parte sulla 1234 ma se la trova occupata sale alla 1235/1236… — **incolla la porta VERA mostrata nella scheda Developer**, oppure premi «Test connessione» in impostazioni: dalla v1.2.2 la porta si **corregge da sola** (sonda sulle porte vicine e salva l'endpoint giusto); «Rileva automaticamente» ora vede anche 1235–1237 e 11435–11436. Vedi la guida «Non riesco a connettermi» nella pagina impostazioni. |
| **«Endpoint riconosciuto ma il motore non rispondeva» (LM Studio su porta non standard)** | È il caso classico della v1.2.2: server attivo su `http://127.0.0.1:1235/v1` ma campo compilato sulla 1234. Cura automatica: apri le impostazioni → «Test connessione» → l'endpoint viene corretto e salvato da solo con il messaggio «Endpoint corretto automaticamente: … il motore è attivo su 1235». In alternativa incolla a mano l'URL esatto (porta compresa) mostrato da LM Studio nella scheda Developer. Se il test si collega ma i riassunti ricevono 403: attiva **Enable CORS**. |
| "Contesto dell'estensione invalidato" / "Receiving end does not exist" | Succede solo se l'estensione è stata aggiornata/ricaricata con la chat aperta. Dalla v0.9.2 la pillola MindFlow mostra un **puntino rosso**: un clic ricarica la pagina e tutto torna. (Il riassunto ora va in fetch diretto dal pannello, quindi questo caso non blocca più i checkpoint dopo il ricaricamento.) |
| Il modello locale è lento alla prima richiesta | Normale: alla prima generazione il modello si carica in RAM (può superare il minuto). Dalla v0.9.2 il riassunto attende fino a 3 minuti in fetch diretto e il modello resta caldo 15 minuti. Usa un 3B–8B per checkpoint rapidi. |
| Firefox: l'aggiunta sparisce al riavvio | È il comportamento del caricamento temporaneo (vedi sezione B). |
| Safari: "L'estensione non può essere caricata" | Rifai ⌘R da Xcode; controlla il Team in Signing & Capabilities; riavvia Safari. |
| Safari: pannello vuoto | Serve Safari 16.4+; verifica in Safari → Informazioni. Aggiorna macOS/Safari. |
| Il markup di un sito cambia (raro) | Le strategie di lettura sono isolate in `adapters.js` con quattro piani di riserva per ChatGPT; la pagina Selftest dell'app mostra cosa legge ogni adattatore. Se un sito cambia davvero: Importa → "Diagnostica pagina e copia" e incolla il report in chat. |
| "Non ho trovato messaggi in questa pagina" | La conversazione è davvero aperta? Se sì, il sito ha cambiato DOM: premi "Diagnostica pagina e copia" e incolla il risultato in chat; nel frattempo usa "Incolla testo" o "Da file". |
| L'import "Raccogli questa pagina" si ferma presto | Il ciclo termina dopo tre rilevazioni senza nuovi messaggi: su chat lunghissime con virtualizzazione ripetila partendo dalla cima; l'unione evita i doppioni. |
