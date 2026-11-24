# Guida passo-passo — azioni da dashboard GitHub (Fase 1)

Ultimo aggiornamento: 25/11/2026. Tutte le azioni si fanno dal browser sulla
pagina github.com del repository: nessun terminale necessario (tranne l'opzione B
del Passo 3, se si preferisce lo script di build). Ordine consigliato:
**Passo 1 → Passo 2 → Passo 3 → post di lancio** ([docs/POST-LANCIO.md](POST-LANCIO.md)).
Tempo totale: ~15 minuti.

> **Conferma richiesta dall'autore: passando a public, il deploy di GitHub Pages è gratuito?**
> **Sì.** Per i repository pubblici Pages è incluso gratis in qualunque piano
> (anche Free). I limiti esistenti — ~100 GB/mese di banda e 10 build/ora, entrambi
> «soft limits» — sono irrisori per una vetrina. Con il repo privato invece
> serviva GitHub Pro (4 USD/mese) e le Release non erano scaricabili da terzi:
> passare a public risolve entrambi i problemi a costo zero.

## Passo 0 — Email privata (già fatto il 25/11/2026)

Settings → Emails → «Keep my email addresses private» attivo. I commit nuovi
useranno l'indirizzo noreply; quelli vecchi già spinti conservano l'email
precedente come metadata — non è un rischio di sicurezza, solo un dettaglio
visibile nella pagina dei commit.

## Passo 1 — Rendere il repository pubblico

1. Apri https://github.com/chiacchiosalvatore-hub/MindFlow
2. **Settings** (tab in alto) → scorri fino a **Danger Zone** (in fondo alla
   pagina General)
3. **Change repository visibility** → **Change to public**
4. GitHub chiede conferma: digitare il nome completo del repo
   (`chiacchiosalvatore-hub/MindFlow`) nel campo richiesto →
   **I understand, change repository visibility**
5. Verifica: apri una **finestra privata/incognito** e visita
   `https://github.com/chiacchiosalvatore-hub/MindFlow` — deve apparire senza login.

Perché è sicuro: l'audit statico completo è verde
([docs/AUDIT-SICUREZZA.md](AUDIT-SICUREZZA.md)), `SECURITY.md` e `LICENSE` sono
al loro posto, il codice non contiene segreti né dati personali e l'email dei
commit è ormai privata.

## Passo 2 — Attivare GitHub Pages (vetrina + privacy policy)

1. Sempre in **Settings**, barra laterale sinistra, sezione **Code and
   automation** → **Pages**
2. Nel blocco **Build and deployment**:
   - **Source**: `Deploy from a branch` (NON «GitHub Actions»)
   - **Branch**: seleziona `main`; la seconda tenda (cartella) deve indicare
     **`/docs`** — è lì che si trovano vetrina e privacy policy
3. **Save**
4. Attendi 1-3 minuti: nel tab **Actions** compare il workflow
   «pages build and deployment» che passa da «In progress» a verde
5. Verifica:
   - `https://chiacchiosalvatore-hub.github.io/MindFlow/` → vetrina completa,
     con lo screenshot del grafo visibile
   - `https://chiacchiosalvatore-hub.github.io/MindFlow/privacy-policy.html` →
     informativa privacy (esattamente l'URL che la scheda CWS richiederà in Fase 2)
   - Se qualcosa non appare: **Ctrl+F5** (cache del browser); il primo deploy
     richiede qualche minuto

Risoluzione problemi:

| Sintomo | Causa probabile | Rimedio |
| --- | --- | --- |
| 404 sulla homepage | Source su «GitHub Actions» o cartella `/ (root)` | rifare il Passo 2 con `Deploy from a branch` + `/docs` |
| 404 su privacy-policy.html | nome file diverso | confrontare il nome esatto, tutto minuscolo |
| screenshot rotto | cache del browser | Ctrl+F5 |
| pagina non aggiornata dopo un push | il build richiede 1-2 minuti | tab Actions → attendere il check verde |

Costo: **0 €**. Ogni push futuro su `main` ridistribuisce la vetrina
automaticamente, qualche minuto dopo il push.

## Passo 3 — Creare la Release `v1.2.2` con lo zip dell'estensione

### 3.1 — Preparare lo zip (scegli UNA delle due opzioni)

**Opzione A — zip della cartella già caricata in Chrome** (la più semplice):

1. Prendi la cartella dell'estensione che hai caricato con «Carica estensione
   non pacchettizzata» (quella che contiene `manifest.json`)
2. Windows: clic destro sulla cartella → **Comprimi in file ZIP** ·
   macOS: clic destro → **Comprimi** · Linux: clic destro → Comprimi/Archivia
3. Rinomina il file in `mindflow-extension-v1.2.2.zip`

**Opzione B — script di build del repository** (riproducibile; richiede `bash`,
`zip` e `python3` — su Windows funziona in WSL, Git Bash potrebbe non avere `zip`):

```bash
cd MindFlow
bash scripts/build-extension.sh
```

Lo zip Chrome viene creato come `download/mindflow-extension-v1.2.2.zip`
(nel clone). Lo script genera anche la variante Firefox: **per questa Release
carica solo lo zip Chrome**, la variante Firefox resta per il test futuro.

**Checklist prima di caricarlo** (evita l'errore più comune):

- [ ] estrai lo zip in una cartella temporanea: `manifest.json` deve trovarsi
      al primo livello (non dentro due cartelle annidate)
- [ ] dentro `manifest.json` il campo `"version"` è `"1.2.2"`
- [ ] la cartella `icons/` è dentro lo zip

### 3.2 — Pubblicare la Release

1. Sulla pagina del repo → tab **Releases** (colonna destra) → **Draft a new
   release** (o «Create a new release»)
2. **Choose a tag**: digita `v1.2.2` → clicca **Create new tag: v1.2.2 on
   publish** (il target resta `main`)
3. **Release title**: `MindFlow v1.2.2 — Beta pubblica (Fase 1)`
4. **Describe this release**: incolla il template qui sotto
5. **Attach binaries**: trascina `mindflow-extension-v1.2.2.zip` nella casella
6. In fondo: spunta **Set as the latest release** → **Publish release**

Template descrizione (copia-incolla):

```markdown
**MindFlow v1.2.2 — «La porta si corregge da sola»** · prima beta pubblica (Fase 1)

Estensione Chrome (MV3) che divide le chat AI in capitoli semantici, le comprime
in checkpoint e costruisce un grafo di memoria riutilizzabile — tutto in locale,
zero telemetria, licenza MIT.

- Funziona con il tuo motore: Ollama, LM Studio, llama.cpp, vLLM (locale) oppure
  API cloud con la tua chiave; nessun server MindFlow, le chiavi restano nel browser
- Autodetect dell'endpoint e correzione automatica delle porte sbagliate (es. 1234→1235)
- Audit di sicurezza statico completo: docs/AUDIT-SICUREZZA.md

### Installazione (2 minuti)
1. Scarica lo zip in basso ed estrailo in una cartella definitiva
2. `chrome://extensions` → attiva **Modalità sviluppatore** → **Carica estensione non pacchettizzata** → seleziona la cartella estratta
3. Apri le opzioni di MindFlow e indica l'endpoint del motore

**English:** download the zip, unzip, then in `chrome://extensions` enable
Developer mode → *Load unpacked* → select the extracted folder. Full guide in the
[README](https://github.com/chiacchiosalvatore-hub/MindFlow#english-summary-beta).
Note: the UI is currently in Italian; English localization is planned (v1.3).

⚠️ Fuori store, Chrome mostra a ogni avvio l'avviso «modalità sviluppatore»:
comportamento normale, si chiude e non limita nulla. Per gli aggiornamenti:
scarica la nuova Release, estrai **sulla stessa cartella** e premi «Ricarica»
su chrome://extensions — impostazioni e grafi restano al loro posto.
```

### 3.3 — Verifica finale (come farebbe un utente esterno)

- [ ] scarica lo zip **dalla pagina della Release** appena pubblicata
- [ ] estrai e controlla `manifest.json` → `"version": "1.2.2"`
- [ ] caricalo su un profilo Chrome pulito: pannello visibile, opzioni accessibili
- [ ] finestra privata: README, vetrina Pages e Release visibili senza login

## Dopo i tre passi

Il lancio vero e proprio sono i post: testi pronti in
[docs/POST-LANCIO.md](POST-LANCIO.md), da pubblicare **solo dopo** che Release e
Pages sono online (altrimenti il link è morto). Dopo 1-2 settimane: Insights →
Traffic (visitatori unici, cloni), star, issue → decisione go/no-go per CWS
(§ 1 di ROADMAP.md). Durante la stessa finestra si può preparare la
localizzazione inglese v1.3: [docs/PIANO-I18N-INGLESE.md](PIANO-I18N-INGLESE.md).
