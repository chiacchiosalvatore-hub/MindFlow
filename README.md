# MindFlow — DevourLabs

> Estensione browser (Chrome / Firefox) per interagire con un **LLM locale** (compatibile Ollama) direttamente dalla pagina, senza servizi esterni, senza telemetria e senza chiavi nel codice.

**Versione corrente: v1.2.2 — «La porta si corregge da sola»** — stato di allineamento al 2026-11-24, vedi [`mindflow-extension/CHECKPOINT.md`](mindflow-extension/CHECKPOINT.md).

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
  README.md                  # guida dell'estensione
  INSTALLAZIONE.md           # installazione passo-passo
  CHECKPOINT.md              # stato progetto v1.2.2
scripts/                     # test automatici + utility build/QA
  test-*.js                  # suite di test (engine, adapter, porta, rete, ...)
  build-extension.sh         # script di build/packaging
  make-extension-icons.py    # rigenera le icone PNG
  mock-local-llm.js          # finto endpoint LLM per i test
  check-*.js / shot-*        # QA DOM e screenshot
```

**Non inclusi nel repository** (vedi note):
- le **icone PNG** (`mindflow-extension/icons/`, file binari): si rigenerano con `python3 scripts/make-extension-icons.py`;
- la **web app companion Next.js**: sviluppata a parte, decisione di inclusione tracciata in issue;
- i documenti di distribuzione PDF/DOCX (piano di deploy ecc.).

## Dopo il clone

1. Rigenera le icone: `python3 scripts/make-extension-icons.py` (crea `mindflow-extension/icons/icon-16/32/48/128.png`).
2. Carica l'estensione: `chrome://extensions` → modalità sviluppatore → **Carica unpacked** → seleziona `mindflow-extension/`. Su Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on**.
3. Avvia il modello locale (es. Ollama) e apri il pannello MindFlow.
4. Guida completa: [`mindflow-extension/INSTALLAZIONE.md`](mindflow-extension/INSTALLAZIONE.md).

> Nota: `scripts/build-extension.sh` e `scripts/make-extension-icons.py` contengono percorsi assoluti dell'ambiente di sviluppo originale (`/home/z/my-project/...`); adattarli al proprio ambiente.

## Test

I test girano con Node.js, senza dipendenze da installare:

```bash
node scripts/test-engine-client.js    # 20/20
node scripts/test-port-autofix.js     # 14/14 (autofix porta 1234→1235)
node scripts/test-autodetect.js       # 4/4 scenari di autodetect endpoint
node scripts/test-panel-boot.js       # boot del pannello
# ... e gli altri test-*.js in scripts/
```

Stato allineamento v1.2.2: **tutti verdi** (vedi CHECKPOINT.md).

## Privacy e sicurezza

- **Nessuna telemetria**: nessun dato lascia il browser.
- **Nessun segreto nel codice**: audit di sicurezza su 5 livelli completato; le chiavi API, se l'utente le configura, vivono solo nel `chrome.storage` locale.
- **Permessi minimi** richiesti dal manifest.
- Endpoint del modello configurabile e verificabile dall'utente (`net-capture.js` per la diagnostica).

## Roadmap

Tracciata nelle issue del repository:

1. Pubblicazione su Chrome Web Store e Firefox AMO;
2. Decisione licenza + modello freemium;
3. Test di regressione sulla memoria residua nelle conversazioni lunghe;
4. Eventuale inclusione della web app companion nel repository.

## Licenza

Da definire — vedi issue dedicata.
