"""Teile-Bogen der Avatare als PNG: python3 dev/avatar/render.py [ziel.png]"""
import asyncio, pathlib, sys
from playwright.async_api import async_playwright
HERE = pathlib.Path(__file__).resolve().parent
OUT = sys.argv[1] if len(sys.argv) > 1 else str(HERE / 'bogen.png')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1600, 'height': 900}, device_scale_factor=1)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto((HERE / 'bogen.html').as_uri()); await pg.evaluate('document.fonts.ready')
        await pg.screenshot(path=OUT, full_page=True)
        print(OUT, 'Fehler:', errs or 'keine'); await b.close()
asyncio.run(main())
