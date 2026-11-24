# Pubblicazione — Chrome Web Store (lancio Chrome-only)

Decisione del 24/11/2026: il lancio avviene SOLO su Chrome Web Store.
La variante Firefox non è stata provata dall'autore, quindi NON viene pubblicata
finché non lo è: il build `mindflow-extension-firefox-v1.2.2.zip` resta pronto
in locale e la voce AMO si riapre dopo una prova reale (§ 7).

Base di partenza: v1.2.2 «La porta si corregge da sola», suite di test verde
(oltre 200 asserzioni). Il piano completo di visibilità, lancio e monetizzazione
è nel documento «MindFlow-Piano-Deploy-Visibilita-Monetizzazione-v1.2.2.pdf».

## 1. Dichiarazione trader / non-trader (DSA) — prima di tutto

Google chiede a OGNI sviluppatore CWS di dichiararsi «trader» o «non-trader»
(Direttiva sui servizi digitali UE). In sintesi, per il lancio dall'Italia:

- **Lancio gratuito, senza prezzi né funzioni a pagamento** → dichiarazione
  «non-trader» possibile: nessuna verifica d'identità aziendale, nessun dato
  esibito in scheda. È il caso del lancio consigliato (open source + donazioni).
- **Prezzi, edizione Pro o vendita diretta** → si è «trader»: Google verifica
  NOME legale, TELEFONO (capace di ricevere SMS) e INDIRIZZO, e li esibisce
  PUBBLICAMENTE in fondo alla scheda dello store.
- Le donazioni volontarie (GitHub Sponsors / Ko-fi) da sole non sono, in linea
  di principio, un'attività commerciale; se il progetto inizia a monetizzare
  davvero, la dichiarazione va ripresa. In caso di dubbio, «trader» è la via
  più prudente.

## 2. Account e costi

| Voce | Dettaglio |
| --- | --- |
| Account sviluppatore CWS | quota una tantum di 5 USD (una sola volta per account, non annuale) |
| Email | consigliata un'email dedicata: lì arrivano le comunicazioni di revisione |
| Altri costi | zero: repo GitHub gratuito, landing statica gratuita |

## 3. Asset da produrre (in ordine di priorità)

1. **GIF demo di 45-60 s** (muta): chat lunga aperta → «Costruisci il grafo»
   con l'orologio dei secondi visibile → grafo che si popola a scaletta →
   «Compila» col confronto contesto compilato/chat intera → «Copia» → nuova
   chat con la memoria incollata. Chiusura con la frase di posizionamento.
   Si riusa nel README, nello store e nei canali di lancio.
2. **1-5 screenshot 1280x800**: pannello con grafo completo, dettaglio
   checkpoint, impostazioni con test di connessione riuscito, confronto
   «Compila».
3. **Privacy policy con URL pubblico** (pagina statica / GitHub Pages): una
   pagina che dichiari nessun server, nessuna telemetria, nessuna raccolta,
   l'uso dei permessi (tabella del § 5) e come revocare (disinstallazione).
4. **Testi store IT+EN**: nome breve; descrizione breve di 132 caratteri;
   descrizione estesa con la frase di posizionamento («La memoria delle tue
   chat AI, sul tuo computer…») e i quattro differenziatori; categoria
   consigliata: Produttività.
5. **Icona 128x128**: già esistente (`mindflow-extension/icons/icon-128.png`).

## 4. Pacchetto

- Zip Chrome pronto: `mindflow-extension-v1.2.2.zip` (la variante Firefox NON
  fa parte di questa fase).
- Manifest MV3 già conforme: nessun codice remoto, nessuno script o CSS
  esterno, nessun eval/Function dinamico, risorse web accessibili solo locali.
- Attenzione build: `scripts/build-extension.sh` contiene percorsi assoluti
  dell'ambiente originale (`/home/z/my-project/...`); adattarli prima di
  rigenerare lo zip. Le icone si rigenerano con
  `python3 scripts/make-extension-icons.py`.

## 5. Giustificazione dei permessi (da incollare in fase di revisione)

| Permesso | Perché serve | Nota per la scheda |
| --- | --- | --- |
| storage | Salvare impostazioni motore e grafi dei checkpoint nel browser | Dati solo nel dispositivo, eliminabili rimuovendo l'estensione |
| clipboardWrite | Il tasto «Copia» del contesto compilato | Attivato solo al click dell'utente |
| scripting | Iniettare la cattura dello stream di rete laddove il CSP della pagina lo richiede | Serve per leggere le risposte del chatbot nella pagina stessa |
| Content script su tutti i siti | La pillola «modalità pagina» deve potere comparire su wiki, articoli, documentazione | La lettura avviene nel browser: nessun dato inviato, tranne al motore configurato |
| host_permissions localhost | Collegarsi ai motori locali (Ollama, LM Studio, llama.cpp, vLLM…) | Richieste verso 127.0.0.1/localhost soltanto |
| host cloud (api.openai.com, api.anthropic.com) e siti chat | API cloud configurate dall'utente con la sua chiave; le chat da leggere | Chiavi solo in chrome.storage.local, mai nei log |

Nel tab «Privacy practices» del dashboard: dichiarare che NON vengono raccolti
dati personali né dati d'uso; nessuna pubblicità; nessun codice eseguito da
remoto. L'informativa privacy (asset 3 del § 3) va linkata dove richiesto.

## 6. Invio e revisione

1. Dashboard sviluppatore → «Nuovo elemento» → carica lo zip.
2. Compila le schede: Store listing (asset del § 3), Privacy (tabella del
   § 5), Distribuzione: pubblico.
3. Submit → revisione: durata variabile (indicativamente da pochi giorni,
   tendenzialmente più lunga per i prodotti con permessi «tutti i siti»); in
   caso di rifiuto la scheda torna con la motivazione e si può re-inviare.
4. All'approvazione: il link store entra nel README e nella landing; poi parte
   il calendario di lancio del piano (Show HN, r/LocalLLaMA, Product Hunt).

## 7. Firefox AMO — solo dopo una prova reale

Condizioni per riaprire la voce (tracciata in ROADMAP):

- [ ] La variante Firefox (`mindflow-extension-firefox-v1.2.2.zip`) è stata installata e provata dall'autore su una chat reale (raccolta, grafo, compila)
- [ ] Eventuali fix specifici Firefox applicati e testati
- [ ] Account Mozilla gratuito + privacy policy (riuso della stessa) + scheda AMO

Su AMO il pacchetto viene firmato da Mozilla alla pubblicazione; nessun costo
di registrazione.
