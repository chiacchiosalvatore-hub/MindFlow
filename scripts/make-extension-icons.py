#!/usr/bin/env python3
"""Genera le icone PNG per l'estensione MindFlow Companion.

Design: quadrato arrotondato scuro con tre nodi smeraldo collegati
(mini-grafo di checkpoint).
"""

import os

from PIL import Image, ImageDraw

EMERALD = (16, 185, 129)      # #10b981
EMERALD_SOFT = (16, 185, 129, 90)
BG = (9, 12, 11)              # #090c0b
BORDER = (39, 47, 44)


def draw_icon(size: int) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Sfondo arrotondato
    radius = max(2, int(s * 0.22))
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG, outline=BORDER, width=max(1, s // 64))

    # Geometria del grafo (coordinate normalizzate)
    #   A (alto sx) --- B (alto dx)
    #        \        /
    #         C (basso centro)
    pad = s * 0.24
    ax, ay = pad, pad * 0.95
    bx, by = s - pad, pad * 0.95
    cx, cy = s / 2, s - pad * 0.85
    r = s * 0.105          # raggio nodi
    lw = max(1, int(s * 0.045))  # spessore link

    # Link
    d.line([ax, ay, bx, by], fill=EMERALD_SOFT, width=lw)
    d.line([ax, ay, cx, cy], fill=EMERALD, width=lw)
    d.line([bx, by, cx, cy], fill=EMERALD, width=lw)

    # Nodi (B = attivo, pieno)
    for (x, y, rr, col) in ((ax, ay, r * 0.85, EMERALD), (bx, by, r, EMERALD), (cx, cy, r * 0.85, EMERALD)):
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col, outline=(230, 255, 244), width=max(1, s // 110))

    return img


def main() -> None:
    # Percorso relativo alla posizione di questo script: funziona in qualsiasi
    # clone del repository (override opzionale: variabile MINDFLOW_ICONS_DIR).
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.environ.get(
        "MINDFLOW_ICONS_DIR", os.path.join(repo_root, "mindflow-extension", "icons")
    )
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        img = draw_icon(size)
        img.save(f"{out_dir}/icon-{size}.png")
        print(f"icon-{size}.png ok")


if __name__ == "__main__":
    main()
