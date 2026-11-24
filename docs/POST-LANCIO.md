# Testi dei post di lancio — Fase 1 (25/11/2026)

Testi pronti da copiare e incollare. **Regola d'oro: pubblicare solo DOPO che
Release e Pages sono online** (guida: [GUIDA-DASHBOARD.md](GUIDA-DASHBOARD.md)),
altrimenti i link sono morti e la prima impressione si brucia.

Regole d'uso:

- Non pubblicare tutti i post nello stesso giorno: Show HN prima (dove c'è più
  traffico tecnico), Reddit il giorno dopo o più tardi.
- Su Reddit **non incollare lo stesso identico testo** in più subreddit: varia
  il primo paragrafo e adatta l'accento alla community (anti-spam).
- Rispondere ai commenti nelle prime 2-4 ore: è il momento che decide la visibilità.
- Se la GIF demo (45-60 s, storyboard in PUBBLICAZIONE.md § 3) è pronta,
  allegarla ai post Reddit e inserirla in README/vetrina prima di pubblicare.
- Link canonici: repo `https://github.com/chiacchiosalvatore-hub/MindFlow` ·
  vetrina `https://chiacchiosalvatore-hub.github.io/MindFlow/` ·
  Release `https://github.com/chiacchiosalvatore-hub/MindFlow/releases/tag/v1.2.2`

---

## 1. Show HN (inglese)

**Title** (75 caratteri):

> Show HN: MindFlow – persistent local memory for LLM chats as a Chrome panel

**Text** (post di testo, link dentro il corpo):

```text
Hi HN! I built MindFlow, an open-source (MIT) Chrome extension that gives AI
chats a persistent memory, entirely local: https://github.com/chiacchiosalvatore-hub/MindFlow

The problem it solves: long conversations on ChatGPT/Claude/Gemini eventually
lose the context that matters, and copying things into third-party tools means
sending my private work somewhere else. MindFlow runs in the browser and keeps
everything on the machine: it splits the chat into semantic chapters, compresses
each one into checkpoints, builds a small knowledge graph of the conversation,
and lets you re-inject that memory into a fresh chat when the context window is
gone. It also works on plain text pages, and the side panel doubles as a direct
chat interface for your local model.

It talks to the engine you already own: Ollama, LM Studio, llama.cpp or vLLM
locally, or any cloud API with your own key. There is no MindFlow server, no
telemetry, and keys live only in chrome.storage. A static security audit of the
whole codebase is in the repo, plus a public privacy policy.

Setup friction was the main thing people hit in testing, so the extension
autodetects the local endpoint and auto-fixes the most common mistake (wrong
port, e.g. 1234 vs 1235).

Stack: vanilla JS on Manifest V3, no build step, ~11k lines including tests.
Docs: https://chiacchiosalvatore-hub.github.io/MindFlow/

Honest caveats: the UI is currently in Italian — English localization is next on
the roadmap and I'm doing it during this validation window. Distribution is the
GitHub "load unpacked" flow for now (Chrome Web Store submission is planned once
I validate interest here), so Chrome shows its standard developer-mode warning
on startup.

Feedback welcome, especially on: how the graph turns out on your real chats,
which chat sites I should add adapters for next, and whether "local-first
memory" is a thing you'd actually keep installed.
```

---

## 2. r/LocalLLaMA (inglese)

**Title**:

> I built an open-source Chrome extension that gives my local LLM chats persistent memory — Ollama/LM Studio, everything stays local, MIT

**Body**:

```text
Like most of you I run Ollama/LM Studio all day, and the annoying part isn't the
model — it's the context. Long chats drift, the good stuff scrolls out of the
window, and starting over means re-explaining everything.

So I built MindFlow (open source, MIT): a Chrome extension that watches the chat
you're in, splits it into semantic chapters, compresses each chapter into a
checkpoint and builds a local knowledge graph. When you open a new conversation
you re-inject the memory with one click and the graph compiles the relevant
parts back in. It works on ChatGPT, Claude, Gemini and Chat GLM pages, and the
side panel is also a direct chat UI for your local engine (endpoint autodetect,
and it auto-fixes the classic wrong-port mistake 1234→1235).

Privacy is the point, not a feature list line: no server, no telemetry, nothing
leaves the browser except requests to the engine YOU configure (local or a cloud
API with your own key). Keys sit in chrome.storage. Full static security audit
in the repo.

Install is the GitHub beta flow: download the zip from Releases →
chrome://extensions → Developer mode → Load unpacked → point it at your engine.
Guide with the Ollama/LM Studio CORS notes in the repo.

Honest note: the UI is in Italian right now — English localization is my next
task (v1.3, already planned). If you try it anyway, I'd love feedback on two
things: checkpoint quality on long real chats, and what you'd want from a
memory feature that I'm probably not thinking about.

Repo + docs: https://github.com/chiacchiosalvatore-hub/MindFlow
Site: https://chiacchiosalvatore-hub.github.io/MindFlow/
```

---

## 3. r/chrome_extensions (inglese)

**Title**:

> Released my first MV3 extension: a local memory graph for AI chats (vanilla JS, no backend, MIT) — feedback on the whole flow appreciated

**Body**:

```text
I just released the first public beta of MindFlow, a Chrome MV3 extension
(vanilla JS, no build step) that turns long AI chats into a local knowledge
graph: semantic chapters → compressed checkpoints → reusable memory you can
re-inject in a new conversation. The side panel shows the graph, the chat and
your sessions; there's also an import for past conversations.

Technical choices I'd love feedback on:

- No backend at all: it talks to the engine the user configures (Ollama, LM
  Studio, llama.cpp, vLLM or a cloud API with the user's own key). Keys live in
  chrome.storage.local only. Distribution is GitHub Releases + "Load unpacked"
  for now, CWS submission planned after validation.
- The most common setup failure was a wrong local port, so the client
  autodetects the endpoint and auto-fixes port mismatches (e.g. 1234→1235).
- Permissions are kept minimal; a static security audit of every file is in the
  repo (docs/AUDIT-SICUREZZA.md), plus SECURITY.md with private disclosure.

Two questions for people who shipped MV3 extensions:

1. Anything you'd check on a manifest/permission set before submitting to CWS?
   (the justification table is ready, I'd rather catch problems now)
2. For updates distributed outside the store, is "re-download + Reload on
   chrome://extensions" acceptable UX in your experience, or does it kill
   retention?

Known limitation: the UI is in Italian at the moment, English localization is
next in the roadmap (v1.3). Repo: https://github.com/chiacchiosalvatore-hub/MindFlow
```

---

## 4. Community italiane

### 4a. Reddit r/ItalyInformatica (italiano)

**Title**:

> Ho fatto un'estensione Chrome open source che dà memoria persistente alle chat AI, tutto in locale (MIT, zero telemetria)

**Body**:

```text
Problema che volevo risolvere: nelle chat lunghe (ChatGPT, Claude, Gemini…) il
contesto buono esce dalla finestra e ripartire significa ri-spiegare tutto, o
peggio, incollare il mio lavoro in servizi di terzi.

MindFlow (open source, MIT) è un'estensione Chrome che divide la chat in
capitoli semantici, comprime ogni capitolo in checkpoint e costruisce un grafo
di memoria locale. In una conversazione nuova re-inietti la memoria con un clic
e il grafo ricompila le parti rilevanti. Il pannello laterale fa anche da chat
diretta verso il tuo modello locale (Ollama, LM Studio, llama.cpp, vLLM) o API
cloud con la tua chiave. Nessun server, nessuna telemetria, chiavi solo nel
browser, audit di sicurezza statico nel repo.

Installazione beta da GitHub: zip dalle Release → chrome://extensions → modalità
sviluppatore → Carica estensione non pacchettizzata → indirizzi MindFlow al tuo
endpoint (l'autodetect corregge anche le porte sbagliate).

Nota onesta: l'interfaccia è in italiano (qui è un vantaggio 😄), la
localizzazione inglese è il passo successivo. Cerco feedback soprattutto su
qualità dei checkpoint su chat lunghe vere e su cosa vi servirebbe da una
«memoria» locale.

Repo: https://github.com/chiacchiosalvatore-hub/MindFlow
Vetrina: https://chiacchiosalvatore-hub.github.io/MindFlow/
```

### 4b. Post breve adattabile (Telegram/Discord/gruppi LinkedIn — italiano)

```text
Ho pubblicato la prima beta di MindFlow, estensione Chrome open source (MIT)
che dà memoria persistente alle chat AI: divide le conversazioni in capitoli
semantici, le comprime in checkpoint e costruisce un grafo riutilizzabile nelle
conversazioni nuove. Tutto in locale: nessun server, zero telemetria, funziona
con il tuo modello (Ollama, LM Studio, llama.cpp, vLLM) o API cloud con la tua
chiave. Zip installabile dalle Release GitHub:
https://github.com/chiacchiosalvatore-hub/MindFlow
Feedback benvenuti, soprattutto su chat lunghe vere.
```

---

## 5. X/Twitter (breve)

**Variante EN**:

```text
MindFlow: open-source Chrome extension that turns long AI chats into a local
knowledge graph — semantic chapters, checkpoints, memory you re-inject in new
conversations. Works with Ollama / LM Studio / llama.cpp / vLLM. No server, no
telemetry, MIT. Beta zip from GitHub: https://github.com/chiacchiosalvatore-hub/MindFlow
```

**Variante IT**:

```text
MindFlow: estensione Chrome open source che trasforma le chat AI lunghe in un
grafo di memoria locale — capitoli semantici, checkpoint, memoria riutilizzabile
nelle conversazioni nuove. Funziona con Ollama / LM Studio / llama.cpp / vLLM.
Nessun server, zero telemetria, MIT. Beta: https://github.com/chiacchiosalvatore-hub/MindFlow
```

---

## 6. Mini-FAQ per rispondere ai commenti (EN/IT)

| Domanda probabile | Risposta pronta |
| --- | --- |
| «Does it upload my chats anywhere?» | No. Everything runs in the browser; the only network traffic is to the LLM endpoint you configure yourself (local engine or your cloud API). Full audit in docs/AUDIT-SICUREZZA.md. |
| «Why Italian UI?» / «Perché in italiano?» | Author is Italian; English localization is the current roadmap item (v1.3), already planned during this validation window. |
| «Why not the Chrome Web Store?» | It's the next phase: this beta validates interest first, then the store submission (with its review) follows. Store listing materials are already prepared. |
| «Firefox support?» | An untested build exists but it's intentionally not published until actually tested on Firefox (AMO to revisit after that). |
| «Does it work with X model?» | Any engine exposing an OpenAI-compatible HTTP endpoint works: Ollama, LM Studio, llama.cpp, vLLM locally, or cloud APIs with your own key. |
| «Quanto costa?» | Gratuito, licenza MIT open source. Eventuale edizione Pro solo a domanda misurata (roadmap). |
| «Is my API key safe?» | The key lives only in chrome.storage.local of your browser; the code contains no secrets and never sends it anywhere except the endpoint you configured. |

## 7. Checklist prima di pubblicare

- [ ] Release `v1.2.2` online e zip scaricabile da finestra privata
- [ ] Vetrina Pages online (`https://chiacchiosalvatore-hub.github.io/MindFlow/`)
- [ ] (Opzionale ma consigliato) GIF demo inserita in README e vetrina
- [ ] Show HN: titolo ≤ 80 caratteri, pubblicato in orario con traffico (mattina ET)
- [ ] Reddit: testo variato per ogni subreddit, regole del subreddit lette
- [ ] Link verificati a mano in ogni post (repo, vetrina, Release)
