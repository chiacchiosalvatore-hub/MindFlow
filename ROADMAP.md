# Roadmap — MindFlow v1.2.2

Stato di riferimento: v1.2.2 «La porta si corregge da sola» (2026-11-24), suite di test verde.
Vedi anche [CHECKPOINT](mindflow-extension/CHECKPOINT.md) e [README](README.md).

> Suggerimento: ogni voce può diventare una issue GitHub (*New issue*), copiando titolo e checklist.

## 1. Pubblicazione: Chrome Web Store al lancio — Firefox AMO rimandato

**Deciso (24/11/2026): il lancio avviene SOLO su Chrome Web Store.** La variante
Firefox non è ancora stata provata dall'autore, quindi NON viene pubblicata
finché non lo è: il build `mindflow-extension-firefox-v1.2.2.zip` resta pronto
in locale e la voce AMO si riapre dopo una prova reale (vedi [PUBBLICAZIONE.md](PUBBLICAZIONE.md)).

Aggiornamento (25/11/2026): il lancio procede in **due fasi** — prima il soft
launch su GitHub (§ 1-bis), poi l'invio a CWS una volta validato l'interesse.

- [x] Icone PNG incluse nel repository e nel pacchetto (`mindflow-extension/icons/`, rigenerabili con `python3 scripts/make-extension-icons.py` — script ora portabile)
- [x] `scripts/build-extension.sh` reso portabile (24/11/2026, audit): percorsi relativi, zip Chrome e Firefox generati senza adattamenti
- [ ] Account sviluppatore Chrome Web Store: quota una tantum di 5 USD + dichiarazione trader/non-trader (DSA UE: chi vende è «trader» ed esibisce in scheda nome, telefono SMS-verificato e indirizzo; lancio gratuito senza monetizzazione → «non-trader» dichiarabile)
- [ ] Materiali per lo store: descrizioni (breve 132 caratteri + estesa), 1-5 screenshot 1280x800, GIF demo 45-60 s (script `scripts/shot-*`; una schermata reale è già incorporata nella vetrina `docs/index.html`)
- [x] Informativa privacy pronta: `docs/privacy-policy.html` — pubblica su GitHub Pages (URL: `https://chiacchiosalvatore-hub.github.io/MindFlow/privacy-policy.html` appena attivate Pages)
- [x] Giustificazione dei permessi per la revisione — tabella in [PUBBLICAZIONE.md](PUBBLICAZIONE.md) §5, audit documentato in [docs/AUDIT-SICUREZZA.md](docs/AUDIT-SICUREZZA.md)
- [ ] Inviare e completare la revisione CWS (durata variabile, indicativamente da pochi giorni in su)

Note: il piano dettagliato di deploy, visibilità e monetizzazione è nel documento locale «MindFlow-Piano-Deploy-Visibilita-Monetizzazione-v1.2.2.pdf» (non versionato nel repository).

## 1-bis. Soft launch su GitHub — Fase 1 (deciso 25/11/2026)

**Deciso (25/11/2026): il primo lancio avviene SOLO su GitHub.** Gli utenti
scaricano lo zip dalle Release e lo caricano «unpacked» in Chrome; vetrina e
privacy policy vanno online con GitHub Pages. Dopo 1-2 settimane si leggono i
segnali e si decide l'invio CWS (§ 1).

- [x] README: sezione «Installazione per utenti» (zip da Releases → «Carica estensione non pacchettizzata»)
- [x] Vetrina `docs/index.html`: CTA «Scarica la beta», sezione installazione beta, screenshot reale ripristinato (percorso corretto)
- [x] [PUBBLICAZIONE.md](PUBBLICAZIONE.md): strategia in due fasi documentata
- [ ] Rendere il repository pubblico (azione da dashboard dell'autore)
- [ ] Attivare GitHub Pages: Settings → Pages → «Deploy from a branch» → `main` → `/docs` (azione da dashboard, una sola volta)
- [ ] Creare la Release `v1.2.2` e caricare `mindflow-extension-v1.2.2.zip` (zip già pronto in locale, 166 KB)
- [ ] Post di lancio: Show HN, r/LocalLLaMA, r/chrome_extensions, community IT — **testi pronti in [docs/POST-LANCIO.md](docs/POST-LANCIO.md)** (pubblicazione manuale dell'autore, solo dopo Release + Pages attivi)
- [ ] Recensione dei segnali (Insights → Traffic: visitatori unici e cloni, star, issue) e decisione go/no-go per CWS
- [ ] (Durante la finestra di validazione) Localizzazione inglese v1.3 — piano dettagliato in [docs/PIANO-I18N-INGLESE.md](docs/PIANO-I18N-INGLESE.md)

Guida passo-passo delle azioni da dashboard (public, Pages, Release, con template
della descrizione della Release): [docs/GUIDA-DASHBOARD.md](docs/GUIDA-DASHBOARD.md).

Nota: la GIF demo (45-60 s, storyboard in PUBBLICAZIONE.md § 3) entra in README
e vetrina non appena l'autore la registra; nel frattempo la vetrina usa uno
screenshot reale.

## 2. Licenza: MIT — scelta e applicata (24/11/2026)

- [x] **Licenza scelta: MIT** — file [LICENSE](LICENSE) alla radice (© 2026 DevourLabs)
- [x] Sezione «Licenza» del README aggiornata
- [ ] Allineare la scheda store (descrizione e campo licenza) al momento dell'invio CWS
- [ ] Definire il modello freemium: cosa resta gratuito (il core locale attuale) ed eventuali funzionalità premium, in coerenza con il principio «tutto in locale, nessun dato fuori dal browser»

Razionale della scelta (sintesi dell'analisi, conservata come riferimento): MIT per
massima adozione e zero attriti con la comunità local-LLM, coerente col modello
«open source + donazioni»; il rischio di fork chiusi è mitigato dalla manutenzione
visibile e dalla community. Apache-2.0 restava sensata per contributi aziendali
(brevetti); GPL-3.0 proteggeva da fork chiusi ma con attrito d'adozione;
proprietaria scartata per incompatibilità col posizionamento «codice verificabile».
La raccomandazione operativa resta: open source + donazioni al lancio, edizione
Pro una tantum (15-29 €, da validare) solo a domanda misurata.

Collegato al piano di visibilità e monetizzazione v1.2.2.

## 3. Test di regressione: memoria residua nelle conversazioni lunghe

- [ ] Conversazione lunga con molti turni nella stessa sessione
- [ ] Chiusura e riapertura del pannello a metà conversazione
- [ ] Cambio scheda / navigazione durante la conversazione
- [ ] Cambio endpoint o modello a metà sessione
- [ ] Reset/cancella sessione: verificare che lo storico non compaia nella sessione nuova (fatto, vedi sotto)
- [x] Aggiungere uno scenario automatizzato in `scripts/` (stile dei `test-*.js` esistenti) — **fatto: `scripts/test-memoria-residua.js`, 24 asserzioni** (24/11/2026): conversazione lunga a molti poll, chiusura/riapertura del pannello, cambio scheda (convKey), cambio endpoint/modello via `storage.onChanged`, reset con doppio clic (isolamento dell'altra chat e nessun residuo nello storage)

Baseline attuale (v1.2.2): suite verde — `test-engine-client.js` 20/20, `test-port-autofix.js` 14/14, `test-autodetect.js` 4/4 scenari, `test-memoria-residua.js` 24/24.

## 4. Web app companion (Next.js): resta separata

Stato (24/11/2026): analisi svolta. La webapp esiste (Next.js 16: chat, grafo,
checkpoint, impostazioni, API summarize/chat) ma NON serve per il lancio —
l'estensione è autonoma e il posizionamento è «nessun server». Verdetto:
**resta separata**, fuori dal repository del lancio. I tre usi concreti riconosciuti:

1. **Vetrina + privacy policy**: pagina statica (GitHub Pages) con la frase di posizionamento, gli screenshot, i link store/repo e l'URL dell'informativa privacy richiesta da CWS — costo zero, nessun backend.
2. **Demo «prova nel browser»**: opzionale come seconda vetrina DOPO il lancio, non è un requisito dello store.
3. **Portale Pro (sincronizzazione cifrata)**: solo se la voce freemium diventa Go — in quel caso cambia il perimetro privacy/GDPR e va ridichiarato tutto.

- [x] (Al lancio) Estratta la pagina statica vetrina+privacy policy: `docs/index.html` (screenshot reale incorporato, zero dipendenze esterne) e `docs/privacy-policy.html` — NON l'intera webapp
- [ ] Attivare GitHub Pages: Settings → Pages → «Deploy from a branch» → branch `main`, cartella `/docs` (azione da dashboard, una sola volta — tracciato anche in § 1-bis)
- [ ] (Post-lancio, opzionale) Pubblicare la demo web come playground
- [ ] (Solo Go Pro) Definire cosa condividere tra estensione e web app (interfaccia engine-client, tipi, mock)

Nota: `.gitignore` già copre `node_modules/` e `.next/`.

## 5. Apertura del repository al pubblico

Preparazione svolta il 24/11/2026 con l'audit statico completo
([docs/AUDIT-SICUREZZA.md](docs/AUDIT-SICUREZZA.md)):

- [x] Audit di sicurezza statico su tutti i file: nessun segreto, nessun codice dinamico, nessun dato personale, messaggi validati, chiavi solo in `storage.local` — esiti in `docs/AUDIT-SICUREZZA.md`
- [x] 3 script di build/QA resi portabili (percorsi relativi, verificati in esecuzione)
- [x] [`SECURITY.md`](SECURITY.md) con policy di disclosure privata (Security Advisories)
- [x] `LICENSE` MIT + README aggiornato
- [x] `.gitignore` verifica: copre `.env`, `node_modules/`, build, log (i file PDF/DOCX/zip di distribuzione restano fuori dal repository)
- [ ] Rendere il repository pubblico (Settings → General → Danger Zone → «Change visibility») — azione da dashboard dell'autore
- [ ] Suggerito: description e topics del repo (`browser-extension`, `local-llm`, `ollama`, `chatgpt`, `memory`, `mit-license`)
