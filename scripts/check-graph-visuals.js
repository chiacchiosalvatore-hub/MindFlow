const fs = require("fs");

async function main() {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  const zai = await ZAI.create();
  const b64 = fs.readFileSync("/tmp/render/mf-graph-boom.png").toString("base64");
  const completion = await zai.chat.completions.create({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Questa è una schermata di un pannello di estensione browser (colonna destra) affiancato a una finta chat (sinistra). " +
              "Verifica e descrivi in modo sintetico, in italiano: " +
              "1) Il grafo SVG nel pannello: quanti nodi si vedono, quale sembra attivo (evidenziato/con alone luminoso)? " +
              "2) Gli archi/linee tra i nodi: uno è più luminoso o con effetto animato/tratteggio? " +
              "3) C'è una piccola legenda in alto a destra dell'area grafo (pallino verde 'percorso attivo' e pallino ambra 'euristico')? " +
              "4) Le statistiche in alto (messaggi letti, checkpoint, token compilati): che numeri mostrano? " +
              "5) I nodi hanno una striscia colorata sul lato sinistro? Di che colore? " +
              "6) Note eventuali su testo sovrapposto, elementi tagliati o problemi visivi.",
          },
          { type: "image_url", image_url: { url: "data:image/png;base64," + b64 } },
        ],
      },
    ],
    thinking: { type: "disabled" },
  });
  console.log(completion.choices?.[0]?.message?.content ?? "nessuna risposta");
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
