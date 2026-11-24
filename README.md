# MindFlow — DevourLabs

> Estensione browser (Chrome / Firefox) per interagire con un **LLM locale** (compatibile Ollama) direttamente dalla pagina, senza servizi esterni, senza telemetria e senza chiavi nel codice.

**Versione corrente: v1.2.2 — «La porta si corregge da sola»** — stato di allineamento al 2026-11-24, vedi [`mindflow-extension/CHECKPOINT.md`](mindflow-extension/CHECKPOINT.md).

**Vetrina online:** https://chiacchiosalvatore-hub.github.io/MindFlow/ (GitHub Pages, sorgente in [`docs/`](docs/)) · Licenza **MIT** · Audit di sicurezza: [`docs/AUDIT-SICUREZZA.md`](docs/AUDIT-SICUREZZA.md)

**Fase 1 del lancio (25/11/2026): beta pubblica qui su GitHub** — scarica lo zip dalla sezione [Releases](https://github.com/chiacchiosalvatore-hub/MindFlow/releases) e segui la sezione «Installazione per utenti» qui sotto. Chrome Web Store arriva come Fase 2, dopo la validazione dei segnali.

## Cos'è

MindFlow porta nel browser un'interfaccia completa verso il proprio modello locale:

- **engine client** (`engine-client.js`) — dialoga con l'endpoint locale del modello, con auto-rilevamento dell'endpoint e correzione automatica degli errori di porta più comuni (es. 1234→1235);
- **adapters** (`adapters.js`) — adattano il motore ai diversi contesti della pagina;
- **side panel** (`panel.html/css/js`) — chat, grafici e gestione della sessione;
- **popup e opzioni** (`popup.*`, `options.*`) — configurazione endpoint, modello e preferenze;
- **diagnostica di rete** (`net-capture.js` + `background.js`) — cattura e gestione degli errori di connessione.

Tutto gira in locale: le chiavi API restano solo in `chrome.storage` del browser dell'utente; il codice non contiene segreti né telemetria.

## Struttura del repository

```
mindflow-extension/          # sorgente dell'estensione (v1.2.2, pronta da caricare "unpacked")
  manifest.json              # manifest MV3
  background.js              # service worker, routing e diagnostica
  engine-client.js           # client verso l'LLM locale (autodetect + autofix porta)
  adapters.js                # adapter dei contesti pagina
  content.js / content.css   # iniezione nella pagina
  net-capture.js             # cattura rete per diagnostica
  panel.html/css/js          # side panel (chat, grafici, sessione)
  popup.html/css/js          # popup
  options.html/css/js        # pagine opzioni
  icons/                     # icone PNG incluse (rigenerabili con lo script)
  README.md                  # guida dell'estensione
  INSTALLAZIONE.md           # installazione passo-passo
  CHECKPOINT.md              # stato progetto v1.2.2
scripts/                     # test automatici + utility build/QA (percorsi relativi, portabili)
  test-*.js                  # suite di test (engine, adapter, porta, rete, ...)
  build-extension.sh         # build/packaging (zip Chrome + variante Firefox)
  make-extension-icons.py    # rigenera le icone PNG
  mock-local-llm.js          # finto endpoint LLM per i test
  check-*.js / shot-*        # QA DOM e screenshot
docs/                        # GitHub Pages: vetrina, privacy policy, audit di sicurezza
```

La **web app companion Next.js** è sviluppata a parte (decisione tracciata in [`ROADMAP.md`](ROADMAP.md)); i documenti di distribuzione PDF/DOCX non sono versionati.

## Installazione per utenti (beta, senza store)

Serve Chrome per desktop e un motore LLM che già possiedi: locale (Ollama, LM Studio, llama.cpp, vLLM…) oppure un'API cloud con la tua chiave. MindFlow non ha server: tutto gira nel tuo browser.

1. Scarica lo zip dell'ultima [Release](https://github.com/chiacchiosalvatore-hub/MindFlow/releases) (es. `mindflow-extension-v1.2.2.zip`) ed estrailo in una cartella che non cancellerai.
2. Apri `chrome://extensions` e attiva la **Modalità sviluppatore** (interruttore in alto a destra).
3. Clicca **Carica estensione non pacchettizzata** e seleziona la cartella estratta.
4. Apri le opzioni di MindFlow e indica l'endpoint del motore (il test di connessione corregge da solo le porte sbagliate) oppure l'API cloud con la tua chiave.

Due note oneste sul lancio «da GitHub»:

- Chrome mostra a ogni avvio un avviso sulle estensioni in modalità sviluppatore: è il comportamento normale fuori dallo store, si chiude e non limita nessuna funzione.
- Gli aggiornamenti non sono automatici: scarica la nuova Release, estrai i file **sulla stessa cartella** e premi «Ricarica» su `chrome://extensions`; impostazioni e grafi restano al loro posto.

Guida completa con lo sblocco CORS di Ollama/LM Studio: [`mindflow-extension/INSTALLAZIONE.md`](mindflow-extension/INSTALLAZIONE.md).

## Dopo il clone

1. Le icone sono incluse; per rigenerarle: `python3 scripts/make-extension-icons.py` (crea `mindflow-extension/icons/icon-16/32/48/128.png`).
2. Carica l'estensione: `chrome://extensions` → modalità sviluppatore → **Carica unpacked** → seleziona `mindflow-extension/`. Su Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on**.
3. Avvia il modello locale (es. Ollama) e apri il pannello MindFlow.
4. Guida completa: [`mindflow-extension/INSTALLAZIONE.md`](mindflow-extension/INSTALLAZIONE.md).

## Test

I test girano con Node.js, senza dipendenze da installare:

```bash
node scripts/test-engine-client.js    # 20/20
node scripts/test-port-autofix.js     # 14/14 (autofix porta 1234→1235)
node scripts/test-autodetect.js       # 4/4 scenari di autodetect endpoint
node scripts/test-memoria-residua.js  # 24/24 (sessioni isolate, nessun residuo)
node scripts/test-panel-boot.js       # boot del pannello
# ... e gli altri test-*.js in scripts/
```

Stato allineamento v1.2.2: **tutti verdi** (vedi CHECKPOINT.md).

## Privacy e sicurezza

- **Nessuna telemetria**: nessun dato lascia il browser.
- **Nessun segreto nel codice**: audit statico completo e documentato in [`docs/AUDIT-SICUREZZA.md`](docs/AUDIT-SICUREZZA.md); le chiavi API, se l'utente le configura, vivono solo nel `chrome.storage` **locale**.
- **Permessi minimi** richiesti dal manifest, con giustificazioni pronte per la revisione in [`PUBBLICAZIONE.md`](PUBBLICAZIONE.md).
- **Informativa privacy** pubblica: [`docs/privacy-policy.html`](docs/privacy-policy.html).
- **Segnalazioni di sicurezza**: disclosure privata via [`SECURITY.md`](SECURITY.md) (GitHub Security Advisories).

## Roadmap

Tracciata in [`ROADMAP.md`](ROADMAP.md):

1. Fase 1 — soft launch su GitHub (repo pubblico, Release con lo zip, Pages); Fase 2 — Chrome Web Store dopo la validazione (Chrome-only, AMO rimandato);
2. Licenza: **MIT, scelta e applicata** (2026-11-24); modello freemium da definire;
3. Test di regressione sulla memoria residua nelle conversazioni lunghe;
4. Web app companion: resta separata; vetrina statica + privacy policy già estratte in `docs/`.

## Licenza

Distribuito con **licenza MIT** — vedi il file [LICENSE](LICENSE).
© 2026 DevourLabs. Le note dell'informativa privacy restano valide per ogni uso del codice.
