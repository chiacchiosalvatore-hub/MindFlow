#!/usr/bin/env python3
"""Incorpora lo screenshot reale come data URI nella vetrina docs/index.html.

Genera due varianti:
- download/MindFlow-vetrina-standalone.html: screenshot incorporato (apribile ovunque);
- docs/index.html nel bundle locale: src relativo img/… con fallback (per il repository,
  dove le PNG vengono caricate a parte).
"""
import base64
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent / "download" / "MindFlow-repo-content"
DOCS = REPO / "docs"
IMG = DOCS / "img" / "anteprima-grafo-costruito.png"
HTML = DOCS / "index.html"
STANDALONE = REPO / "MindFlow-vetrina-standalone.html"

b64 = base64.b64encode(IMG.read_bytes()).decode("ascii")
data_uri = "data:image/png;base64," + b64

html = HTML.read_text(encoding="utf-8")
assert "__SHOT_BOOM__" in html, "segnaposto mancante"
html = html.replace("__SHOT_BOOM__", data_uri)

# 1. Variante standalone: copia così com'è.
STANDALONE.write_text(html, encoding="utf-8")

# 2. Variante repo: data URI -> percorso relativo con fallback.
pattern = re.compile(r'src="data:image/png;base64,[^"]*"')
assert len(pattern.findall(html)) == 1, "attesa 1 immagine data URI"
html_repo = pattern.sub(
    'src="img/anteprima-grafo-costruito.png" '
    'onerror="this.closest(\'figure\').style.display=\'none\'"',
    html,
)
HTML.write_text(html_repo, encoding="utf-8")

print(f"standalone: {STANDALONE.stat().st_size} bytes")
print(f"repo index.html: {HTML.stat().st_size} bytes")
