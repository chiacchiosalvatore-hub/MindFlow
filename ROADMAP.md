# Roadmap — MindFlow v1.2.2

Stato di riferimento: v1.2.2 «La porta si corregge da sola» (2026-11-24), suite di test verde.
Vedi anche [CHECKPOINT](mindflow-extension/CHECKPOINT.md) e [README](README.md).

> Suggerimento: ogni voce può diventare una issue GitHub (*New issue*), copiando titolo e checklist.

## 1. Pubblicazione: Chrome Web Store al lancio — Firefox AMO rimandato

**Deciso (24/11/2026): il lancio avviene SOLO su Chrome Web Store.** La variante
Firefox non è ancora stata provata dall'autore, quindi NON viene pubblicata
finché non lo è: il build `mindflow-extension-firefox-v1.2.2.zip` resta pronto
in locale e la voce AMO si riapre dopo una prova reale (vedi [PUBBLICAZIONE.md](PUBBLICAZIONE.md)).

- [ ] Rigenerare le icone PNG (`python3 scripts/make-extension-icons.py`) e includerle nel pacchetto
- [ ] Packaging con `scripts/build-extension.sh` (attenzione: contiene percorsi assoluti dell'ambiente originale `/home/z/my-project/...`, adattarli prima)
- [ ] Account sviluppatore Chrome Web Store: quota una tantum di 5 USD + dichiarazione trader/non-trader (DSA UE: chi vende è «trader» ed esibisce in scheda nome, telefono SMS-verificato e indirizzo; lancio gratuito senza monetizzazione → «non-trader» dichiarabile)
- [ ] Materiali per lo store: descrizioni (breve 132 caratteri + estesa), 1-5 screenshot 1280x800, GIF demo 45-60 s (script `scripts/shot-*`)
- [ ] Informativa privacy per lo store: nessuna telemetria, nessun dato raccolto, chiavi API solo in `chrome.storage` locale, endpoint LLM locale configurabile dall'utente (serve un URL pubblico: pagina statica / GitHub Pages)
- [ ] Giustificazione dei permessi per la revisione (storage, clipboardWrite, scripting, content script «tutti i siti», host localhost+API cloud) — tabella pronta in [PUBBLICAZIONE.md](PUBBLICAZIONE.md)
- [ ] Inviare e completare la revisione CWS (durata variabile, indicativamente da pochi giorni in su)

Note: il piano dettagliato di deploy, visibilità e monetizzazione è nel documento locale «MindFlow-Piano-Deploy-Visibilita-Monetizzazione-v1.2.2.pdf» (non versionato nel repository).

## 2. Decidere licenza e modello freemium

- [ ] Scegliere la licenza (open source MIT / Apache-2.0 / GPL-3.0 con file LICENSE, oppure distribuzione proprietaria) — la sezione «Licenza» del README è attualmente «da definire»
- [ ] Definire il modello freemium: cosa resta gratuito (il core locale attuale) ed eventuali funzionalità premium, in coerenza con il principio «tutto in locale, nessun dato fuori dal browser»
- [ ] Allineare README, store listing ed eventuale pagina prodotto

Stato (24/11/2026): scelta in corso, opzioni a confronto —

- **MIT** (raccomandata per il lancio): massima adozione, zero attriti con la
  comunità local-LLM, coerente col modello «open source + donazioni» del piano;
  rischio: fork chiusi possibili, mitigato dalla manutenzione visibile e dalla
  community.
- **Apache-2.0**: come MIT ma con clausola esplicita sui brevetti e obbligo di
  conservare i notice; sensata se aziende potessero contribuire, peso
  burocratico leggermente superiore.
- **GPL-3.0**: chi distribuisce derivati deve mantenerli liberi (protezione
  contro fork chiusi); l'uso commerciale resta libero — buona difesa se in
  futuro nasce un'edizione Pro da proteggere.
- **Proprietaria**: incompatibile con il posizionamento «codice verificabile»
  del pubblico privacy — da evitare al lancio.

La raccomandazione operativa del piano resta: open source + donazioni al
lancio, edizione Pro una tantum (15-29 €, da validare) solo a domanda misurata.
Quando la licenza è scelta: aggiungere `LICENSE` alla radice del repo,
aggiornare la sezione «Licenza» del README e la scheda store.

Collegato al piano di visibilità e monetizzazione v1.2.2.

## 3. Test di regressione: memoria residua nelle conversazioni lunghe

- [ ] Conversazione lunga con molti turni nella stessa sessione
- [ ] Chiusura e riapertura del pannello a metà conversazione
- [ ] Cambio scheda / navigazione durante la conversazione
- [ ] Cambio endpoint o modello a metà sessione
- [ ] Reset/cancella sessione: verificare che lo storico non compaia nella sessione nuova (fatto, vedi sotto)
- [x] Aggiungere uno scenario automatizzato in `scripts/` (stile dei `test-*.js` esistenti) — **fatto: `scripts/test-memoria-residua.js`, 24 asserzioni** (24/11/2026): conversazione lunga a molti poll, chiusura/riapertura del pannello, cambio scheda (convKey), cambio endpoint/modello via `storage.onChanged`, reset con doppio clic (isolamento dell'altra chat e nessun residuo nello storage)

Baseline attuale (v1.2.2): suite verde — `test-engine-client.js` 20/20, `test-port-autofix.js` 14/14, `test-autodetect.js` 4/4 scenari, `test-memoria-residua.js` 24/24 (nuovo).

## 4. Web app companion (Next.js): includerla o mantenerla separata?

Stato (24/11/2026): analisi svolta. La webapp esiste (Next.js 16: chat, grafo,
checkpoint, impostazioni, API summarize/chat) ma NON serve per il lancio —
l'estensione è autonoma e il posizionamento è «nessun server». Verdetto
consigliato: **resta separata**, fuori dal repository del lancio. I tre usi
concreti riconosciuti:

1. **Vetrina + privacy policy**: solo una pagina statica (GitHub Pages o host
   statico) con la frase di posizionamento, la GIF demo, i link store/repo e
   l'URL dell'informativa privacy richiesta da CWS — costo zero, nessun backend.
2. **Demo «prova nel browser»**: opzionale come seconda vetrina DOPO il lancio,
   non è un requisito dello store.
3. **Portale Pro (sincronizzazione cifrata)**: solo se la voce freemium diventa
   Go (giorni 61-90 del piano) — in quel caso cambia il perimetro privacy/GDPR
   e va ridichiarato tutto.

- [ ] (Al lancio) Estrarre la pagina statica vetrina+privacy policy, NON l'intera webapp
- [ ] (Post-lancio, opzionale) Pubblicare la demo web come playground
- [ ] (Solo Go Pro) Definire cosa condividere tra estensione e web app (interfaccia engine-client, tipi, mock)

Nota: `.gitignore` già copre `node_modules/` e `.next/`.
