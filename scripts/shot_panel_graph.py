#!/usr/bin/env python3
"""
Screenshot del pannello MindFlow in modalità demo con grafo costruito (v1.2.0).
Replica di scripts/shot-panel-graph.js (Playwright Python, stesso output):
  /tmp/render/mf-graph-empty.png    -> stato vuoto (pulsante «Costruisci il grafo»)
  /tmp/render/mf-graph-boom.png     -> grafo a scaletta costruito
  /tmp/render/mf-graph-details.png  -> dettaglio di un checkpoint selezionato
Serve alla verifica visiva delle migliorie di resa grafica.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

SRC = Path("/home/z/my-project/mindflow-extension")
OUT = Path("/tmp/render")
OUT.mkdir(parents=True, exist_ok=True)

DEMO_STATE = {
    "mf.settings": {
        "engine": {"kind": "ollama", "baseUrl": "http://127.0.0.1:11434", "model": "gemma3"},
        "panel": {},
    },
    "mf.sessions": {},
}

# Variante v1.2.0: sessione PRECARICATA con una catena di 9 nodi (root + 8
# capitoli realistici) — il grafo della demo standard ha 1 solo capitolo e non
# basta a vedere la scaletta su due colonne.
CHAIN_TITLES = [
    "Obiettivi del progetto",
    "Scelta dello stack",
    "Struttura del database",
    "Autenticazione e ruoli",
    "API di lettura",
    "Dashboard e grafici",
    "Errori e retry",
    "Pubblicazione v1",
]


def chain_state():
    nodes = [
        {
            "id": "root", "parentId": None, "createdAt": 1,
            "title": "Inizio conversazione", "summary": "", "keyDecisions": [], "msgIndex": 0,
        }
    ]
    for i, t in enumerate(CHAIN_TITLES, start=1):
        nodes.append(
            {
                "id": "cp" + str(i),
                "parentId": "root" if i == 1 else "cp" + str(i - 1),
                "createdAt": i + 1,
                "title": t,
                "summary": "Il capitolo «" + t + "» viene compresso in questo checkpoint.",
                "keyDecisions": [],
                "msgIndex": i * 6,
                "chapterIndex": i,
                "chapterCount": len(CHAIN_TITLES),
                "chapterFrom": (i - 1) * 6 + 1,
                "chapterTo": i * 6,
            }
        )
    return {
        "mf.settings": DEMO_STATE["mf.settings"],
        "mf.sessions": {
            "demo::demo-dashboard": {
                "key": "demo::demo-dashboard",
                "host": "demo",
                "title": "Dashboard spese (demo)",
                "createdAt": 1,
                "updatedAt": 2,
                "activeNodeId": "cp" + str(len(CHAIN_TITLES)),
                "nodes": nodes,
            }
        },
    }

def main():
    html = (SRC / "panel.html").read_text(encoding="utf-8")
    html = html.replace("<head>", '<head><base href="file://' + str(SRC) + '/">', 1)
    tmp = Path("/tmp/mf-panel-check.html")
    tmp.write_text(html, encoding="utf-8")

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1180, "height": 860})
        page.add_init_script(
            "localStorage.setItem('mf.demo.state', " + json.dumps(json.dumps(chain_state())) + ");"
        )
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on(
            "console",
            lambda m: errors.append("console: " + m.text)
            if m.type == "error" and "ERR_CONNECTION_REFUSED" not in m.text and "Failed to load resource" not in m.text
            else None,
        )
        page.goto("file://" + str(tmp))
        page.wait_for_timeout(900)
        page.evaluate("document.documentElement.style.background = '#0a0e0d'")
        page.screenshot(path=str(OUT / "mf-graph-empty.png"))

        # Costruzione del grafo in demo: clic sul pulsante dello stato vuoto.
        build_btn = page.locator("#mf-empty-build")
        if build_btn.is_visible():
            build_btn.click()
            page.wait_for_timeout(4200)
        page.screenshot(path=str(OUT / "mf-graph-boom.png"), full_page=True)

        # Dettagli: clic sul secondo nodo (primo checkpoint).
        node = page.locator("#mf-graph .mf-node").nth(1)
        if node.count():
            node.click(force=True)
            page.wait_for_timeout(500)
            page.screenshot(path=str(OUT / "mf-graph-details.png"))

        browser.close()

    if errors:
        print("ERRORI JS:\n" + "\n".join(errors))
        raise SystemExit(1)
    print("screenshot ok: mf-graph-empty.png, mf-graph-boom.png, mf-graph-details.png")

if __name__ == "__main__":
    main()
