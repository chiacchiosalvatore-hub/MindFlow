/**
 * Mock server OpenAI-compatibile (stile Ollama) per testare il provider
 * "local" di MindFlow. Ascolta su 127.0.0.1:8907/v1.
 *   POST /v1/chat/completions  (stream: true → SSE, stream: false → JSON)
 * Risposta fissa, streaming a chunk piccoli.
 */
import http from "node:http";

const PORT = 8907;
const REPLY =
  "Risposta dal modello locale mock: il provider \"local\" di MindFlow funziona, streaming SSE OpenAI-compatible ricevuto e inoltrato correttamente.";

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let stream = false;
    try {
      stream = Boolean(JSON.parse(body).stream);
    } catch {
      /* default non-stream */
    }

    if (!stream) {
      // In modalità non-stream il summarizer di MindFlow si attende un JSON
      // "Memory Node"; restituiamo quello.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  title: "Test provider locale (mock)",
                  summary:
                    "Sommario generato dal modello di servizio mock: il percorso /api/mindflow/summarize con provider locale funziona.",
                  keyDecisions: [
                    "Provider locale OpenAI-compatibile integrato",
                    "Modello di servizio separato dal modello di chat",
                  ],
                }),
              },
            },
          ],
        })
      );
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const chunks = REPLY.match(/[\s\S]{1,16}/g) ?? [];
    let i = 0;
    const timer = setInterval(() => {
      if (i >= chunks.length) {
        res.write("data: [DONE]\n\n");
        res.end();
        clearInterval(timer);
        return;
      }
      const evt = {
        choices: [{ delta: { content: chunks[i] } }],
      };
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
      i++;
    }, 15);
    // NB: req 'close' in Node moderno scatta subito dopo il consumo del body;
    // per rilevare la disconnessione del client va usato res 'close'.
    res.on("close", () => clearInterval(timer));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock local LLM on http://127.0.0.1:${PORT}/v1`);
});
