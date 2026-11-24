# Roadmap — MindFlow v1.2.2

Stato di riferimento: v1.2.2 «La porta si corregge da sola» (2026-11-24), suite di test verde.
Vedi anche [CHECKPOINT](mindflow-extension/CHECKPOINT.md) e [README](README.md).

> Suggerimento: ogni voce può diventare una issue GitHub (*New issue*), copiando titolo e checklist.

## 1. Pubblicazione su Chrome Web Store e Firefox AMO

- [ ] Rigenerare le icone PNG (`python3 scripts/make-extension-icons.py`) e includerle nel pacchetto
- [ ] Packaging con `scripts/build-extension.sh` (attenzione: contiene percorsi assoluti dell'ambiente originale `/home/z/my-project/...`, adattarli prima)
- [ ] Account sviluppatore: Chrome Web Store (quota una tantum di iscrizione) e addons.mozilla.org (gratuito)
- [ ] Materiali per lo store: descrizioni, screenshot e anteprime (script `scripts/shot-*`)
- [ ] Informativa privacy per lo store: nessuna telemetria, nessun dato raccolto, chiavi API solo in `chrome.storage` locale, endpoint LLM locale configurabile dall'utente
- [ ] Inviare e completare la revisione (su AMO il pacchetto viene firmato; su CWS può richiedere alcuni giorni)

Note: il piano dettagliato di deploy, visibilità e monetizzazione è nel documento locale «MindFlow-Piano-Deploy-Visibilita-Monetizzazione-v1.2.2.pdf» (non versionato nel repository).

## 2. Decidere licenza e modello freemium

- [ ] Scegliere la licenza (open source MIT / Apache-2.0 / GPL-3.0 con file LICENSE, oppure distribuzione proprietaria) — la sezione «Licenza» del README è attualmente «da definire»
- [ ] Definire il modello freemium: cosa resta gratuito (il core locale attuale) ed eventuali funzionalità premium, in coerenza con il principio «tutto in locale, nessun dato fuori dal browser»
- [ ] Allineare README, store listing ed eventuale pagina prodotto

Collegato al piano di visibilità e monetizzazione v1.2.2.

## 3. Test di regressione: memoria residua nelle conversazioni lunghe

- [ ] Conversazione lunga con molti turni nella stessa sessione
- [ ] Chiusura e riapertura del pannello a metà conversazione
- [ ] Cambio scheda / navigazione durante la conversazione
- [ ] Cambio endpoint o modello a metà sessione
- [ ] Reset/cancella sessione: verificare che lo storico non compaia nella sessione nuova
- [ ] Aggiungere uno scenario automatizzato in `scripts/` (stile dei `test-*.js` esistenti)

Baseline attuale (v1.2.2): suite verde — `test-engine-client.js` 20/20, `test-port-autofix.js` 14/14, `test-autodetect.js` 4/4 scenari.

## 4. Web app companion (Next.js): includerla o mantenerla separata?

- [ ] Decidere se inserirla nel repository (es. sotto `webapp/`, con README dedicato e build separata) o tenerla in un repository a parte
- [ ] Definire cosa condividere tra estensione e web app (interfaccia engine-client, tipi, mock)
- Nota: `.gitignore` già copre `node_modules/` e `.next/`
