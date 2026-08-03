#!/usr/bin/env python3
"""Erzeugt die App-Icons (Waben-Motiv) – einmalig ausgeführt."""
import math
from PIL import Image, ImageDraw

COMB = (30, 26, 20)
HONEY = (217, 142, 4)
HONEY_LT = (245, 197, 66)
CREAM = (250, 246, 238)


def hexagon(cx, cy, r, rot=0):
    pts = []
    for i in range(6):
        a = math.radians(60 * i - 90 + rot)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def make(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Hintergrund (maskable: vollflächig mit Sicherheitsrand)
    pad = int(size * 0.0)
    d.rounded_rectangle([pad, pad, size - pad, size - pad],
                        radius=int(size * 0.22), fill=COMB)

    cx = cy = size / 2
    scale = 0.62 if maskable else 0.72
    R = size * scale / 2

    # Wabenraster: zentrale Wabe + Ring
    cell = R * 0.42
    coords = [(cx, cy)]
    for i in range(6):
        a = math.radians(60 * i - 90)
        coords.append((cx + cell * 1.74 * math.cos(a), cy + cell * 1.74 * math.sin(a)))

    for (x, y) in coords:
        d.polygon(hexagon(x, y, cell), outline=HONEY, width=max(3, int(size * 0.012)))

    # Zentrale Wabe gefüllt mit Honig + Tropfen-Glanz
    d.polygon(hexagon(cx, cy, cell), fill=HONEY, outline=HONEY_LT,
              width=max(3, int(size * 0.012)))
    gr = cell * 0.34
    d.ellipse([cx - gr, cy - gr * 1.3, cx + gr * 0.2, cy + gr * 0.1], fill=HONEY_LT)

    return img


for s in (192, 512):
    make(s).save(f"static/icon-{s}.png")
make(512, maskable=True).save("static/icon-maskable-512.png")
print("Icons erstellt:", "icon-192.png, icon-512.png, icon-maskable-512.png")
