// Vorschaubild für geteilte Links: Landingpage, Spielerseite und Spielleitung zeigen
// dasselbe Bild. Die Adresse muss auf eine Datei unter public/ zeigen, die ein PNG mit
// 1200 × 630 Pixeln ist; sonst zeigen Messenger eine leere Vorschau.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', 'public');
const BASE = 'https://axiomato.github.io/leaqiz/';
const PAGES = ['index.html', 'host/index.html', 'lehrkraefte/index.html'];

function meta(html, key) {
  const re = new RegExp(`<meta\\s+(?:property|name)="${key.replace(/[:]/g, '\\$&')}"\\s+content="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

for (const page of PAGES) {
  test(`${page}: Vorschaubild vollständig angegeben`, () => {
    const html = readFileSync(join(root, page), 'utf8');
    const img = meta(html, 'og:image');
    assert.ok(img, 'og:image fehlt');
    assert.ok(img.startsWith(BASE), `og:image muss absolut unter ${BASE} liegen: ${img}`);
    const file = join(root, img.slice(BASE.length).split('?')[0]);
    assert.ok(existsSync(file), `Bilddatei fehlt: ${file}`);
    const png = readFileSync(file);
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', 'keine PNG-Datei');
    assert.equal(png.readUInt32BE(16), 1200, 'Breite nicht 1200');
    assert.equal(png.readUInt32BE(20), 630, 'Höhe nicht 630');
    assert.equal(meta(html, 'og:image:width'), '1200');
    assert.equal(meta(html, 'og:image:height'), '630');
    assert.ok(meta(html, 'og:image:alt'), 'og:image:alt fehlt');
    assert.ok(meta(html, 'og:title'), 'og:title fehlt');
    assert.ok(meta(html, 'og:description'), 'og:description fehlt');
    assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
  });
}
