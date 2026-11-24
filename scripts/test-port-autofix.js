/**
 * Test dell'AUTO-CORREZIONE della PORTA (engine-client.js v1.2.2).
 *
 * Il caso reale dell'utente: LM Studio attivo sulla 1235 (la 1234 era occupata
 * e LM Studio è salito di porta) mentre l'endpoint salvato diceva 1234 —
 * «riconosceva endpoint sembrava ma non motore e la chiamata falliva».
 * Verifica in VM con fetch stub:
 *   1. candidateAltBases: porte vicine ±2 + porte note, host 127.0.0.1 e
 *      localhost, suffisso /v1 per i compat e nessuno per Ollama;
 *   2. scanAlternateEngines: UN server compat vivo su 1235 (caso utente)
 *      → esattamente [{baseUrl:"http://127.0.0.1:1235/v1", models:[…]}];
 *   3. nessun server → [];
 *   4. due server compat → 2 risultati (scelta esplicita richiesta);
 *   5. Ollama su 11435 con endpoint 11434 → [{baseUrl:…:11435}];
 *   6. motori cloud → [] (nessuna scansione);
 *   7. porta viva ma risposta NON modelli (HTML) → scartata, nessun falso
 *      positivo;
 *   8. typo off-by-one (1233): la porta giusta 1232/1234/1235 è candidata.
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const code = fs.readFileSync(path.join(__dirname, "../mindflow-extension/engine-client.js"), "utf8");

let pass = 0;
let fail = 0;
function assert(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (detail ? " — " + detail : ""));
  }
}

/** Sandbox con fetch stub: responders = funzione(url) -> {ok, json} | null
 *  (null = connessione rifiutata). */
function makeSandbox(responders) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    fetch: async (url) => {
      for (const r of responders) {
        const hit = r.match(url);
        if (hit) {
          if (hit.refuse) {
            const e = new Error("Failed to fetch");
            throw e;
          }
          return {
            ok: hit.ok !== false,
            json: async () => hit.body,
          };
        }
      }
      const e = new Error("Failed to fetch");
      throw e;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "engine-client.js" });
  return sandbox.MindFlowEngineClient;
}

(async () => {
  const MF = makeSandbox([]);

  // --- 1. candidateAltBases: geometria dei candidati ------------------------
  const compat = MF.candidateAltBases("openai-compat", "http://127.0.0.1:1234/v1");
  const compatBases = compat.map((c) => c.baseUrl);
  assert(
    "compat: porte vicine della 1234 incluse (1232–1236)",
    ["1232", "1233", "1234", "1235", "1236"].every((p) =>
      compatBases.some((b) => b === "http://127.0.0.1:" + p + "/v1")
    ),
    compatBases.join(" ")
  );
  assert(
    "compat: porte note incluse (1237, 8080, 8000, 1337…)",
    ["1237", "8080", "8000", "1337", "5001", "4891", "5000", "8081"].every((p) =>
      compatBases.some((b) => b.endsWith(":" + p + "/v1"))
    ),
    compatBases.join(" ")
  );
  assert(
    "compat: anche l'host localhost (macOS/IPv6)",
    compatBases.some((b) => b.startsWith("http://localhost:")),
    compatBases.join(" ")
  );
  assert(
    "compat: ogni candidato ha la sua probeUrl (/v1/models)",
    compat.every((c) => /\/v1\/models$/.test(c.probeUrl) && /\/v1$/.test(c.baseUrl)),
    JSON.stringify(compat[0])
  );

  const oll = MF.candidateAltBases("ollama", "http://127.0.0.1:11434");
  const ollBases = oll.map((c) => c.baseUrl);
  assert(
    "ollama: porte 11434–11437 candidate, niente /v1",
    ["11434", "11435", "11436", "11437"].every((p) =>
      ollBases.some((b) => b === "http://127.0.0.1:" + p)
    ) && ollBases.every((b) => !/\/v1$/.test(b)),
    ollBases.join(" ")
  );
  assert(
    "ollama: probeUrl su /api/tags",
    oll.every((c) => /\/api\/tags$/.test(c.probeUrl))
  );

  // --- 8. typo off-by-one: 1233 → vicine candidate --------------------------
  const typo = MF.candidateAltBases("openai-compat", "http://127.0.0.1:1233/v1").map((c) => c.baseUrl);
  assert(
    "typo 1233: anche 1232, 1234 e 1235 tra i candidati",
    ["1232", "1233", "1234", "1235"].every((p) => typo.some((b) => b === "http://127.0.0.1:" + p + "/v1")),
    typo.join(" ")
  );

  // --- 2. IL CASO DELL'UTENTE: LM Studio vivo solo sulla 1235 ----------------
  const qwenKey = "lmstudio-community/Qwen3.5-9B-abliterated-GGUF";
  const MF2 = makeSandbox([
    {
      match: (u) => (/^http:\/\/127\.0\.0\.1:1235\/v1\/models$/.test(String(u)) ? { body: { data: [{ id: qwenKey }] } } : null),
    },
  ]);
  const found2 = await MF2.scanAlternateEngines({ kind: "openai-compat", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "" });
  assert(
    "caso utente: trovato il server sulla 1235",
    found2.length === 1 && found2[0].baseUrl === "http://127.0.0.1:1235/v1",
    JSON.stringify(found2)
  );
  assert(
    "caso utente: lista modelli con la chiave lunga LM Studio",
    found2[0] && found2[0].models.length === 1 && found2[0].models[0] === qwenKey,
    JSON.stringify(found2[0] && found2[0].models)
  );

  // --- 3. Nessun server → [] ------------------------------------------------
  const MF3 = makeSandbox([]);
  const found3 = await MF3.scanAlternateEngines({ kind: "openai-compat", baseUrl: "http://127.0.0.1:1234/v1" });
  assert("nessun server attivo: lista vuota", Array.isArray(found3) && found3.length === 0, JSON.stringify(found3));

  // --- 4. Due server compat → entrambi (l'utente sceglie) -------------------
  const MF4 = makeSandbox([
    {
      match: (u) => (/^http:\/\/127\.0\.0\.1:1235\/v1\/models$/.test(String(u)) ? { body: { data: [{ id: "A" }] } } : null),
    },
    {
      match: (u) => (/^http:\/\/127\.0\.0\.1:1236\/v1\/models$/.test(String(u)) ? { body: { data: [{ id: "B" }] } } : null),
    },
  ]);
  const found4 = await MF4.scanAlternateEngines({ kind: "openai-compat", baseUrl: "http://127.0.0.1:1234/v1" });
  assert(
    "due server attivi: entrambi trovati",
    found4.length === 2 && found4.some((f) => f.baseUrl.endsWith(":1235/v1")) && found4.some((f) => f.baseUrl.endsWith(":1236/v1")),
    JSON.stringify(found4)
  );

  // --- 5. Ollama su 11435 con endpoint 11434 --------------------------------
  const MF5 = makeSandbox([
    {
      match: (u) => (/^http:\/\/127\.0\.0\.1:11435\/api\/tags$/.test(String(u)) ? { body: { models: [{ name: "qwen2.5:7b" }] } } : null),
    },
  ]);
  const found5 = await MF5.scanAlternateEngines({ kind: "ollama", baseUrl: "http://127.0.0.1:11434" });
  assert(
    "Ollama: trovato sulla 11435",
    found5.length === 1 && found5[0].baseUrl === "http://127.0.0.1:11435" && found5[0].models[0] === "qwen2.5:7b",
    JSON.stringify(found5)
  );

  // --- 6. Motori cloud: nessuna scansione ----------------------------------
  const found6 = await MF3.scanAlternateEngines({ kind: "openai", baseUrl: "https://api.openai.com/v1" });
  assert("motori cloud: nessun candidato", Array.isArray(found6) && found6.length === 0);

  // --- 7. Porta viva ma NON un elenco modelli (HTML): scartata --------------
  const MF7 = makeSandbox([
    {
      match: (u) => (/^http:\/\/127\.0\.0\.1:1235\/v1\/models$/.test(String(u)) ? { body: "<html>benvenuto</html>" } : null),
    },
  ]);
  const found7 = await MF7.scanAlternateEngines({ kind: "openai-compat", baseUrl: "http://127.0.0.1:1234/v1" });
  assert("risposta non-modelli: scartata (nessun falso positivo)", found7.length === 0, JSON.stringify(found7));

  console.log(
    "\n" + (fail ? "ESITO: " + fail + " FALLITI su " + (pass + fail) : "TUTTI I " + pass + " TEST PASSANO ✔")
  );
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("ERRORE:", e);
  process.exit(1);
});
