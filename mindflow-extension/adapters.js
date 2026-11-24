/**
 * MindFlow Companion — Adattatori per sito.
 *
 * Logica PURA su DOM, senza alcuna API chrome.*: viene caricata sia dal
 * content script (world isolato) sia dalla pagina di self-test, così la
 * stessa logica viene verificata contro DOM di esempio.
 *
 * Contratto:
 *   hostId(host)                  -> 'chatgpt' | 'claude' | 'gemini' | 'glmchat' | null
 *   messageElements(id, root)     -> [{ role, text, el }] (el = nodo DOM del messaggio)
 *   extractMessages(id, root)     -> [{ role: 'user'|'assistant', text }]
 *   diagnose(id, root)            -> report sui selettori (debug remoto DOM)
 *   conversationKey(id, loc)      -> stringa stabile per la sessione
 *   conversationTitle(id, doc)    -> titolo pulito della chat
 *   findInput(id, root)           -> elemento input del prompt (o null)
 *   injectText(id, root, text)    -> true se il testo è stato inserito
 *   parseTranscriptText(raw)      -> [{ role, text }] da testo incollato
 *   parseChatGptExportJson(json)  -> { title, messages } da export ChatGPT
 *
 * Ogni strategia è uno di:
 *   { name, messages, role(el), textEl?(el) }  -> selezione per selettore CSS
 *   { name, list(root) }                       -> riserva strutturale: produce
 *      [{ el, role }] a mano, senza selettori del sito (vedi
 *      anchoredTurnBlocks: sale dall'input verso il contenitore dei turni e
 *      attribuisce i ruoli per alternanza, da usare SOLO se i selettori
 *      noti non hanno trovato nulla).
 */

(function () {
  "use strict";

  /** Limite di sicurezza per messaggio singolo (protezione da dump enormi). */
  var MAX_MSG_CHARS = 8000;

  function normText(t) {
    return (t == null ? "" : String(t))
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  function clip(t) {
    return t.length > MAX_MSG_CHARS ? t.slice(0, MAX_MSG_CHARS) + "…" : t;
  }

  function pickText(el) {
    var t = "";
    try {
      t = el.innerText || "";
    } catch (_e) {
      t = "";
    }
    if (!t) t = el.textContent || "";
    return clip(normText(t));
  }

  // ---------------------------------------------------------------------------
  // Testo "pulito" per ChatGPT (DOM 2025/2026)
  //
  // Il testo del turno letto con innerText/textContent porta con sé i pulsanti
  // (Copia, Mostra alto, valutazioni) e le etichette degli strumenti. La lettura
  // cammina l'albero e butta il chrome del sito: textContent invece di innerText
  // è voluto, perché la parte "chiusa" di un messaggio lungo (Mostra altro) resta
  // nel DOM anche quando è visivamente clampata.
  // ---------------------------------------------------------------------------

  var GPT_BLOCK_RE = /^(P|DIV|LI|UL|OL|PRE|BLOCKQUOTE|H[1-6]|TABLE|TR|SECTION|ARTICLE|FIGURE|FIGCAPTION|HEADER|FOOTER|MAIN|DL|DT|DD|ADDRESS|ASIDE)$/;

  function gptJunkNode(n) {
    if (!n || n.nodeType !== 1) return false;
    var tag = n.tagName || "";
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE" || tag === "BUTTON") return true;
    if (n.getAttribute) {
      var role = n.getAttribute("role");
      if (role === "button" || role === "toolbar" || role === "menu") return true;
      var tid = n.getAttribute("data-testid") || "";
      if (/copy|feedback|reaction|voice|read-aloud|share|edit|thumb/i.test(tid)) return true;
      if (/cot-v5-tool-icon/.test(tid)) return true;
      var cls = n.getAttribute("class") || "";
      if (/tool-message/.test(cls)) return true;
      if (/(^|\s)(sr-only|visually-hidden)(\s|$)/.test(cls)) return true;
      if (n.getAttribute("aria-hidden") === "true" && cls.indexOf("mf-") !== 0) return true;
      if (n.hasAttribute("data-interrupted")) return true;
    }
    return false;
  }

  /** Testo di un nodo DOM con a capo ai confini dei blocchi, senza chrome. */
  function domText(node) {
    if (!node) return "";
    var out = [];
    (function walk(n) {
      if (!n) return;
      if (n.nodeType === 3) {
        out.push(n.nodeValue || "");
        return;
      }
      if (n.nodeType !== 1) return;
      if (gptJunkNode(n)) return;
      var kids = n.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.nodeType === 1 && (k.tagName || "") === "BR") {
          out.push("\n");
          continue;
        }
        walk(k);
      }
      if (GPT_BLOCK_RE.test(n.tagName || "")) out.push("\n");
    })(node);
    return clip(normText(out.join("")));
  }

  /** Tieni solo i blocchi non contenuti (o contenenti) un altro già preso. */
  function topBlocks(list) {
    var kept = [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var swallowed = false;
      for (var j = 0; j < kept.length; j++) {
        try {
          if (kept[j].contains(b)) { swallowed = true; break; }
          if (b.contains(kept[j])) { kept[j] = b; swallowed = true; break; }
        } catch (_e) {
          swallowed = true;
          break;
        }
      }
      if (!swallowed) kept.push(b);
    }
    return kept;
  }

  function isGptToolPart(el) {
    try {
      if (el.closest && el.closest('[data-interrupted]')) return true;
      if (el.closest && el.closest('span[class*="tool-message"]')) return true;
      if (el.closest && el.closest('[data-testid="cot-v5-tool-icon-pile"]')) return true;
    } catch (_e) {
      /* closest assente: prosegui */
    }
    return false;
  }

  /** Testo della risposta assistente: tutti i blocchi di prosa, senza pulsanti. */
  function gptAssistantText(el) {
    if (!el || !el.querySelectorAll) return domText(el);
    var blocks = [];
    try {
      blocks = [].slice.call(
        el.querySelectorAll('.markdown, [data-markdown-text-style="assistant-message"]')
      );
    } catch (_e) {
      blocks = [];
    }
    blocks = blocks.filter(function (b) {
      return !isGptToolPart(b);
    });
    var kept = topBlocks(blocks);
    var parts = [];
    for (var i = 0; i < kept.length; i++) {
      var t = domText(kept[i]);
      if (t && parts[parts.length - 1] !== t) parts.push(t);
    }
    if (parts.length) return clip(parts.join("\n\n"));
    return domText(el);
  }

  /** Testo del messaggio utente: i blocchi pre-wrap (la bolla), senza chrome. */
  function gptUserText(el) {
    if (!el || !el.querySelectorAll) return domText(el);
    var parts = [];
    try {
      parts = topBlocks([].slice.call(el.querySelectorAll(".whitespace-pre-wrap")));
    } catch (_e) {
      parts = [];
    }
    var texts = [];
    for (var i = 0; i < parts.length; i++) {
      var t = domText(parts[i]);
      if (t) texts.push(t);
    }
    if (texts.length) return clip(texts.join("\n"));
    return domText(el);
  }

  /**
   * querySelectorAll che attraversa anche gli shadow root APERTI.
   * Il costo extra (camminata dell'albero) si paga SOLO quando la ricerca
   * normale non trova nulla: se i selettori noti funzionano, l'overhead è zero;
   * se il sito incapsula i turni in uno shadow root, la riserva li vede.
   */
  function qsaDeep(root, selector) {
    var out = [];
    if (!root || typeof root.querySelectorAll !== "function") return out;
    var found;
    try {
      found = root.querySelectorAll(selector);
    } catch (_e) {
      return out;
    }
    for (var i = 0; i < found.length; i++) out.push(found[i]);
    if (out.length) return out; // percorso normale: niente camminata
    // Camminata dei shadow root APERTI: ogni scope scoperto viene interrogato
    // SUBITO e poi messo in coda per discendere nei suoi shadow annidati.
    function collect(scope) {
      try {
        var inner = scope.querySelectorAll(selector);
        for (var j = 0; j < inner.length; j++) out.push(inner[j]);
      } catch (_e3) {
        /* scope non interrogabile: prosegui */
      }
    }
    var stack = [];
    var seenScopes = [];
    function visit(scope) {
      if (!scope || seenScopes.indexOf(scope) !== -1) return;
      seenScopes.push(scope);
      collect(scope);
      stack.push(scope);
    }
    visit(root.shadowRoot); // lo shadow del nodo dato, se esiste
    visit(root);
    var guard = 0;
    while (stack.length && guard++ < 4000) {
      var node = stack.pop();
      var kids;
      try {
        kids = node.querySelectorAll("*");
      } catch (_e2) {
        continue;
      }
      for (var k = 0; k < kids.length; k++) {
        if (kids[k].shadowRoot) visit(kids[k].shadowRoot);
      }
    }
    return out;
  }

  function hostId(host) {
    var h = (host == null ? "" : String(host)).toLowerCase();
    if (h === "chatgpt.com" || h === "chat.openai.com" ||
        h.endsWith(".chatgpt.com") || h.endsWith(".chat.openai.com")) return "chatgpt";
    if (h === "claude.ai" || h.endsWith(".claude.ai")) return "claude";
    if (h === "gemini.google.com" || h.endsWith(".gemini.google.com")) return "gemini";
    // Banca di prova MindFlow: chat GLM nell'anteprima web (o in locale).
    if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".space-z.ai")) return "glmchat";
    return null;
  }

  /**
   * Alcuni host coprono più pagine (es. anteprima space-z.ai): l'attivazione
   * richiede che la pagina contenga il marcatore della chat GLM.
   */
  var PAGE_MARKERS = {
    glmchat: "mf-glm-chat",
  };

  function pageMarker(id) {
    return PAGE_MARKERS[id] || null;
  }

  /**
   * Strategie di selezione per host, in ordine di affidabilità: la prima che
   * estrae almeno un messaggio vince, le successive restano come riserva per i
   * rinnovi del DOM (ChatGPT in particolare riscrive spesso il proprio markup:
   * a fine 2025 ha introdotto attributi nuovi e la virtualizzazione dei turni
   * lunghi). diagnose() riporta quante corrispondenze trova ogni strategia.
   *
   * Regola critica (bug "solo la prima frase", corretto a novembre 2026): i
   * contenitori di TURNO di ChatGPT ([data-turn-key], [data-testid^=
   * "conversation-turn"]) contengono DENTRO sia la domanda sia la risposta.
   * Accettare il contenitore intero collassa lo scambio in un solo messaggio e,
   * via elementCovered, sopprime tutti gli elementi interni: restava solo la
   * prima frase dell'utente. Per questo i contenitori NON sono mai messaggi:
   * la strategia "turn-exchange" (list) emette solo gli SLOT interni (bolla
   * utente e blocco risposta), mai il contenitore.
   */
  var SELECTORS = {
    chatgpt: {
      strategies: [
        {
          // PRIMARIA (v0.9.0): per-contenitore di turno, slot utente + prosa
          // assistente separati, con riserva a PARAGRAFI che sopravvive ai
          // rinnovi totali del markup. Vedi gptTurnSlots.
          name: "turn-slots",
          list: function (root) {
            return gptTurnSlots(root);
          },
        },
        {
          // Holder espliciti a livello MESSAGGIO (il marcatore storico di
          // ChatGPT, ancora presente nelle varianti legacy e in parte nelle
          // nuove): la massima granularità, nessun rischio di collasso.
          name: "author-role",
          messages: "[data-message-author-role]",
          role: function (el) {
            return el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
          },
          textFn: function (el, role) {
            return role === "user" ? gptUserText(el) : gptAssistantText(el);
          },
        },
        {
          // Varianti con ruolo su un nodo interno dedicato: fine-grained,
          // mai un contenitore di turno intero.
          name: "conversation-role",
          messages: "[data-conversation-role]",
          role: function (el) {
            var v = (el.getAttribute("data-conversation-role") || "").toLowerCase();
            return v === "user" ? "user" : v === "assistant" ? "assistant" : null;
          },
          textFn: function (el, role) {
            return role === "user" ? gptUserText(el) : gptAssistantText(el);
          },
        },
        {
          // Bolla utente delle varianti 2025/2026.
          name: "user-bubble",
          messages: "[data-user-message-bubble]",
          role: function () {
            return "user";
          },
          textFn: function (el) {
            return gptUserText(el);
          },
        },
        {
          // Blocco di prosa marcato della variante 2026.
          name: "assistant-markdown-style",
          messages: '[data-markdown-text-style="assistant-message"]',
          role: function (el) {
            return isGptToolPart(el) ? null : "assistant";
          },
          textFn: function (el) {
            return domText(el);
          },
        },
        {
          // Riserva di prosa: blocchi .markdown senza marcatori (tipico della
          // variante anonima). L'esclusione di tool/interrotti evita di
          // promuovere il "lavoro in corso" a risposta.
          name: "markdown-block",
          messages: ".markdown",
          role: function (el) {
            if (isGptToolPart(el)) return null;
            try {
              if (el.closest('[data-message-author-role="user"]')) return "user";
              if (el.closest("[data-user-message-bubble]")) return "user";
            } catch (_e) {
              /* closest non disponibile */
            }
            return "assistant";
          },
          textFn: function (el, role) {
            return role === "user" ? gptUserText(el) : domText(el);
          },
        },
        {
          // Slot con chiave di ricerca/contenuto con suffisso di ruolo
          // (rollout search-unit 2025/2026: "...:user" / "...:assistant").
          name: "search-unit",
          messages: "[data-chatgpt-search-unit-key], [data-content-search-unit-key]",
          role: function (el) {
            var k =
              el.getAttribute("data-chatgpt-search-unit-key") ||
              el.getAttribute("data-content-search-unit-key") || "";
            if (/:user$/i.test(k)) return "user";
            if (/:assistant$/i.test(k)) return "assistant";
            return null;
          },
          textFn: function (el, role) {
            return role === "user" ? gptUserText(el) : gptAssistantText(el);
          },
        },
        {
          // Scambi "shell" ([data-turn-key] e varianti): ogni scambio contiene
          // utente E risposta. Questa strategia produce SOLO gli slot interni
          // come messaggi separati: il contenitore non è mai un messaggio.
          name: "turn-exchange",
          list: function (root) {
            return shellExchangeSlots(root);
          },
        },
        {
          // RETE DI SICUREZZA per le risposte (bug "solo i miei messaggi",
          // novembre 2026): le risposte di ChatGPT sono FATTE DI BLOCCHI di
          // prosa (p/li/pre/intestazioni) tra una bolla utente e la seguente.
          // Questa strategia non dipende da ALCUN marcatore della risposta:
          // raggruppa i blocchi di prosa per intervallo tra bolle utente
          // consecutive ed emette un messaggio assistente per intervallo.
          // Le strategie precedenti che hanno già preso la risposta scartano
          // questi gruppi via elementCovered, quindi nessun doppione.
          name: "prose-between-users",
          list: function (root) {
            return proseBetweenUsers(root);
          },
        },
        {
          // Sezioni turno legacy: il ruolo si deduce dagli holder interni;
          // senza NESSUN indizio l'elemento è scartato (meglio perdere che
          // collassare lo scambio in un messaggio solo).
          name: "turn-section",
          messages: '[data-testid^="conversation-turn"]',
          role: function (el) {
            var holder = el.querySelector("[data-message-author-role]");
            if (holder) {
              return holder.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
            }
            if (el.querySelector("[data-user-message-bubble]")) return "user";
            var unit = el.querySelector('[data-chatgpt-search-unit-key$=":assistant"], [data-content-search-unit-key$=":assistant"]');
            if (unit) return "assistant";
            if (el.querySelector('.markdown, [data-markdown-text-style="assistant-message"]')) return "assistant";
            if (el.querySelector(".whitespace-pre-wrap")) return "user";
            return null;
          },
          textFn: function (el, role) {
            return role === "user" ? gptUserText(el) : gptAssistantText(el);
          },
        },
        {
          // Riserva estrema (markup nuovamente rinnovato, nessun marcatore
          // noto): i turni vengono ricostruiti dalla struttura partendo dal
          // prompt di input, con ruoli attribuiti per alternanza.
          name: "turn-blocks",
          list: function (root) {
            return anchoredTurnBlocks(root, SELECTORS.chatgpt.input);
          },
        },
      ],
      input:
        '#prompt-textarea, div#prompt-textarea[contenteditable="true"], div.ProseMirror[contenteditable="true"], form div[contenteditable="true"], form textarea',
    },
    claude: {
      strategies: [
        {
          name: "testid",
          messages:
            '[data-testid="user-message"], [data-testid="assistant-message"], .font-claude-message, .font-claude-response',
          role: function (el) {
            if (el.matches && el.matches('[data-testid="user-message"]')) return "user";
            return "assistant";
          },
        },
        {
          // Riserva estrema: se Anthropic cambiasse testid E classi tipografiche,
          // risale dall'input al contenitore dei turni e li attribuisce per
          // alternanza (primo turno = utente). Il contenitore deve avere SOLO
          // turni "somiglianti" (ogni figlio senza input con testo sostanzioso),
          // così header/footer/sidebar non vengono scambiati per turni.
          name: "turn-blocks",
          list: function (root) {
            return anchoredTurnBlocks(root, SELECTORS.claude.input);
          },
        },
      ],
      // L'input di Claude è un ProseMirror contenteditable.
      input:
        'div.ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"], fieldset div[contenteditable="true"]',
    },
    gemini: {
      strategies: [
        {
          // Gemini usa custom element: user-query (l'utente) e model-response (modello).
          name: "custom-elements",
          messages: "user-query, model-response",
          role: function (el) {
            var tag = (el.tagName || "").toLowerCase();
            return tag === "user-query" ? "user" : "assistant";
          },
        },
        {
          // Riserva: contenitori interni del testo con nomi di classe noti,
          // utili se i custom element vengono rinominati ma il markup interno
          // sopravvive. Il ruolo si deduce dalla classe stessa.
          name: "content-classes",
          messages: ".query-content, .response-container-content",
          role: function (el) {
            return el.classList && el.classList.contains("query-content") ? "user" : "assistant";
          },
        },
        {
          // Riserva estrema strutturale (come per Claude).
          name: "turn-blocks",
          list: function (root) {
            return anchoredTurnBlocks(root, SELECTORS.gemini.input);
          },
        },
      ],
      input: 'rich-textarea .ql-editor[contenteditable="true"], .ql-editor[contenteditable="true"]',
    },
    glmchat: {
      strategies: [
        {
          // Pagina /chat dell'app MindFlow (anteprima o locale): markup nostro,
          // quindi selettori stabili. Il testo vive in [data-mf-text] così il
          // cursore di streaming e gli elementi UI non inquinano l'estrazione.
          name: "mf-attrs",
          messages: "[data-mf-role]",
          role: function (el) {
            return el.getAttribute("data-mf-role") === "user" ? "user" : "assistant";
          },
          textEl: function (el) {
            return el.querySelector("[data-mf-text]") || el;
          },
        },
      ],
      input: "textarea[data-mf-input]",
    },
  };

  function hostStrategies(id) {
    var conf = SELECTORS[id];
    if (!conf || !Array.isArray(conf.strategies)) return [];
    return conf.strategies;
  }

  // ---------------------------------------------------------------------------
  // Riserva strutturale ancorata all'input
  // ---------------------------------------------------------------------------

  /** Soglia minima di testo per considerare un blocco "somigliante a un turno". */
  var TURN_BLOCK_MIN_CHARS = 12;
  var TURN_BLOCK_MAX_KIDS = 400;

  /**
   * Ultima riserva quando NESSUN selettore noto trova più nulla (il sito ha
   * cambiato sia attributi sia classi). Salendo dall'input verso l'alto cerca
   * il contenitore i cui figli — escluso quello che contiene l'input — sono
   * TUTTI blocchi di testo sostanzioso: la lista dei turni. I ruoli vengono
   * attribuiti per alternanza (primo turno = utente), che nelle chat è quasi
   * sempre vera; è una perdita di precisione accettata solo a fronte di zero
   * alternative. Le garanzie severe (tutti i figli con testo, nessun ramo che
   * contenga l'input) evitano di raccogliere header, footer e sidebar.
   */
  function anchoredTurnBlocks(root, inputSel) {
    if (!root) return [];
    var input = null;
    try {
      input = root.querySelector(inputSel);
    } catch (_e) {
      return [];
    }
    if (!input) return [];
    var node = input;
    for (var up = 0; up < 12; up++) {
      node = node.parentElement;
      if (!node || node === root) break; // non si sale oltre il root dato
      var kids = [];
      for (var c = node.firstElementChild; c; c = c.nextElementSibling) {
        if (!c.contains(input)) kids.push(c);
      }
      if (kids.length < 2 || kids.length > TURN_BLOCK_MAX_KIDS) continue;
      var turnLike = true;
      for (var i = 0; i < kids.length; i++) {
        var t = "";
        try {
          t = (kids[i].innerText || kids[i].textContent || "").trim();
        } catch (_e2) {
          turnLike = false;
          break;
        }
        if (t.length < TURN_BLOCK_MIN_CHARS) {
          turnLike = false;
          break;
        }
      }
      if (!turnLike) continue;
      var out = [];
      for (var j = 0; j < kids.length; j++) {
        out.push({ el: kids[j], role: j % 2 === 0 ? "user" : "assistant" });
      }
      return out;
    }
    return [];
  }

  /**
   * Scambi "shell" di ChatGPT (DOM 2025/2026 verificato su pagina reale a
   * novembre 2026): ogni scambio è un contenitore [data-turn-key] (o
   * [data-talvt-turn-state] / [data-virtualized-turn-content]) che contiene
   * DENTRO la bolla utente E la risposta. NON emette mai il contenitore:
   * per ogni scambio produce gli slot interni come messaggi separati.
   *  - slot utente: [data-content-search-unit-key$=":user"] oppure la
   *    [data-user-message-bubble];
   *  - risposta: [data-chatgpt-agent-turn-start], slot ":assistant", oppure
   *    i blocchi di prosa (.markdown / data-markdown-text-style) diretti.
   * Un nodo fissato a priori non esiste più: le riserve producono coppie
   * [{el, role, textFn?}] a mano.
   */
  function shellExchangeSlots(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    var turnSel = "[data-turn-key], [data-talvt-turn-state], [data-virtualized-turn-content]";
    var turns;
    try {
      turns = [].slice.call(root.querySelectorAll(turnSel));
    } catch (_e) {
      return [];
    }
    var out = [];
    for (var i = 0; i < turns.length; i++) {
      var t = turns[i];
      // Solo lo scambio PIÙ esterno per catena di annidamento.
      try {
        if (t.parentElement && t.parentElement.closest(turnSel)) continue;
        if (t.closest(".markdown, [data-markdown-text-style], [contenteditable]")) continue;
      } catch (_e2) {
        continue;
      }
      var seenSlots = [];
      // --- slot utente ---
      var userSlots = [];
      try {
        userSlots = [].slice.call(
          t.querySelectorAll('[data-content-search-unit-key$=":user"], [data-user-message-bubble]')
        );
      } catch (_e3) {
        userSlots = [];
      }
      userSlots = topBlocks(userSlots);
      for (var u = 0; u < userSlots.length; u++) {
        seenSlots.push(userSlots[u]);
        out.push({ el: userSlots[u], role: "user", textFn: gptUserText });
      }
      // --- risposta ---
      var ansNodes = [];
      try {
        ansNodes = [].slice.call(
          t.querySelectorAll(
            '[data-chatgpt-agent-turn-start], [data-content-search-unit-key$=":assistant"], [data-markdown-text-style="assistant-message"], .markdown'
          )
        );
      } catch (_e4) {
        ansNodes = [];
      }
      ansNodes = topBlocks(ansNodes).filter(function (a) {
        if (isGptToolPart(a)) return false;
        // il nodo risposta non deve vivere dentro uno slot utente già preso
        for (var s = 0; s < seenSlots.length; s++) {
          try {
            if (seenSlots[s].contains(a)) return false;
          } catch (_e5) {
            return false;
          }
        }
        return true;
      });
      for (var a = 0; a < ansNodes.length; a++) {
        // El stabile per il salto al messaggio: il contenitore del blocco se
        // è un blocco di prosa nudo, altrimenti il nodo stesso.
        var el = ansNodes[a];
        if (a === 0 && ansNodes.length > 1) {
          try {
            var wrap = ansNodes[0].parentElement;
            if (wrap && !wrap.closest('[data-content-search-unit-key$=":user"]')) el = wrap;
          } catch (_e6) {
            /* resta il blocco */
          }
        }
        out.push({ el: el, role: "assistant", textFn: gptAssistantText });
      }
      // Scambio privo di entrambi gli slot: non produce nulla (mai il
      // contenitore intero: era il bug "solo la prima frase").
    }
    return out;
  }

  /**
   * Strategia primaria per ChatGPT: per ogni CONTENITORE di turno vengono
   * estratti i DUE slot interni (bolla utente, prosa assistente), mai il
   * contenitore intero — era il collimento che produceva il bug "solo la
   * prima frase". Progettata per sopravvivere ai rinnovi del markup:
   *  - i contenitori cercati sono tutti i candidati noti (data-turn-key,
   *    article, testid conversation-turn, ecc.) uniti e deduplicati;
   *  - lo slot UTENTE si riconosce dagli attributi/classi storici;
   *  - lo slot ASSISTENTE si riconosce dalle classi di prosa NOTE e, se il
   *    sito le rinomina tutte, dai paragrafi (p/li/pre): il testo di una
   *    risposta è fatto di blocchi, qualunque wrapper li contenga.
   */
  var GPT_TURN_SEL =
    "[data-turn-key], [data-talvt-turn-state], [data-virtualized-turn-content], " +
    '[data-testid^="conversation-turn"], article';
  var GPT_PROSE_SEL =
    '.markdown, [data-markdown-text-style="assistant-message"], [class*="markdown" i]';

  function gptTurnSlots(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    var main = null;
    try {
      main = root.querySelector("main");
    } catch (_e0) {
      main = null;
    }
    var containers = [];
    try {
      containers = topBlocks([].slice.call(qsaDeep(root, GPT_TURN_SEL)));
    } catch (_e) {
      containers = [];
    }
    var out = [];
    for (var c = 0; c < containers.length; c++) {
      var t = containers[c];
      // Fuori da <main> non ci sono turni (landing, sidebar, cookie banner):
      // evita di trasformare articoli di marketing in messaggi.
      try {
        if (main && !main.contains(t)) continue;
        if (t.closest && t.closest("#prompt-textarea, form [contenteditable]")) continue;
      } catch (_e2) {
        /* closest assente: prosegui */
      }

      // --- slot utente ---
      var userSlots = [];
      try {
        userSlots = topBlocks(
          [].slice.call(
            t.querySelectorAll(
              '[data-message-author-role="user"], [data-user-message-bubble], .whitespace-pre-wrap'
            )
          )
        );
      } catch (_e3) {
        userSlots = [];
      }

      // --- prosa assistente ---
      var prose = [];
      try {
        prose = topBlocks(
          [].slice.call(t.querySelectorAll(GPT_PROSE_SEL)).filter(function (b) {
            if (isGptToolPart(b)) return false;
            for (var u = 0; u < userSlots.length; u++) {
              try {
                if (userSlots[u].contains(b)) return false;
              } catch (_e4) {
                return false;
              }
            }
            return true;
          })
        );
      } catch (_e5) {
        prose = [];
      }

      // Riserva di prosa: BLOCCHI di testo reali (p/li/pre/intestazioni).
      // Il testo di una risposta esiste sempre dentro blocchi: questa rete
      // raccoglie la risposta anche se OGNI classe e attributo cambia.
      if (!prose.length) {
        try {
          prose = topBlocks(
            [].slice
              .call(t.querySelectorAll("p, li, pre, blockquote, h1, h2, h3, h4, h5, h6"))
              .filter(function (b) {
                if (gptJunkNode(b)) return false;
                for (var u2 = 0; u2 < userSlots.length; u2++) {
                  try {
                    if (userSlots[u2].contains(b)) return false;
                  } catch (_e6) {
                    return false;
                  }
                }
                var txt = "";
                try {
                  txt = (b.innerText || b.textContent || "").trim();
                } catch (_e7) {
                  return false;
                }
                return txt.length > 0;
              })
          );
        } catch (_e8) {
          prose = [];
        }
      }

      // --- emissioni (slot per slot, ordine documento) ---
      for (var u3 = 0; u3 < userSlots.length; u3++) {
        out.push({ el: userSlots[u3], role: "user", textFn: gptUserText });
      }
      if (prose.length) {
        var texts = [];
        for (var p = 0; p < prose.length; p++) {
          var tx = domText(prose[p]);
          if (tx && texts[texts.length - 1] !== tx) texts.push(tx);
        }
        if (texts.length) {
          var joined = texts.join("\n\n");
          // El per il salto al messaggio: il nodo di prosa più esterno
          // (scrollIntoView centered) MA mai un nodo che contiene uno slot
          // utente — elementCovered scarterebbe l'intera risposta come
          // "contenitore di un messaggio già accettato" (bug v0.9.0 trovato
          // dai test: la risposta spariva quando la prosa risale al wrapper).
          var jumpEl = prose[0];
          try {
            var wrapEl = prose[0].parentElement;
            var wrapHasUser = false;
            for (var u4 = 0; u4 < userSlots.length; u4++) {
              try {
                if (wrapEl && wrapEl.contains(userSlots[u4])) {
                  wrapHasUser = true;
                  break;
                }
              } catch (_e10) {
                wrapHasUser = true;
                break;
              }
            }
            if (wrapEl && !wrapHasUser && !wrapEl.closest('[data-message-author-role="user"]')) jumpEl = wrapEl;
          } catch (_e9) {
            /* resta il blocco */
          }
          // IIFE: il testo del contenitore corrente va LEGATO per valore,
          // altrimenti la chiusura var leggerebbe sempre l'ultimo giro del ciclo.
          (function (txt, el) {
            out.push({
              el: el,
              role: "assistant",
              textFn: function () {
                return txt;
              },
            });
          })(joined, jumpEl);
        }
      }
      // Contenitore privo di entrambi gli slot: non produce nulla.
    }
    return out;
  }

  // Marcatori della bolla utente (stabili nel DOM 2025/2026): sono l'unica
  // ancora di salto di proseBetweenUsers, quindi devono stare STRETTI.
  // NON c'entra .whitespace-pre-wrap: compare anche fuori dalle bolle.
  var USER_SLOT_SEL =
    '[data-message-author-role="user"], [data-user-message-bubble]';

  var POS_FOLLOWING = typeof Node !== "undefined" ? Node.DOCUMENT_POSITION_FOLLOWING : 4;
  var POS_PRECEDING = typeof Node !== "undefined" ? Node.DOCUMENT_POSITION_PRECEDING : 2;

  /**
   * RETE DI SICUREZZA per le risposte di ChatGPT (bug "solo i miei messaggi",
   * novembre 2026). Non dipende da NESSUN marcatore della risposta: una
   * risposta è, per definizione, la prosa che sta TRA la bolla utente e la
   * bolla utente successiva (o la fine della chat). Le bolle utente hanno
   * marcatori noti e stabili; i blocchi di prosa (p/li/pre/intestazioni)
   * esistono sempre in una risposta renderizzata, qualunque wrapper li contenga.
   *
   * Regole dure per non prendere spazzatura:
   *  - solo contenuto dentro <main> (fuori ci sono sidebar e landing);
   *  - blocchi dentro bolle utente, dialoghi, bottoni e composer: esclusi;
   *  - blocchi ANNIDATI (li dentro li) collassano sul contenitore esterno;
   *  - un gruppo senza NESSUN blocco di sostanza (>= 16 caratteri) non è una
   *    risposta: niente emissioni minuscule di interfaccia.
   * Il testo viene LEGATO per valore (IIFE) come in gptTurnSlots.
   */
  function proseBetweenUsers(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    var main = null;
    try {
      main = root.querySelector("main");
    } catch (_e) {
      main = null;
    }
    var scope = main || root;

    // --- 1) bolle utente riconoscibili, in ordine documento ---
    var users = [].slice.call(qsaDeep(root, USER_SLOT_SEL)).filter(function (u) {
      try {
        if (main && !main.contains(u)) return false;
        if (u.closest && u.closest('[role="dialog"], #prompt-textarea, form [contenteditable]')) return false;
        if (gptJunkNode(u)) return false;
        var t = "";
        try {
          t = (u.innerText || u.textContent || "").trim();
        } catch (_e2) {
          return false;
        }
        return t.length > 0;
      } catch (_e3) {
        return false;
      }
    });
    if (!users.length) return []; // senza domande riconoscibili non si deduce nulla
    docSort(users);

    // --- 2) blocchi di prosa foglia, fuori dalle bolle ---
    var blocks = [].slice.call(qsaDeep(scope, "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6")).filter(function (b) {
      try {
        if (gptJunkNode(b)) return false;
        if (b.closest && b.closest('[role="dialog"], #prompt-textarea, form [contenteditable]')) return false;
        for (var i = 0; i < users.length; i++) {
          try {
            if (users[i].contains(b)) return false;
          } catch (_e4) {
            return false;
          }
        }
        var txt = "";
        try {
          txt = (b.innerText || b.textContent || "").trim();
        } catch (_e5) {
          return false;
        }
        return txt.length > 0;
      } catch (_e6) {
        return false;
      }
    });
    if (!blocks.length) return [];
    docSort(blocks);

    // --- 3) raggruppa per intervallo: l'ultima bolla utente che precede il blocco ---
    var groups = []; // groups[k] = blocchi dopo users[k]
    for (var g = 0; g < users.length; g++) groups.push([]);
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      var owner = -1;
      for (var u = 0; u < users.length; u++) {
        try {
          // bolla precede blocco (o è suo antenato per costruzione: qui solo ordine)
          if (users[u].compareDocumentPosition(blk) & POS_FOLLOWING) owner = u;
        } catch (_e7) {
          break;
        }
      }
      if (owner >= 0) groups[owner].push(blk);
    }

    // --- 4) emette un messaggio assistente per gruppo con sostanza ---
    var out = [];
    for (var k = 0; k < groups.length; k++) {
      var group = topBlocks(groups[k]);
      if (!group.length) continue;
      var texts = [];
      var substance = 0;
      for (var p = 0; p < group.length; p++) {
        var tx = domText(group[p]);
        if (tx && texts[texts.length - 1] !== tx) {
          texts.push(tx);
          if (tx.length >= 16) substance++;
        }
      }
      if (!texts.length || !substance) continue; // solo interfaccia o testo minuscule
      (function (txt, el) {
        out.push({
          el: el,
          role: "assistant",
          textFn: function () {
            return txt;
          },
        });
      })(texts.join("\n\n"), group[0]);
    }
    return out;
  }

  /** Ordinamento stabile per posizione nel documento (compareDocumentPosition). */
  function docSort(list) {
    list.sort(function (a, b) {
      try {
        var rel = a.compareDocumentPosition(b);
        if (rel & POS_FOLLOWING) return -1;
        if (rel & POS_PRECEDING) return 1;
      } catch (_e) {
        /* ordine di scoperta */
      }
      return 0;
    });
  }

  /** true se l'elemento è già coperto da uno accettato (identico o annidato). */
  function elementCovered(accepted, el) {
    for (var i = 0; i < accepted.length; i++) {
      var a = accepted[i].el;
      if (a === el) return true;
      try {
        if (a.contains(el) || el.contains(a)) return true;
      } catch (_e) {
        return true;
      }
    }
    return false;
  }

  /**
   * Estrae i messaggi nell'ordine del documento, conservando il nodo DOM di
   * ciascuno. Contribuiscono TUTTE le strategie dell'host: un elemento già
   * coperto da un altro accettato (identico o annidato, es. article che
   * contiene la bolla) viene scartato, così le pagine con markup misto —
   * vecchio e nuovo nella stessa conversazione, tipico delle migrazioni
   * graduali di ChatGPT — si leggono per intero. Gli elementi accettati
   * vengono poi ordinati per posizione nel documento e i turni consecutivi
   * dello stesso ruolo vengono fusi, saltando i duplicati esatti.
   */
  function messageElements(id, root) {
    var strategies = hostStrategies(id);
    if (!strategies.length || !root) return [];
    var accepted = [];
    for (var i = 0; i < strategies.length; i++) {
      var st = strategies[i];
      var pairs = null;
      if (typeof st.list === "function") {
        // Riserva strutturale: la strategia produce lei stessa le coppie.
        try {
          pairs = st.list(root);
        } catch (_e) {
          pairs = null;
        }
      } else {
        var els = qsaDeep(root, st.messages);
        pairs = els.map(function (el) {
          return { el: el, role: st.role(el) };
        });
      }
      for (var j = 0; j < pairs.length; j++) {
        var el = pairs[j].el;
        var role = pairs[j].role;
        if (!role) continue;
        var textFn = pairs[j].textFn || st.textFn;
        var text = textFn
          ? textFn(el, role)
          : pickText(st.textEl ? st.textEl(el) : el);
        if (!text) continue; // vuoto: non copre il contenitore esterno
        if (elementCovered(accepted, el)) continue;
        accepted.push({ el: el, role: role, text: text, st: st });
      }
    }
    accepted.sort(function (a, b) {
      try {
        var rel = a.el.compareDocumentPosition(b.el);
        if (rel & POS_FOLLOWING) return -1; // b segue a nel documento
        if (rel & POS_PRECEDING) return 1;
      } catch (_e) {
        /* contesto strano: mantiene l'ordine di scoperta */
      }
      return 0;
    });
    // Deduplica: identici esatti ANDAVANO rimossi, ma con lo stesso ruolo due
    // testi in rapporto di prefisso (la stessa bolla vista a due granularità
    // diverse: slot vs contenitore) vengono FUSI tenendo il più lungo — così
    // la stessa frase non appare due volte nel registro. Due turni utente
    // davvero diversi restano due messaggi (niente fusione per ruolo).
    var out = [];
    for (var k = 0; k < accepted.length; k++) {
      var item = accepted[k];
      var prev = out[out.length - 1];
      if (prev && prev.role === item.role) {
        if (prev.text === item.text) continue;
        var a = prev.text || "";
        var b = item.text || "";
        if (a && b && a.length >= 24 && b.indexOf(a) === 0) {
          // il precedente è prefisso del nuovo: tieni il testo più lungo
          prev.text = b;
          if (item.el) prev.el = item.el;
          continue;
        }
        if (a && b && b.length >= 24 && a.indexOf(b) === 0) {
          continue; // il nuovo è già incluso nel precedente
        }
      }
      out.push({ role: item.role, text: item.text, el: item.el });
    }
    return out;
  }

  function extractMessages(id, root) {
    return messageElements(id, root).map(function (m) {
      return { role: m.role, text: m.text };
    });
  }

  // -------------------------------------------------------------------------
  // Diagnostica DOM (per segnalare i cambiamenti dei siti)
  // -------------------------------------------------------------------------

  /** Sonde generiche: contano elementi "somiglianti a messaggi" nella pagina. */
  var PROBES = [
    ["article", "article"],
    // Marcatori reali del DOM 2025/2026 (shell, verificati su pagina reale)
    ["turn-key", "[data-turn-key]"],
    ["app-shell-surface", "[data-app-shell-main-surface]"],
    ["thread-conversation", '[data-thread-find-target="conversation"]'],
    ["content-search-unit", "[data-content-search-unit-key]"],
    ["content-unit-user", '[data-content-search-unit-key$=":user"]'],
    ["content-unit-assistant", '[data-content-search-unit-key$=":assistant"]'],
    ["agent-turn-start", "[data-chatgpt-agent-turn-start]"],
    ["user-bubble", "[data-user-message-bubble]"],
    ["markdown-style", '[data-markdown-text-style="assistant-message"]'],
    ["markdown-root-class", '[class*="MarkdownRoot"]'],
    ["markdown-any-case", '[class*="markdown" i]'],
    ["markdown-class", ".markdown"],
    ["pre-wrap", ".whitespace-pre-wrap"],
    // Marcatori legacy e candidati (restano per il confronto in diagnostica)
    ["conversation-role", "[data-conversation-role]"],
    ["talvt-turn-state", "[data-talvt-turn-state]"],
    ["virtualized-turn", "[data-virtualized-turn-content]"],
    ["conversation-turn", '[data-testid^="conversation-turn"]'],
    ["author-role", "[data-message-author-role]"],
    ["markdown-style-any", "[data-markdown-text-style]"],
    ["search-unit", "[data-chatgpt-search-unit-key]"],
    ["message-id", "[data-message-id]"],
    ["main", "main"],
    // Claude: marcatori attuali e candidati per futuri rinnovi
    ["claude-user-testid", '[data-testid="user-message"]'],
    ["claude-assistant-testid", '[data-testid="assistant-message"]'],
    ["claude-font", ".font-claude-message"],
    ["claude-font-response", ".font-claude-response"],
    ["claude-assistant-response", '[data-testid="assistant-response"]'],
    // Gemini: custom element e contenitori interni
    ["gemini-user-query", "user-query"],
    ["gemini-model-response", "model-response"],
    ["gemini-query-content", ".query-content"],
    ["gemini-response-content", ".response-container-content"],
  ];

  /**
   * Rapporto su quante corrispondenze e quanti messaggi utilizzabili produce
   * ogni strategia, più le sonde generiche. Il pannello lo mostra e lo copia
   * negli appunti: incollandolo in chat si può aggiustare l'adattatore senza
   * accesso al computer dell'utente.
   */
  function diagnose(id, root) {
    var out = { host: id, strategies: [], probes: {}, messageCount: 0 };
    if (!root) return out;
    hostStrategies(id).forEach(function (st) {
      var matched = 0;
      var usable = 0;
      if (typeof st.list === "function") {
        try {
          var pairs = st.list(root) || [];
          pairs.forEach(function (p) {
            matched++;
            var t = p.textFn ? p.textFn(p.el, p.role) : pickText(p.el);
            if (t && p.role) usable++;
          });
        } catch (_e2) {
          /* riserva strutturale fallita: resta 0 */
        }
      } else {
        try {
          var els = qsaDeep(root, st.messages);
          els.forEach(function (el) {
            matched++;
            var role = st.role(el);
            var t = st.textFn ? st.textFn(el, role) : pickText(st.textEl ? st.textEl(el) : el);
            if (t && role) usable++;
          });
        } catch (_e) {
          /* selettore non valido: resta 0 */
        }
      }
      out.strategies.push({ name: st.name, selector: st.messages || "(strutturale dall'input)", matched: matched, usable: usable });
    });
    PROBES.forEach(function (p) {
      var c = 0;
      try {
        c = qsaDeep(root, p[1]).length;
      } catch (_e) {
        c = 0;
      }
      out.probes[p[0]] = c;
    });
    out.messageCount = extractMessages(id, root).length;
    return out;
  }

  function conversationKey(id, loc) {
    var p = (loc && loc.pathname) || "/";
    var s = (loc && loc.search) || "";
    var m;
    if (id === "chatgpt") {
      // 2025/2026: le conversazioni vivono su /c/<id>, variante /u/<id> e
      // variante anonima /uc/<id> (chat senza account).
      m = p.match(/\/(?:uc|c|u)\/([0-9a-zA-Z-]{8,})/);
      return m ? "c-" + m[1] : "p" + p;
    }
    if (id === "claude") {
      m = p.match(/\/chat\/([0-9a-zA-Z-]{8,})/);
      return m ? "ch-" + m[1] : "p" + p;
    }
    if (id === "gemini") {
      // URL Gemini: /app/<id-esadecimale>; fuori da /app cadono su path.
      m = p.match(/\/app\/([0-9a-zA-Z._-]{6,})/);
      return m ? "g-" + m[1] : "g" + p;
    }
    if (id === "glmchat") {
      // "Nuova chat" della pagina incrementa ?c=N: sessione di memoria nuova.
      return "glm" + p + s;
    }
    return "p" + p + s;
  }

  function conversationTitle(id, doc) {
    var t = ((doc && doc.title) || "").trim();
    if (id === "chatgpt") {
      var clean = t
        .replace(/\s*[-–—]\s*ChatGPT.*$/i, "")
        .replace(/\s*[·|]\s*ChatGPT.*$/i, "")
        .replace(/^\s*Chat\s*GPT\s*$/i, "");
      // Titolo di pagina generico (nuova UI): non è un titolo di conversazione.
      if (/Chat, Work|Code with AI/i.test(clean)) return "ChatGPT";
      return clean || "ChatGPT";
    }
    if (id === "claude") return t.replace(/\s*[-–—]\s*Claude.*$/i, "") || "Claude";
    if (id === "gemini") return t.replace(/\s*[-–—]\s*Gemini.*$/i, "") || "Gemini";
    if (id === "glmchat") return t.replace(/\s*[·|]\s*MindFlow.*$/i, "").trim() || "Chat GLM";
    return t || "Chat";
  }

  // -------------------------------------------------------------------------
  // Lettura generica di QUALSIASI pagina web (v1.1.0)
  //
  // L'estensione nasce per le chat, ma la mappa mentale vale per ogni pagina
  // di testo: Wikipedia, articoli, documentazione. Qui un estrattore tipo
  // "reader": individua il contenuto principale, lo divide in sezioni
  // seguendo i titoli h2/h3/h4 (su Wikipedia sono già i capitoli) e lo
  // consegna alla STESSA pipeline dei capitoli. Nessun sito è codificato a
  // mano: solo regole generali (main/article, densità di testo, esclusione
  // di navigazione, footer, annunci e riferimenti bibliografici).
  // -------------------------------------------------------------------------

  /** Ciò che NON è contenuto: cromatura del sito, box laterali, note a piè
   *  di pagina, menu, cookie banner. La lista copre i casi comuni (Wikipedia
   *  compreso) senza mai nominare un sito specifico come obbligatorio. */
  var PAGE_SKIP_SEL = [
    "script", "style", "noscript", "template", "iframe", "svg", "canvas",
    "object", "embed", "video", "audio", "form", "button", "select",
    "textarea", "input", "label", "nav", "footer", "header", "aside",
    "dialog", "figcaption", "figure",
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    "[role='complementary']", "[role='search']", "[role='dialog']",
    "[aria-hidden='true']", "[hidden]",
    ".navbox", ".vertical-navbox", ".navbar", ".navigation", ".breadcrumb",
    ".breadcrumbs", ".mw-editsection", ".mw-references-wrap", ".reflist",
    ".references", ".mw-cite-backlink", ".noprint", ".printfooter",
    ".catlinks", ".mw-jump-link", ".sidebar", ".infobox", ".toc", "#toc",
    ".site-footer", ".site-header", ".site-nav", ".menu", ".dropdown",
    ".ad", ".ads", ".advert", ".sponsor", ".cookie", ".consent", ".banner",
    ".toolbar", ".share", ".social", ".related", ".comments", ".comment",
    ".reference", ".refsection", ".ambox", ".mbox", ".mw-empty-elt",
    "#footer", "#sidebar", "#nav", "#menu",
  ].join(",");

  /** Candidati per il contenuto principale, dal più specifico al più generico:
   *  vince il PRIMO con abbastanza testo (non il più grande: un wrapper che
   *  contiene anche il menu "vince" sempre per dimensione). */
  var PAGE_ROOT_SEL = [
    "#mw-content-text", "main", "article", "[role='main']",
    ".entry-content", ".post-content", ".markdown-body", "#main-content",
    "#content",
  ].join(",");

  function pageVisible(el) {
    try {
      if (el.hidden) return false;
      var st = el.style || {};
      if (st.display === "none" || st.visibility === "hidden") return false;
    } catch (_e) {
      /* attributi non leggibili: passa */
    }
    return true;
  }

  function inJunk(el) {
    try {
      return !!(el.closest && el.closest(PAGE_SKIP_SEL));
    } catch (_e) {
      return false;
    }
  }

  function pageTitle(doc) {
    // Prima l'h1 vero della pagina; altrimenti il <title> privato del suffisso
    // del sito ("Napoleone - Wikipedia" -> "Napoleone").
    var h1 = null;
    try {
      var cands = doc.querySelectorAll("h1");
      for (var i = 0; i < cands.length; i++) {
        var t = normText(cands[i].textContent);
        if (t.length >= 3 && inJunk(cands[i]) === false) { h1 = t; break; }
      }
    } catch (_e) {
      /* title fallback sotto */
    }
    if (h1) return h1.slice(0, 120);
    var tt = normText((doc && doc.title) || "");
    var parts = tt.split(/\s+[-–—|]\s+/);
    return (parts[0] || tt || "Pagina").slice(0, 120);
  }

  /**
   * Estrae il documento principale di una pagina qualsiasi.
   * Ritorna { title, sections:[{heading,text}], chars } — le sezioni diventano
   * i "messaggi" della pipeline (content.js le mappa su ruolo assistant).
   */
  function extractPageDocument(doc) {
    var out = { title: "", sections: [], chars: 0 };
    if (!doc || !doc.body) return out;
    out.title = pageTitle(doc);

    // 1. Contenuto principale: primo candidato specifico con testo sufficiente.
    var root = null;
    try {
      var cands = doc.body.querySelectorAll(PAGE_ROOT_SEL);
      for (var i = 0; i < cands.length; i++) {
        if (inJunk(cands[i]) || !pageVisible(cands[i])) continue;
        if ((cands[i].textContent || "").length >= 350) { root = cands[i]; break; }
      }
    } catch (_e1) {
      root = null;
    }
    if (!root) root = doc.body;

    // 2. Blocchi di testo nell'ordine del documento. h2/h3/h4 aprono sezioni;
    //    p/pre/blockquote/li riempiono le sezioni. Un <li> dentro un <li> o un
    //    <p> dentro un <li> verrebbe contato due volte: si tengono solo i
    //    "blocchi foglia".
    var blocks = [];
    var seen = 0;
    try {
      var nodes = root.querySelectorAll("h2,h3,h4,p,pre,blockquote,li");
      for (var j = 0; j < nodes.length && seen < 900; j++) {
        var el = nodes[j];
        seen++;
        if (!pageVisible(el) || inJunk(el)) continue;
        var tag = (el.tagName || "").toLowerCase();
        if (tag === "li" && el.parentElement && el.parentElement.closest("li")) continue;
        if ((tag === "p" || tag === "blockquote") &&
            el.parentElement && el.parentElement.closest("li")) continue;
        var isHead = tag === "h2" || tag === "h3" || tag === "h4";
        var t = normText(el.textContent);
        if (isHead) {
          if (t.length >= 2 && t.length <= 140) blocks.push({ head: true, text: t });
        } else {
          if (t.length >= 30) blocks.push({ head: false, text: t });
        }
      }
    } catch (_e2) {
      /* DOM strano: restano i blocchi raccolti fin qui */
    }

    // 3. Sezioni: il testo si accumula nell'intestazione corrente.
    var cur = { heading: "", parts: [] };
    var total = 0;
    function flush() {
      var text = cur.parts.join("\n").trim();
      if (text.length >= 60 && out.sections.length < 200) {
        // Una sezione enorme (h2 con mezza enciclopedia) viene rispettata ma
        // rispettosamente tagliata: la mappa serve i temi, non tutto il testo.
        if (text.length > 4200) text = text.slice(0, 4200) + "…";
        out.sections.push({ heading: cur.heading, text: text });
        total += text.length;
      }
    }
    for (var k = 0; k < blocks.length; k++) {
      var b = blocks[k];
      if (b.head) { flush(); cur = { heading: b.text, parts: [] }; }
      else { cur.parts.push(b.text); if (total + cur.parts.join("\n").length > 140000) break; }
    }
    flush();

    // 3b. Sezione senza titolo ma gigantesca (pagina SENZA heading): si spezza
    //     in blocchi sintetici da ~1500 caratteri lungo i paragrafi — la
    //     pipeline dei capitoli ha confini su cui ragionare e la compressione
    //     non affoga in un unico blob. Le sezioni CON heading restano intatte.
    if (out.sections.length && out.sections.some(function (s) { return !s.heading && s.text.length > 2600; })) {
      var split = [];
      for (var si = 0; si < out.sections.length; si++) {
        var sec = out.sections[si];
        if (sec.heading || sec.text.length <= 2600) { split.push(sec); continue; }
        var paras = sec.text.split("\n");
        var buf = [];
        var bsz = 0;
        for (var pi = 0; pi < paras.length; pi++) {
          buf.push(paras[pi]);
          bsz += paras[pi].length;
          if (bsz >= 1500) {
            split.push({ heading: "", text: buf.join("\n") });
            buf = [];
            bsz = 0;
          }
        }
        if (buf.length) split.push({ heading: "", text: buf.join("\n") });
      }
      out.sections = split;
    }

    // 4. Nessun titolo nella pagina ma molto testo: sezioni sintetiche da
    //    ~1500 caratteri, così la pipeline ha comunque capitoli da comprimere.
    if (out.sections.length === 0) {
      var joined = [];
      var size = 0;
      for (var m = 0; m < blocks.length; m++) {
        if (blocks[m].head) continue;
        joined.push(blocks[m].text);
        size += blocks[m].text.length;
        if (size >= 1500) {
          out.sections.push({ heading: "", text: joined.join("\n") });
          total += size;
          joined = [];
          size = 0;
        }
        if (total > 50000) break;
      }
      if (joined.length && out.sections.length < 200) {
        out.sections.push({ heading: "", text: joined.join("\n") });
        total += size;
      }
    }
    out.chars = 0;
    for (var tc = 0; tc < out.sections.length; tc++) out.chars += out.sections[tc].text.length;
    return out;
  }

  function findInput(id, root) {
    var conf = SELECTORS[id];
    if (!conf || !root) return null;
    try {
      return root.querySelector(conf.input);
    } catch (_e) {
      return null;
    }
  }

  /**
   * Inserisce il testo compilato nel prompt del sito host.
   * ProseMirror (ChatGPT/Claude) e Quill (Gemini) reagiscono bene a
   * execCommand("insertText"); se non disponibile si prova l'evento paste.
   */
  function injectText(id, root, text) {
    var el = findInput(id, root);
    if (!el) return false;
    // Textarea/input (pagine React, es. chat GLM): il setter nativo + evento
    // input è l'unico modo affidabile per aggiornare lo stato del framework.
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "input") {
      try {
        var proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, el.value ? el.value + "\n\n" + text : text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus();
        return true;
      } catch (_e) {
        /* cade nel ramo generico */
      }
    }
    try {
      el.focus();
    } catch (_e) {
      /* focus può fallire: si prosegue comunque */
    }
    var ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (_e) {
      ok = false;
    }
    if (!ok) {
      try {
        var dt = new DataTransfer();
        dt.setData("text/plain", text);
        var evt = new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(evt);
        ok = true;
      } catch (_e2) {
        ok = false;
      }
    }
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (_e3) {
      /* non bloccante */
    }
    return ok;
  }

  // ---------------------------------------------------------------------------
  // Import di conversazioni passate (testo incollato / export JSON)
  // ---------------------------------------------------------------------------

  /** Etichette di ruolo riconosciute a inizio riga (i formati più comuni). */
  var ROLE_LABELS = [
    [/^\*\*\s*\[(utente|user|you|io|tu)\]\s*\*\*\s*/i, "user"],
    [/^\*\*\s*\[(assistente|assistant|ai|modello)\]\s*\*\*\s*/i, "assistant"],
    [/^(you said|tu hai detto|hai chiesto|hai detto|my question)\s*[:：]\s*/i, "user"],
    [/^(chatgpt said|claude said|gemini said|glm said|il modello ha detto|ha detto)\s*[:：]\s*/i, "assistant"],
    [/^(you|utente|user|human|io|tu|domanda|q)\s*[:：]\s*/i, "user"],
    [/^(chatgpt|claude|gemini|glm|assistant|assistente|ai|bot|risposta|modello)\s*[:：]\s*/i, "assistant"],
  ];

  function matchRoleLabel(line) {
    var l = (line || "").trim();
    if (!l || l.length > 220) return null;
    for (var i = 0; i < ROLE_LABELS.length; i++) {
      var m = l.match(ROLE_LABELS[i][0]);
      if (m) return { role: ROLE_LABELS[i][1], rest: l.slice(m[0].length) };
    }
    return null;
  }

  /**
   * Trasforma il testo incollato di una chat passata in turni {role, text}.
   * Strategie in ordine di affidabilità:
   *   1. righe marcate ("You said:", "Utente:", "**[UTENTE]**"…) -> split lì;
   *   2. blocchi separati da righe vuote con etichetta di testa;
   *   3. nessuna etichetta -> alternanza utente/assistente partendo da utente.
   */
  function parseTranscriptText(raw) {
    var text = (raw == null ? "" : String(raw)).replace(/\r\n?/g, "\n").trim();
    if (!text) return [];
    var lines = text.split("\n");

    // 1) turni delimitati da etichette inline (almeno due per fidarci)
    var hits = [];
    for (var i = 0; i < lines.length; i++) {
      var m = matchRoleLabel(lines[i]);
      if (m) hits.push({ at: i, m: m });
    }
    if (hits.length >= 2) {
      var outL = [];
      for (var k = 0; k < hits.length; k++) {
        var end = k + 1 < hits.length ? hits[k + 1].at : lines.length;
        var body = (hits[k].m.rest + "\n" + lines.slice(hits[k].at + 1, end).join("\n")).trim();
        if (!body) continue;
        var role = hits[k].m.role;
        if (outL.length && outL[outL.length - 1].role === role) {
          outL[outL.length - 1].text = clip(outL[outL.length - 1].text + "\n\n" + body);
        } else {
          outL.push({ role: role, text: clip(body) });
        }
      }
      if (outL.length >= 2) return outL;
    }

    // 2) blocchi separati da righe vuote
    var blocks = text.split(/\n{2,}/).map(function (b) {
      return b.trim();
    }).filter(Boolean);
    if (!blocks.length) return [];
    var anyLabel = blocks.some(function (b) {
      return !!matchRoleLabel(b.split("\n")[0]);
    });
    if (anyLabel) {
      var outB = [];
      blocks.forEach(function (b) {
        var head = matchRoleLabel(b.split("\n")[0]);
        if (head) {
          var body2 = (head.rest ? head.rest + "\n" : "") + b.split("\n").slice(1).join("\n");
          body2 = body2.trim();
          if (!body2) return;
          if (outB.length && outB[outB.length - 1].role === head.role) {
            outB[outB.length - 1].text = clip(outB[outB.length - 1].text + "\n\n" + body2);
          } else {
            outB.push({ role: head.role, text: clip(body2) });
          }
        } else if (outB.length) {
          // continuazione del turno precedente
          var last = outB[outB.length - 1];
          last.text = clip(last.text + "\n\n" + b);
        } else {
          outB.push({ role: "user", text: clip(b) });
        }
      });
      if (outB.length >= 2) return outB;
    }

    // 3) nessuna etichetta riconosciuta: alternanza semplice
    var outA = [];
    blocks.forEach(function (b, idx) {
      outA.push({ role: idx % 2 === 0 ? "user" : "assistant", text: clip(b) });
    });
    return outA;
  }

  /**
   * Accetta l'export ufficiale di ChatGPT (conversations.json, array di
   * conversazioni, o singola conversazione) e restituisce { title, messages }.
   * Percorre l'albero mapping scegliendo l'ultimo figlio a ogni biforcazione
   * (l'ultima rigenerazione). Supporta anche { title, messages: [{role, content}] }.
   */
  function parseChatGptExportJson(json) {
    if (!json || typeof json !== "object") return null;

    if (Array.isArray(json.messages)) {
      var msgs = [];
      json.messages.forEach(function (m) {
        var role = m && m.role;
        var content = m && m.content;
        var t = typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.filter(function (p) { return typeof p === "string"; }).join("\n")
            : "";
        t = normText(t);
        if (t && (role === "user" || role === "assistant")) {
          msgs.push({ role: role, text: clip(t) });
        }
      });
      return msgs.length ? { title: String(json.title || "Chat importata"), messages: msgs } : null;
    }

    var convs = Array.isArray(json) ? json : [json];
    var best = null;
    var bestN = 0;
    convs.forEach(function (c) {
      if (!c || typeof c !== "object" || !c.mapping || typeof c.mapping !== "object") return;
      var n = Object.keys(c.mapping).length;
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    });
    if (!best) return null;

    var mapping = best.mapping;
    var rootId = null;
    Object.keys(mapping).forEach(function (id) {
      if (!mapping[id] || mapping[id].parent) return;
      if (rootId === null) rootId = id;
    });
    if (rootId === null) return null;

    var out = [];
    var cur = mapping[rootId];
    var guard = 0;
    while (cur && guard++ < 8000) {
      var msg = cur.message;
      if (msg && msg.author && msg.content && Array.isArray(msg.content.parts)) {
        var t2 = msg.content.parts
          .filter(function (p) { return typeof p === "string"; })
          .join("\n");
        t2 = normText(t2);
        var role2 = msg.author.role;
        if (t2 && (role2 === "user" || role2 === "assistant")) {
          if (out.length && out[out.length - 1].role === role2 && out[out.length - 1].text === t2) {
            // duplicato esatto: salta
          } else {
            out.push({ role: role2, text: clip(t2) });
          }
        }
      }
      var kids = (cur.children || []).filter(function (id) {
        return mapping[id];
      });
      if (!kids.length) break;
      cur = mapping[kids[kids.length - 1]]; // ultima rigenerazione
    }
    return out.length ? { title: String(best.title || "Chat importata"), messages: out } : null;
  }

  globalThis.MindFlowAdapters = {
    hostId: hostId,
    pageMarker: pageMarker,
    messageElements: messageElements,
    extractMessages: extractMessages,
    diagnose: diagnose,
    conversationKey: conversationKey,
    conversationTitle: conversationTitle,
    findInput: findInput,
    injectText: injectText,
    parseTranscriptText: parseTranscriptText,
    parseChatGptExportJson: parseChatGptExportJson,
    extractPageDocument: extractPageDocument,
    maxMessageChars: MAX_MSG_CHARS,
  };
})();
