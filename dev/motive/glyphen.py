#!/usr/bin/env python3
"""Schreibt die Umrisse der Zeichen, die in Motiven vorkommen, als SVG-Pfade nach glyphen.json.

Ein Motiv wird als <img> eingebunden und kann dort keine Webschrift laden. Buchstaben und Ziffern
stehen deshalb als Pfade im SVG, aus derselben Archivo wie die Seite (Gewicht 800, Breite 100).

Aufruf:  python3 dev/motive/glyphen.py
Braucht: fontTools mit Brotli (pip install fonttools brotli). Nur nötig, wenn sich Zeichen oder Schrift ändern.
"""
import json
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "public" / "fonts" / "archivo-wdth.woff2"
OUT = Path(__file__).with_name("glyphen.json")
ZEICHEN = "ABCD0123456789"

font = instantiateVariableFont(TTFont(FONT), {"wght": 800, "wdth": 100})
cmap = font.getBestCmap()
glyphs = font.getGlyphSet()
hmtx = font["hmtx"]
os2 = font["OS/2"]

daten = {"upm": font["head"].unitsPerEm, "versal": os2.sCapHeight, "zeichen": {}}
for z in ZEICHEN:
    name = cmap[ord(z)]
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(pen)
    daten["zeichen"][z] = {"d": pen.getCommands(), "breite": hmtx[name][0]}

OUT.write_text(json.dumps(daten, ensure_ascii=False, indent=1) + "\n")
print(f"{OUT.relative_to(ROOT)}: {len(ZEICHEN)} Zeichen, Versalhöhe {daten['versal']} / {daten['upm']}")
