#!/usr/bin/env node
// Erzeugt die Motive der Landingpage nach public/img/ (Bildsprache, D-62).
//
//   node dev/motive/erzeugen.js           schreibt die SVG-Dateien
//   node dev/motive/erzeugen.js --check   meldet Dateien, die vom Generator abweichen (Exit 1)
//
// Korrekturen gehören hierher, nie in die SVG-Dateien. test/motive.test.js prüft beides.
'use strict';

const fs = require('fs');
const path = require('path');
const { wesen, punkt, hand, farbe, req, svg, ANTWORT, WHITE, INK, SUN, PINK, HELLBLAU, SW, linie } = require('./wesen.js');

const B = 360;
const H = 280;
const Y = 250; // Bodenlinie

function quizWaehlen() {
  const karte = (k) =>
    `<g transform="rotate(-12 100 24)"><rect x="80" y="8" width="40" height="29" rx="5" fill="${WHITE}" stroke="${INK}" stroke-width="${SW}"/>` +
    linie('M87 18H113M87 27H104', 3) + '</g>' + hand(92, 38, k);
  return svg(
    B,
    H,
    req.boden(175, Y, 230) +
      req.karten(214, Y - 44, 74) +
      wesen({ form: 'tropfen', augen: 'lachen', mund: 'laecheln', farbe: 'himmel', x: 122, y: Y, groesse: 160, arme: 'winken', vorne: karte }) +
      req.funkeln(60, 96, 1.6) + req.funkeln(300, 92, 1.3, HELLBLAU) + req.funkeln(214, 60, 1.1),
  );
}

function pinZeigen() {
  const w = { form: 'geist', augen: 'punkte', mund: 'luecke', farbe: 'flieder', x: 180, y: Y, groesse: 150, arme: 'hoch' };
  const [lx, ly] = punkt(w, 10, 36);
  const [rx] = punkt(w, 90, 36);
  const bw = rx - lx + 40;
  const bh = bw * 0.46;
  return svg(
    B,
    H,
    req.boden(180, Y, 160) +
      wesen(w) +
      req.pin(lx - 20, ly - bh + 6, bw, '4712') +
      hand(lx, ly, farbe('flieder')) + hand(rx, ly, farbe('flieder')) +
      req.funkeln(60, 120, 1.3, HELLBLAU) + req.funkeln(306, 150, 1.2),
  );
}

function antworten() {
  const w = { form: 'blob', augen: 'glubsch', mund: 'zunge', farbe: 'minze', x: 112, y: Y, groesse: 150, arme: 'tippen' };
  const [hx, hy] = punkt(w, 119, 58);
  const pb = 60;
  const px = hx - 17.7;
  const py = Y - pb * 1.75;
  const s = w.groesse / 100;
  return svg(
    B,
    H,
    req.boden(165, Y, 250) +
      wesen(w) +
      req.handy(px, py, pb, 'A') +
      `<circle cx="${hx}" cy="${hy}" r="${4.5 * s}" fill="${farbe('minze')}" stroke="${INK}" stroke-width="${2.5 * s}"/>` +
      req.funkeln(px + pb + 24, py + 10, 1.3) + req.funkeln(48, 110, 1.2, HELLBLAU),
  );
}

function podium() {
  const stufe = (x, h, i) => `<rect x="${x}" y="${Y - h}" width="90" height="${h}" rx="8" fill="${ANTWORT[i].hex}"/>`;
  return svg(
    B,
    H,
    req.konfetti([
      ['r', 48, 50, SUN, -25], ['k', 86, 82, HELLBLAU], ['r', 118, 40, PINK, 30], ['k', 248, 44, SUN],
      ['r', 290, 76, HELLBLAU, -35], ['r', 318, 40, SUN, 20], ['k', 60, 118, PINK], ['k', 312, 122, SUN],
    ]) +
      `<g stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round">${stufe(45, 52, 2)}${stufe(225, 34, 1)}${stufe(135, 78, 0)}</g>` +
      req.boden(180, Y, 310) +
      wesen({ form: 'blob', augen: 'punkte', mund: 'laecheln', extra: 'antenne', farbe: 'minze', x: 90, y: Y - 52, groesse: 100, neigung: -4 }) +
      wesen({ form: 'wolke', augen: 'punkte', mund: 'oh', farbe: 'rosa', x: 270, y: Y - 34, groesse: 100, neigung: 3 }) +
      wesen({ form: 'ei', augen: 'lachen', mund: 'luecke', extra: 'krone', farbe: 'butter', x: 180, y: Y - 78, groesse: 104, arme: 'hoch' }) +
      req.funkeln(132, 70, 1.4) + req.funkeln(230, 64, 1.4),
  );
}

// Ziel (relativ zu public/img/) → Motiv
const MOTIVE = {
  'runde/quiz-waehlen.svg': quizWaehlen,
  'runde/pin-zeigen.svg': pinZeigen,
  'runde/antworten.svg': antworten,
  'runde/podium.svg': podium,
};

const ZIEL = path.join(__dirname, '..', '..', 'public', 'img');

function erzeugen() {
  return Object.fromEntries(Object.entries(MOTIVE).map(([datei, motiv]) => [datei, motiv()]));
}

if (require.main === module) {
  const nurPruefen = process.argv.includes('--check');
  let abweichend = 0;
  for (const [datei, inhalt] of Object.entries(erzeugen())) {
    const ziel = path.join(ZIEL, datei);
    const alt = fs.existsSync(ziel) ? fs.readFileSync(ziel, 'utf8') : null;
    if (nurPruefen) {
      if (alt !== inhalt) {
        abweichend++;
        console.error(`weicht ab: public/img/${datei}`);
      }
      continue;
    }
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, inhalt);
    console.log(`public/img/${datei}  ${Buffer.byteLength(inhalt)} B${alt === inhalt ? ' (unverändert)' : ''}`);
  }
  if (nurPruefen) {
    console.log(abweichend ? `${abweichend} Motiv(e) weichen ab: node dev/motive/erzeugen.js` : 'Alle Motive entsprechen dem Generator.');
    process.exit(abweichend ? 1 : 0);
  }
}

module.exports = { erzeugen, MOTIVE };
