/**
 * Test v1.2.0 — LAYOUT A SCALETTA + FIRMA ANTI-REBUILD del grafo.
 *
 * Carica il pannello reale (jsdom) in modalità DEMO con sessioni precaricate:
 *
 *   A. CATENA PURA (root + 6 capitoli, nessun bivio — il grafo tipico di una
 *      chat letta per intero): i nodi scendono a scaletta su due colonne
 *      alterne (passo 52px invece di 84) → altezza dell'SVG quasi dimezzata;
 *      l'arco tra le due colonne è la nuova curva a S morbida.
 *   B. FIRMA: un poll della chat (mindflow:messages, quello che arriva ogni
 *      ~2,5 s) NON ricostruisce l'SVG se il grafo non è cambiato: gli
 *      elementi .mf-node restano GLI STESSI oggetti DOM (identity check).
 *   C. Il click su un nodo (cambia la selezione) ridisegna davvero: nuovo
 *      elemento con classe mf-selected; il poll successivo torna a saltare.
 *   D. BIVIO VERO (un nodo con due figli): si torna al layout ad albero
 *      classico — foglie a distanza COL_W, padre centrato sui figli, archi
 *      verticali invariati.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/tmp/node_modules/jsdom");

const SRC = path.join(__dirname, "../mindflow-extension");
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function read(f) {
  return fs.readFileSync(path.join(SRC, f), "utf8");
}

/** Pannello in modalità demo con lo stato localStorage precaricato. */
function buildPanelDom(state) {
  const dom = new JSDOM(read("panel.html"), {
    url: "http://localhost/panel.html",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.localStorage.setItem("mf.demo.state", JSON.stringify(state));
  w.eval(read("adapters.js"));
  w.eval(read("engine-client.js"));
  w.eval(read("panel.js"));
  return w;
}

function node(w, i) {
  return w.document.querySelectorAll("#mf-graph .mf-node")[i];
}

/** coordinate translate(x,y) dell'i-esimo nodo */
function pos(w, i) {
  const t = node(w, i).getAttribute("transform") || "";
  const m = t.match(/translate\(([-\d.]+),([-\d.]+)\)/);
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
}

function chainNodes(n) {
  const out = [
    { id: "root", parentId: null, createdAt: 1, title: "Inizio conversazione", summary: "", keyDecisions: [], msgIndex: 0 },
  ];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: "cp" + i,
      parentId: i === 1 ? "root" : "cp" + (i - 1),
      createdAt: i + 1,
      title: "Capitolo " + i + " di prova",
      summary: "Riassunto del capitolo " + i + ".",
      keyDecisions: [],
      msgIndex: i * 4,
      chapterIndex: i,
      chapterCount: n,
      chapterFrom: (i - 1) * 4 + 1,
      chapterTo: i * 4,
    });
  }
  return out;
}

async function main() {
  // ---------------------------------------------------------------------------
  // A/B/C. Catena pura di 7 nodi (root + 6 capitoli)
  // ---------------------------------------------------------------------------
  const state = {
    "mf.settings": { engine: { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen3" }, panel: {} },
    "mf.sessions": {
      "demo::demo-dashboard": {
        key: "demo::demo-dashboard",
        host: "demo",
        title: "Dashboard spese (demo)",
        createdAt: 1,
        updatedAt: 2,
        activeNodeId: "cp6",
        nodes: chainNodes(6),
      },
    },
  };
  const w = buildPanelDom(state);
  await sleep(600);

  const nodes = w.document.querySelectorAll("#mf-graph .mf-node");
  assert("A1. catena di 7 nodi disegnata", nodes.length === 7, "trovati " + nodes.length);

  const zig = [0, 194, 0, 194, 0, 194, 0]; // X attese: colonna sx/dx alternata
  let okPos = true;
  for (let i = 0; i < 7; i++) {
    const p = pos(w, i);
    if (!p || Math.abs(p.x - zig[i]) > 0.01 || Math.abs(p.y - i * 52) > 0.01) {
      okPos = false;
      assert("A2. posizione nodo " + i + " (attesa " + zig[i] + "," + i * 52 + ")", false, p ? p.x + "," + p.y : "niente transform");
    }
  }
  if (okPos) assert("A2. scaletta: colonne alternate (0/194) e passo verticale 52px", true);

  const H = parseInt(w.document.getElementById("mf-graph").getAttribute("height"), 10);
  // classico: 6*84 + 54 + 34 + 24 = 606;  scaletta: 6*52 + 54 + 34 + 24 = 424
  assert("A3. altezza SVG quasi dimezzata (424 invece di 606)", H === 424, "H=" + H);
  const W = parseInt(w.document.getElementById("mf-graph").getAttribute("width"), 10);
  assert("A4. larghezza SVG su due colonne (392)", W === 392, "W=" + W);

  // Arco root→cp1: da (79, 54) a (283, 52): S morbida, NON i controlli ±28 verticali.
  const firstEdge = w.document.querySelector("#mf-graph .mf-edge");
  const nums = (firstEdge.getAttribute("d") || "").match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert(
    "A5. arco della scaletta con curva a S (controlli alla stessa quota dei capi)",
    Math.abs(nums[3] - 54) < 0.01 && Math.abs(nums[5] - 52) < 0.01 && Math.abs(nums[7] - 52) < 0.01,
    "d=" + firstEdge.getAttribute("d")
  );

  // --- B. FIRMA: il poll della chat NON ricostruisce nulla --------------------
  const before = Array.from(w.document.querySelectorAll("#mf-graph .mf-node"));
  const svgChildrenBefore = w.document.getElementById("mf-graph").childNodes.length;
  w.postMessage(
    { type: "mindflow:messages", info: { host: "demo", convKey: "demo-dashboard", title: "Dashboard spese (demo)" }, messages: [] },
    "*"
  );
  await sleep(250);
  const after = w.document.querySelectorAll("#mf-graph .mf-node");
  const svgChildrenAfter = w.document.getElementById("mf-graph").childNodes.length;
  assert(
    "B1. poll senza cambi: gli elementi .mf-node restano GLI STESSI oggetti (no rebuild)",
    after.length === before.length && before.every((el, i) => el === after[i]),
    "ricostruiti " + after.length + " nodi"
  );
  assert(
    "B2. l'SVG non è stato svuotato/riempito",
    svgChildrenAfter === svgChildrenBefore,
    svgChildrenBefore + " → " + svgChildrenAfter
  );

  // --- C. Il click sul nodo cambia la selezione → ridisegno VERO --------------
  const oldCp1 = node(w, 1);
  oldCp1.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(120);
  const newCp1 = node(w, 1);
  assert(
    "C1. click su un capitolo: ridisegnato con classe mf-selected",
    newCp1 !== oldCp1 && newCp1.classList.contains("mf-selected"),
    "stesso elemento o senza mf-selected"
  );
  assert(
    "C2. il dettaglio del checkpoint selezionato è aperto",
    !w.document.getElementById("mf-details").classList.contains("mf-hidden")
  );

  // e il poll successivo torna a saltare (firma aggiornata dalla selezione)
  const before2 = Array.from(w.document.querySelectorAll("#mf-graph .mf-node"));
  w.postMessage(
    { type: "mindflow:messages", info: { host: "demo", convKey: "demo-dashboard", title: "Dashboard spese (demo)" }, messages: [] },
    "*"
  );
  await sleep(250);
  const after2 = w.document.querySelectorAll("#mf-graph .mf-node");
  assert(
    "C3. dopo il ridisegno, il poll torna a NON ricostruire",
    before2.every((el, i) => el === after2[i])
  );

  // ---------------------------------------------------------------------------
  // D. Bivio vero: layout ad albero classico, invariato
  // ---------------------------------------------------------------------------
  const biforcazione = {
    "mf.settings": { engine: { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen3" }, panel: {} },
    "mf.sessions": {
      "demo::demo-dashboard": {
        key: "demo::demo-dashboard",
        host: "demo",
        title: "Dashboard spese (demo)",
        createdAt: 1,
        updatedAt: 2,
        activeNodeId: "cpB",
        nodes: [
          { id: "root", parentId: null, createdAt: 1, title: "Inizio conversazione", summary: "", keyDecisions: [], msgIndex: 0 },
          { id: "cpA", parentId: "root", createdAt: 2, title: "Primo capitolo", summary: "s", keyDecisions: [], msgIndex: 4, chapterIndex: 1, chapterCount: 2, chapterFrom: 1, chapterTo: 4 },
          { id: "cpB", parentId: "cpA", createdAt: 3, title: "Secondo capitolo", summary: "s", keyDecisions: [], msgIndex: 8, chapterIndex: 2, chapterCount: 2, chapterFrom: 5, chapterTo: 8 },
          { id: "cpC", parentId: "cpA", createdAt: 4, title: "Ramo alternativo", summary: "s", keyDecisions: [], msgIndex: 10, chapterIndex: 3, chapterCount: 3, chapterFrom: 5, chapterTo: 10 },
        ],
      },
    },
  };
  const w2 = buildPanelDom(biforcazione);
  await sleep(600);
  const pB = pos(w2, 2); // cpB: foglia slot 0
  const pC = pos(w2, 3); // cpC: foglia slot 1
  const pA = pos(w2, 1); // cpA: padre centrato sui figli
  assert("D1. bivio: le due foglie distano COL_W (186)", pB && pC && Math.abs(Math.abs(pC.x - pB.x) - 186) < 0.01, JSON.stringify({ pB, pC }));
  assert("D2. bivio: il padre è centrato tra i figli", pA && Math.abs(pA.x - (pB.x + pC.x) / 2) < 0.01, "pA=" + JSON.stringify(pA));
  assert("D3. bivio: righe del layout classico (84px)", pA && pB && Math.abs(pB.y - 2 * 84) < 0.01, "pB.y=" + (pB && pB.y));

  console.log("\nRisultato: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("ERRORE:", e);
  process.exit(1);
});
