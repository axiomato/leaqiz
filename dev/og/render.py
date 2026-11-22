#!/usr/bin/env python3
"""Erzeugt das Vorschaubild für geteilte Links aus dev/og/vorschaubild.html.

Aufruf:  python3 dev/og/render.py
Ergebnis: public/img/og-leaqizz.png (1200 × 630, PNG)
Braucht: playwright (Python) mit Chromium, Pillow.
"""
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "dev" / "og" / "vorschaubild.html"
OUT = ROOT / "public" / "img" / "og-leaqizz.png"

OUT.parent.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
    page.goto(SRC.as_uri())
    page.evaluate("document.fonts.ready")
    page.wait_for_function("document.fonts.check('800 72px Archivo')")
    page.screenshot(path=str(OUT), full_page=False)
    browser.close()

# Flächenfarben ohne Verlauf: eine Palette mit 64 Farben genügt und hält die Datei klein.
img = Image.open(OUT).convert("RGB").quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
img.save(OUT, optimize=True)
w, h = Image.open(OUT).size
print(f"{OUT.relative_to(ROOT)}: {w} × {h}, {OUT.stat().st_size // 1024} KB")
