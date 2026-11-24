#!/usr/bin/env node
// Erzeugt die Motive der Bildsprache nach public/img/ (D-62).
//
//   node dev/motive/erzeugen.js           schreibt die SVG-Dateien
//   node dev/motive/erzeugen.js --check   meldet Dateien, die vom Generator abweichen oder übrig sind (Exit 1)
//
// Jedes Motiv hat zwei Ebenen gleicher Größe: <name>-buehne.svg (Boden, Requisiten, Funkeln) als Datei und
// die Wesen-Ebene (die Wesen mit allem, was sie halten) als inline-SVG in der Seite, zwischen den Marken
// <!-- motiv:<name> --> und <!-- /motiv:<name> -->. Inline, damit Augen, Mund, Hut und Körper sich leise
// bewegen (D-65). Die Seite legt die Ebenen übereinander. Motive ohne Bühne bestehen nur aus der Wesen-Ebene.
// Korrekturen gehören hierher, nie in die SVG-Dateien. test/motive.test.js prüft beides.
'use strict';

const fs = require('fs');
const path = require('path');
const { wesen, punkt, hand, farbe, req, svg, linie, ANTWORT, WHITE, INK, SUN, PINK, HELLBLAU, SW } = require('./wesen.js');

const kreis = (x, y, s, k) => `<circle cx="${x}" cy="${y}" r="${4.5 * s}" fill="${k}" stroke="${INK}" stroke-width="${2.5 * s}"/>`;

// ---------- So läuft eine Runde (360 × 280, Boden bei 250) ----------

const B = 360;
const H = 280;
const Y = 250;

const quizWaehlen = {
  b: B, h: H,
  buehne: () => req.boden(175, Y, 230) + req.karten(214, Y - 44, 74) + req.funkeln(60, 96, 1.6) + req.funkeln(300, 92, 1.3, HELLBLAU) + req.funkeln(214, 60, 1.1),
  wesen: () =>
    wesen({
      form: 'tropfen', augen: 'lachen', mund: 'laecheln', farbe: 'himmel', x: 122, y: Y, groesse: 160, arme: 'winken',
      vorne: (k) =>
        `<g transform="rotate(-12 100 24)"><rect x="80" y="8" width="40" height="29" rx="5" fill="${WHITE}" stroke="${INK}" stroke-width="${SW}"/>` +
        linie('M87 18H113M87 27H104', 3) + '</g>' + hand(92, 38, k),
    }),
};

const pinZeigen = (() => {
  const w = { form: 'geist', augen: 'punkte', mund: 'luecke', farbe: 'flieder', x: 180, y: Y, groesse: 150, arme: 'hoch' };
  const [lx, ly] = punkt(w, 10, 36);
  const [rx] = punkt(w, 90, 36);
  const bw = rx - lx + 40;
  const bh = bw * 0.46;
  return {
    b: B, h: H,
    buehne: () => req.boden(180, Y, 160) + req.funkeln(60, 120, 1.3, HELLBLAU) + req.funkeln(306, 150, 1.2),
    wesen: () => wesen(w) + req.pin(lx - 20, ly - bh + 6, bw, '4712') + hand(lx, ly, farbe('flieder')) + hand(rx, ly, farbe('flieder')),
  };
})();

const antworten = (() => {
  const w = { form: 'blob', augen: 'glubsch', mund: 'zunge', farbe: 'minze', x: 112, y: Y, groesse: 150, arme: 'tippen' };
  const [hx, hy] = punkt(w, 119, 58);
  const pb = 60;
  const px = hx - 17.7;
  const py = Y - pb * 1.75;
  return {
    b: B, h: H,
    buehne: () => req.boden(165, Y, 250) + req.handy(px, py, pb, 'A') + req.funkeln(px + pb + 24, py + 10, 1.3) + req.funkeln(48, 110, 1.2, HELLBLAU),
    wesen: () => wesen(w) + kreis(hx, hy, w.groesse / 100, farbe('minze')),
  };
})();

const podium = {
  b: B, h: H,
  buehne: () => {
    const stufe = (x, h, i) => `<rect x="${x}" y="${Y - h}" width="90" height="${h}" rx="8" fill="${ANTWORT[i].hex}"/>`;
    return (
      req.konfetti([
        ['r', 48, 50, SUN, -25], ['k', 86, 82, HELLBLAU], ['r', 118, 40, PINK, 30], ['k', 248, 44, SUN],
        ['r', 290, 76, HELLBLAU, -35], ['r', 318, 40, SUN, 20], ['k', 60, 118, PINK], ['k', 312, 122, SUN],
      ]) +
      `<g stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round">${stufe(45, 52, 2)}${stufe(225, 34, 1)}${stufe(135, 78, 0)}</g>` +
      req.boden(180, Y, 310) + req.funkeln(132, 70, 1.4) + req.funkeln(230, 64, 1.4)
    );
  },
  wesen: () =>
    wesen({ form: 'blob', augen: 'punkte', mund: 'laecheln', extra: 'antenne', farbe: 'minze', x: 90, y: Y - 52, groesse: 100, neigung: -4 }) +
    wesen({ form: 'wolke', augen: 'punkte', mund: 'oh', farbe: 'rosa', x: 270, y: Y - 34, groesse: 100, neigung: 3 }) +
    wesen({ form: 'ei', augen: 'lachen', mund: 'luecke', extra: 'krone', farbe: 'butter', x: 180, y: Y - 78, groesse: 104, arme: 'hoch' }),
};

// ---------- Leinwand und Handy (360 × 280) ----------

const leinwandHandy = {
  b: B, h: H,
  buehne: () => req.leinwand(166, 46, 178, [0.4, 0.9, 0.3, 0.55]) + req.boden(170, Y, 300) + req.funkeln(40, 70, 1.4) + req.funkeln(140, 34, 1.1, HELLBLAU),
  wesen: () =>
    wesen({
      form: 'wolke', augen: 'funkeln', mund: 'laecheln', farbe: 'rosa', x: 92, y: Y, groesse: 150, arme: 'winken',
      vorne: (k) => req.handy(81, 0, 22, 'B') + hand(92, 38, k),
    }),
};

// ---------- Vier Momente (240 × 200, Boden bei 185) ----------

const MB = 240;
const MH = 200;
const MY = 185;

const stundeneinstieg = {
  b: MB, h: MH,
  buehne: () => req.boden(118, MY, 150) + req.funkeln(36, 74, 1.3, HELLBLAU) + req.funkeln(214, 132, 1.1),
  wesen: () =>
    wesen({
      form: 'ei', augen: 'lachen', mund: 'laecheln', extra: 'partyhut', farbe: 'aprikose', x: 104, y: MY, groesse: 124, arme: 'heben', neigung: 3,
      vorne: (k) => req.kaffee(92, 40, 24) + hand(95, 58, k),
    }),
};

const wiederholung = {
  b: MB, h: MH,
  buehne: () => req.boden(120, MY, 190) + req.hefte(60, MY, 120, ['#c9d6ff', '#b8f2e6', '#ffe8a3']) + req.funkeln(36, 60, 1.3) + req.funkeln(206, 72, 1.2, HELLBLAU),
  wesen: () => wesen({ form: 'knolle', augen: 'glubsch', mund: 'laecheln', extra: 'spross', farbe: 'limette', x: 121, y: MY - 50, groesse: 98, arme: 'hoch' }),
};

const exitTicket = {
  b: MB, h: MH,
  buehne: () => req.tuer(150, 34, 66, MY - 34, '#e5dbff') + req.boden(118, MY, 200) + req.funkeln(34, 62, 1.2, HELLBLAU),
  wesen: () =>
    wesen({
      form: 'zipfel', augen: 'punkte', mund: 'laecheln', farbe: 'butter', x: 84, y: MY, groesse: 118, arme: 'winken',
      vorne: (k) => `<g transform="rotate(-10 96 24)">${req.ticket(78, 12, 36, 22, '#b8f2e6')}</g>` + hand(92, 38, k),
    }),
};

const konferenz = {
  b: MB, h: MH,
  buehne: () => req.boden(120, MY, 220) + req.funkeln(40, 52, 1.2, HELLBLAU) + req.funkeln(204, 44, 1.3),
  wesen: () => {
    const schild = () => req.namensschild(34, 79, 32);
    return (
      wesen({ form: 'blob', augen: 'punkte', mund: 'laecheln', farbe: 'minze', x: 50, y: MY, groesse: 98, neigung: -4, vorne: schild }) +
      wesen({ form: 'wuerfel', augen: 'glubsch', mund: 'laecheln', extra: 'tolle', farbe: 'aprikose', x: 190, y: MY, groesse: 98, neigung: 4, vorne: schild }) +
      wesen({ form: 'geist', augen: 'lachen', mund: 'laecheln', extra: 'schleife', farbe: 'flieder', x: 120, y: MY, groesse: 106, vorne: schild })
    );
  },
};

const datensparsam = {
  b: MB, h: MH,
  buehne: () => req.boden(118, MY, 160) + req.funkeln(34, 66, 1.3, HELLBLAU) + req.funkeln(212, 150, 1.1),
  wesen: () =>
    wesen({
      form: 'knolle', augen: 'punkte', mund: 'laecheln', farbe: 'himmel', x: 98, y: MY, groesse: 124, arme: 'heben',
      vorne: (k) => req.umschlag(90, 34, 40) + hand(95, 58, k),
    }),
};

// ---------- Preisseite: Wesen mit Krone auf der Karte „Jahrespass“ (120 × 120, nur Wesen) ----------

const jahrespass = {
  b: 120, h: 120,
  wesen: () => wesen({ form: 'ei', augen: 'lachen', mund: 'luecke', extra: 'krone', farbe: 'butter', x: 60, y: 116, groesse: 92, arme: 'hoch' }),
};

// Name (relativ zu public/img/) → Motiv
const MOTIVE = {
  'runde/quiz-waehlen': quizWaehlen,
  'runde/pin-zeigen': pinZeigen,
  'runde/antworten': antworten,
  'runde/podium': podium,
  'landing/leinwand-handy': leinwandHandy,
  'landing/datensparsam': datensparsam,
  'momente/stundeneinstieg': stundeneinstieg,
  'momente/wiederholung': wiederholung,
  'momente/exit-ticket': exitTicket,
  'momente/konferenz': konferenz,
  'preise/jahrespass': jahrespass,
};

const ZIEL = path.join(__dirname, '..', '..', 'public', 'img');
const ORDNER = [...new Set(Object.keys(MOTIVE).map((n) => n.split('/')[0]))];

// Dateiname (relativ zu public/img/) → Inhalt
function erzeugen() {
  const dateien = {};
  for (const [name, m] of Object.entries(MOTIVE)) {
    if (m.buehne) dateien[`${name}-buehne.svg`] = svg(m.b, m.h, m.buehne());
  }
  return dateien;
}

// Seite je Motiv-Ordner; die Wesen-Ebene steht dort inline
const SEITEN = {
  runde: 'lehrkraefte/index.html',
  landing: 'lehrkraefte/index.html',
  momente: 'lehrkraefte/index.html',
  preise: 'preise/index.html',
};

// Wesen-Ebene als inline-SVG. Jedes Wesen bekommt eine Takt-Klasse t1–t5 (seitenweit reihum),
// damit Blinzeln und Wippen nicht gleichzeitig laufen.
function wesenInline() {
  const bloecke = {};
  let n = 0;
  for (const [name, m] of Object.entries(MOTIVE)) {
    const inhalt = m.wesen().replace(/class="w-wipp"/g, () => `class="w-wipp t${(n++ % 5) + 1}"`);
    bloecke[name] =
      `<!-- motiv:${name} --><svg class="motiv__wesen" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.b} ${m.h}" ` +
      `width="${m.b}" height="${m.h}" focusable="false">${inhalt}</svg><!-- /motiv:${name} -->`;
  }
  return bloecke;
}
const blockMuster = (name) => new RegExp(`<!-- motiv:${name.replace('/', '\\/')} -->[\\s\\S]*?<!-- \\/motiv:${name.replace('/', '\\/')} -->`);

// Seiteninhalt mit den aktuellen Wesen-Ebenen (Datei → neuer Inhalt)
function seitenMitWesen() {
  const bloecke = wesenInline();
  const neu = {};
  for (const [name, block] of Object.entries(bloecke)) {
    const datei = SEITEN[name.split('/')[0]];
    neu[datei] ??= fs.readFileSync(path.join(__dirname, '..', '..', 'public', datei), 'utf8');
    const muster = blockMuster(name);
    if (!muster.test(neu[datei])) throw new Error(`Marke motiv:${name} fehlt in ${datei}`);
    neu[datei] = neu[datei].replace(muster, () => block);
  }
  return neu;
}

// SVG-Dateien in den Motiv-Ordnern, die der Generator nicht (mehr) erzeugt
function uebrig(dateien) {
  const soll = new Set(Object.keys(dateien));
  return ORDNER.flatMap((o) => {
    const dir = path.join(ZIEL, o);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => `${o}/${f}`).filter((f) => !soll.has(f));
  });
}

if (require.main === module) {
  const nurPruefen = process.argv.includes('--check');
  const dateien = erzeugen();
  let fehler = 0;
  for (const [datei, inhalt] of Object.entries(dateien)) {
    const ziel = path.join(ZIEL, datei);
    const alt = fs.existsSync(ziel) ? fs.readFileSync(ziel, 'utf8') : null;
    if (nurPruefen) {
      if (alt !== inhalt) {
        fehler++;
        console.error(`weicht ab: public/img/${datei}`);
      }
      continue;
    }
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, inhalt);
    console.log(`public/img/${datei}  ${Buffer.byteLength(inhalt)} B${alt === inhalt ? ' (unverändert)' : ''}`);
  }
  for (const f of uebrig(dateien)) {
    if (nurPruefen) {
      fehler++;
      console.error(`übrig: public/img/${f}`);
    } else {
      fs.unlinkSync(path.join(ZIEL, f));
      console.log(`entfernt: public/img/${f}`);
    }
  }
  for (const [datei, inhalt] of Object.entries(seitenMitWesen())) {
    const ziel = path.join(__dirname, '..', '..', 'public', datei);
    if (fs.readFileSync(ziel, 'utf8') === inhalt) continue;
    if (nurPruefen) {
      fehler++;
      console.error(`weicht ab: Wesen-Ebenen in public/${datei}`);
    } else {
      fs.writeFileSync(ziel, inhalt);
      console.log(`public/${datei}  Wesen-Ebenen geschrieben`);
    }
  }
  if (nurPruefen) {
    console.log(fehler ? `${fehler} Abweichung(en): node dev/motive/erzeugen.js` : 'Alle Motive entsprechen dem Generator.');
    process.exit(fehler ? 1 : 0);
  }
}

module.exports = { erzeugen, uebrig, wesenInline, seitenMitWesen, blockMuster, SEITEN, MOTIVE };
