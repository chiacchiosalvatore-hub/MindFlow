# Piano di localizzazione inglese — v1.3 (valutazione del 25/11/2026)

Domanda dell'autore: «vale la pena portare l'applicazione anche in inglese,
senza rompere nulla e senza perdere il lavoro fatto finora?»

## Verdetto in una riga

**Sì all'inglese — ma come v1.3 dentro la finestra di validazione (1-2 settimane
post-lancio), NON adesso sul lancio.** La v1.2.2 e lo zip della Release restano
congelati; l'inglese si costruisce in un branch separato con la suite di test
come rete di sicurezza.

## Perché sì (dati)

- I canali di lancio della Fase 1 (Show HN, r/LocalLLaMA, r/chrome_extensions)
  hanno un pubblico quasi tutto inglese: la prima impressione in inglese
  moltiplica installazioni e star.
- Per la Fase 2 (Chrome Web Store) la localizzazione EN è quasi obbligatoria:
  la scheda store in inglese con UI italiana peggiorerebbe il tasso di
  conversione e genererebbe disinstallazioni immediate.
- La vetrina è già «EN-friendly» (sintesi inglese nel README, sezione
  «English summary (beta)»), quindi il traffico EN non trova muro al primo
  contatto mentre la v1.3 si prepara.

## Perché non adesso (misura del rischio)

Ricerca sul codice (grep guidato, 25/11/2026) sui file dell'estensione:

| File | Righe con testo italiano |
| --- | --- |
| panel.js | 105 |
| engine-client.js | 42 |
| content.js | 36 |
| options.js | 35 |
| background.js | 35 |
| adapters.js | 28 |
| options.html | 17 |
| panel.html | 16 |
| net-capture.js, popup.*, css, manifest | ~27 |
| **Totale codice** | **≈ 340 righe** (stima 250-400 stringhe utente reali) |

(Le occorrenze precise si misurano in fase di estrazione; molte righe contengono
più stringhe, alcune sono commenti.)

Tre motivi per non farlo 1 giorno prima del lancio:

1. **La UI non basta: c'è la lingua dei prompt.** I prompt inviati al modello
   (planner, riassunti, capitoli) sono in italiano: con la UI tradotta ma i
   prompt italiani, il grafo continuerebbe a uscire in italiano e l'utente EN
   percepirebbe il prodotto come «mezzi tradotto». Serve anche un interruttore
   «lingua di output» nelle impostazioni.
2. **~20 file da toccare senza test browser reali qui**: il rischio di introdurre
   una regressione è esattamente ciò che si vuole evitare («senza rompere nulla»).
3. **Il lancio misura i segnali**: rilasciare la v1.2.2 identica a quella
   testata (suite verde: 20/20, 14/14, 4/4, 24/24) è la variante a rischio zero;
   la v1.3 nasce protetta nel branch.

## Approccio consigliato: `chrome.i18n` (standard MV3)

- `manifest.json`: aggiungere `"default_locale": "it"` (nessun permesso nuovo).
- `_locales/it/messages.json`: **estrarre TUTTE** le stringhe italiane qui — è
  la rete di sicurezza: una chiave mancante nel locale secondario (en) ricade
  sul default (it), quindi nessuna stringa può sparire.
- `_locales/en/messages.json`: la traduzione.
- Nei file HTML: i testi si sostituiscono con `__MSG_chiave__` (funziona anche
  in `title` e `aria-label`, che in panel.html sono già italiani e numerosi).
- Nei JS: `chrome.i18n.getMessage('chiave')`; per i prompt (testi lunghi con
  variabili) si usano i placeholder `$1`, `$2` di `messages.json`.
- La lingua si seleziona automaticamente con la lingua del browser
  (`chrome.i18n.getUILanguage()`): nessun interruttore obbligatorio, ma si può
  aggiungere una preferenza manuale «Lingua interfaccia: auto/IT/EN» nelle
  opzioni (facoltativo, v1.3.1).

Alternativa scartata: dizionario JS custom (`i18n.js` + attributi `data-i18n`) —
più controllo ma reinventa ciò che `chrome.i18n` fa nativamente e aggiunge codice
proprio dove serve zero rischio.
Alternativa scartata: tradurre solo la vetrina — insufficiente, l'utente EN che
installa troverebbe la UI italiana e disinstallerebbe.

## Piano operativo (branch `feat/i18n-en`, 4 fasi)

1. **Congelamento**: la v1.2.2 pubblicata non si tocca più; il branch parte da `main`.
2. **Fase A — estrazione IT (meccanica)**: estrarre le stringhe file per file in
   `_locales/it/messages.json`, sostituire nei sorgenti, girare la suite dei
   test dopo OGNI file (`node scripts/test-panel-boot.js`, `test-adapters-dom.js`,
   `check-options-dom.js`, `test-integration.js`…): se un test cade, si sa
   esattamente quale file l'ha rotto.
3. **Fase B — traduzione EN**: `_locales/en/messages.json` + boot del pannello
   con browser in inglese.
4. **Fase C — lingua di output dei prompt**: opzione «Lingua del grafo/riassunti:
   IT/EN» nelle impostazioni che seleziona il set di prompt (placeholder in
   `messages.json`); default: lingua del browser.
5. **Fase D — release v1.3.0**: zip nuovo, README/vetrina aggiornati, niente più
   nota «UI solo italiana» nei post successivi.

Checklist di non-regressione (prima di dichiarare la v1.3 pronta):

- [ ] tutti i test esistenti verdi (`node scripts/test-*.js`)
- [ ] pannello, popup e opzioni sfogliati con browser impostato in IT **e** in EN
- [ ] `grep` finale: nessuna stringa utente hardcoded rimasta fuori da
      `_locales/` (restano ammessi solo commenti e log)
- [ ] grafo compilato in entrambe le lingue di output
- [ ] le sessioni salvate della v1.2.2 si riaprono correttamente in v1.3

Stima onesta: 2-3 sessioni di lavoro (~1 giornata effettiva), senza contare la
traduzione vera e propria che è la parte meccanica più rapida.

## Cosa NON cambia (il lavoro fatto finora resta intatto)

- Struttura storage, grafi e sessioni già salvate: nessuna migrazione necessaria.
- Permessi del manifest: invariati (solo il campo `default_locale`).
- Endpoint, engine-client, autofix porta: invariati.
- La vetrina `docs/` e la privacy policy: invariati (l'inglese arriva già oggi
  nel README, la traduzione completa della vetrina è opzionale in v1.3).

Tracciato anche in ROADMAP.md § 1-bis come attività della finestra di validazione.
