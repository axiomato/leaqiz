// Bausteine für Motive der Bildsprache: Wesen aus den Teilen der Avatare (D-38), Requisiten, Schrift als Pfade.
// Regeln: claude/leaqiz-bildsprache.md im Projekt (eine Ink-Kontur, flache Flächen, Antwortfarben nur mit A–D).
// Ein Wesen ist eine <g>, deren Fußpunkt (Mitte unten) auf (x, y) liegt; Maße in px des Motivs.
'use strict';

const path = require('path');
const A = require(path.join(__dirname, '..', '..', 'public', 'js', 'avatar.js'));
const GLYPHEN = require('./glyphen.json');

const { forms: FORMS, eyes: EYES, mouths: MOUTHS, extras: EXTRAS, colors: COLORS, grounds: GROUNDS } = A.PARTS;

const INK = '#121826';
const WHITE = '#ffffff';
const SUN = '#ffd43b';
const PINK = '#ff8fab';
const HELLBLAU = '#74c0fc';
const SW = 3.5;
const ANTWORT = ['A', 'B', 'C', 'D'].map((b, i) => ({ b, hex: GROUNDS[i].hex }));

const r = (n) => +n.toFixed(2);
const teil = (list, id) => {
  const t = list.find((p) => p.id === id);
  if (!t) throw new Error(`Unbekannter Baustein: ${id}`);
  return t;
};
const farbe = (id) => teil(COLORS, id).hex;
const linie = (d, w = SW) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const hand = (x, y, k) => `<circle cx="${r(x)}" cy="${r(y)}" r="4.5" fill="${k}" stroke="${INK}" stroke-width="2.5"/>`;

// Arme im 100er-Raster des Wesens; Schultern links (25, 64), rechts (75, 64). Arm = Konturlinie, Hand = Kreis in Körperfarbe.
const ARME = {
  hoch: (k) => linie('M27 66Q12 56 10 38') + linie('M73 66Q88 56 90 38') + hand(10, 36, k) + hand(90, 36, k),
  winken: (k) => linie('M73 66Q90 58 92 40') + hand(92, 38, k),
  tippen: () => linie('M73 70Q100 72 118 59'),
  heben: () => linie('M73 72Q88 72 94 60'),
};

// Punkt im 100er-Raster eines Wesens (ohne Neigung) → Koordinate im Motiv
function punkt({ x, y, groesse = 100 }, gx, gy) {
  const s = groesse / 100;
  return [r(x + s * (gx - 50)), r(y + s * (gy - 91))];
}

function wesen({ form, augen = 'punkte', mund = 'laecheln', extra = 'ohne', farbe: f = 'butter', x, y, groesse = 100, neigung = 0, arme, vorne }) {
  const F = teil(FORMS, form);
  const X = teil(EXTRAS, extra);
  const k = farbe(f);
  const [fx, fy] = F.face;
  const [tx, ty, ta] = F.top;
  const s = groesse / 100;
  const hut = X.svg() ? `<g transform="translate(${tx} ${ty}) rotate(${ta})">${X.svg()}</g>` : '';
  const gesicht =
    `<g transform="translate(${fx} ${fy}) scale(1.2)">` +
    `<g transform="translate(0 -6)">${teil(EYES, augen).svg()}</g><g transform="translate(0 10)">${teil(MOUTHS, mund).svg()}</g></g>`;
  return (
    `<g transform="translate(${r(x)} ${r(y)}) rotate(${neigung}) scale(${r(s)}) translate(-50 -91)">` +
    (arme ? ARME[arme](k) : '') +
    (X.back ? hut : '') +
    `<path d="${F.d}" fill="${k}" stroke="${INK}" stroke-width="${r(Math.max(SW, 2 / s))}" stroke-linejoin="round"/>` +
    (X.back ? '' : hut) +
    gesicht +
    (vorne ? vorne(k) : '') +
    `</g>`
  );
}

// Text als Pfade, waagerecht mittig um cx, Versalhöhe mittig um cy
function schrift(text, cx, cy, versal, fill, sperrung = 0) {
  const k = versal / GLYPHEN.versal;
  const zeichen = [...text].map((z) => {
    const g = GLYPHEN.zeichen[z];
    if (!g) throw new Error(`Zeichen fehlt in glyphen.json: ${z} (dev/motive/glyphen.py ergänzen)`);
    return g;
  });
  const breite = zeichen.reduce((s, g) => s + g.breite * k, 0) + sperrung * (zeichen.length - 1);
  let x = cx - breite / 2;
  let out = '';
  for (const g of zeichen) {
    out += `<path transform="translate(${r(x)} ${r(cy + versal / 2)}) scale(${r(k * 1000) / 1000} ${-r(k * 1000) / 1000})" d="${g.d}"/>`;
    x += g.breite * k + sperrung;
  }
  return `<g fill="${fill}">${out}</g>`;
}

const req = {
  handy(x, y, b, markiert) {
    const h = b * 1.75;
    const pad = b * 0.12;
    const g = b * 0.06;
    const tw = (b - 2 * pad - g) / 2;
    const th = (h - 2 * pad - g - b * 0.18) / 2;
    let kacheln = '';
    ANTWORT.forEach((a, i) => {
      const kx = x + pad + (i % 2) * (tw + g);
      const ky = y + pad + b * 0.18 + Math.floor(i / 2) * (th + g);
      const ring = a.b === markiert ? ` stroke="${SUN}" stroke-width="${r(b * 0.05)}"` : '';
      kacheln +=
        `<rect x="${r(kx)}" y="${r(ky)}" width="${r(tw)}" height="${r(th)}" rx="${r(b * 0.07)}" fill="${a.hex}"${ring}/>` +
        schrift(a.b, kx + tw / 2, ky + th / 2, b * 0.17, WHITE);
    });
    return (
      `<rect x="${r(x)}" y="${r(y)}" width="${r(b)}" height="${r(h)}" rx="${r(b * 0.16)}" fill="${WHITE}" stroke="${INK}" stroke-width="${SW}"/>` +
      linie(`M${r(x + b * 0.38)} ${r(y + b * 0.1)}H${r(x + b * 0.62)}`, 3) +
      kacheln
    );
  },
  karten(x, y, b) {
    const h = b * 0.72;
    const karte = (dx, dy, w, fill) =>
      `<rect x="${r(x + dx)}" y="${r(y + dy)}" width="${r(b)}" height="${r(h)}" rx="7" fill="${fill}" stroke="${INK}" stroke-width="${SW}"` +
      (w ? ` transform="rotate(${w} ${r(x + dx + b / 2)} ${r(y + dy + h / 2)})"` : '') + '/>';
    return (
      karte(8, -8, 8, '#c9d6ff') + karte(4, -4, -5, '#b8f2e6') + karte(0, 0, 0, WHITE) +
      linie(`M${r(x + b * 0.18)} ${r(y + h * 0.35)}H${r(x + b * 0.82)}M${r(x + b * 0.18)} ${r(y + h * 0.62)}H${r(x + b * 0.6)}`, 3)
    );
  },
  pin(x, y, b, ziffern) {
    const h = b * 0.46;
    return (
      `<rect x="${r(x)}" y="${r(y)}" width="${r(b)}" height="${r(h)}" rx="${r(h * 0.22)}" fill="${WHITE}" stroke="${INK}" stroke-width="${SW}"/>` +
      schrift(ziffern, x + b / 2, y + h / 2, h * 0.42, INK, h * 0.08)
    );
  },
  // Leinwand an der Wand (ohne Fuß): Balken je Antwort, Buchstabe darüber
  leinwand(x, y, b, werte) {
    const h = b * 0.62;
    const pad = b * 0.09;
    const g = b * 0.05;
    const bw = (b - 2 * pad - 3 * g) / 4;
    const basis = y + h - pad;
    const hoch = h - 2 * pad - b * 0.1;
    let s = `<rect x="${r(x)}" y="${r(y)}" width="${r(b)}" height="${r(h)}" rx="${r(b * 0.05)}" fill="${WHITE}" stroke="${INK}" stroke-width="${SW}"/>`;
    ANTWORT.forEach((a, i) => {
      const bh = hoch * werte[i];
      const bx = x + pad + i * (bw + g);
      s +=
        `<rect x="${r(bx)}" y="${r(basis - bh)}" width="${r(bw)}" height="${r(bh)}" rx="${r(b * 0.02)}" fill="${a.hex}"/>` +
        schrift(a.b, bx + bw / 2, basis - bh - b * 0.06, b * 0.05, INK);
    });
    return s;
  },
  // Heftstapel: drei Hefte, leicht verschoben, Rücken links
  hefte(x, y, b, farben) {
    const h = b * 0.14;
    return farben
      .map((f, i) => {
        const dy = y - (i + 1) * h;
        const dx = x + [0, 5, -3][i % 3];
        const w = [1.5, -1.5, 1][i % 3];
        return (
          `<g transform="rotate(${w} ${r(dx + b / 2)} ${r(dy + h / 2)})">` +
          `<rect x="${r(dx)}" y="${r(dy)}" width="${r(b)}" height="${r(h)}" rx="4" fill="${f}" stroke="${INK}" stroke-width="${SW}"/>` +
          linie(`M${r(dx + b * 0.12)} ${r(dy + 4)}V${r(dy + h - 4)}`, 2.5) +
          '</g>'
        );
      })
      .join('');
  },
  // Tür mit Füllung und Klinke
  tuer(x, y, b, h, f) {
    return (
      `<rect x="${r(x)}" y="${r(y)}" width="${r(b)}" height="${r(h)}" rx="6" fill="${f}" stroke="${INK}" stroke-width="${SW}"/>` +
      `<rect x="${r(x + b * 0.16)}" y="${r(y + h * 0.08)}" width="${r(b * 0.68)}" height="${r(h * 0.36)}" rx="4" fill="none" stroke="${INK}" stroke-width="2.5"/>` +
      linie(`M${r(x + b * 0.14)} ${r(y + h * 0.56)}h${r(b * 0.18)}`, SW)
    );
  },
  // Ticket mit zwei Einkerbungen und Abrisslinie (Maße im Raster des Wesens)
  ticket(x, y, b, h, f) {
    const k = h * 0.18;
    const m = y + h / 2;
    return (
      `<path d="M${x} ${y}H${x + b}V${r(m - k)}A${r(k)} ${r(k)} 0 0 0 ${x + b} ${r(m + k)}V${y + h}H${x}V${r(m + k)}A${r(k)} ${r(k)} 0 0 0 ${x} ${r(m - k)}Z" fill="${f}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` +
      `<path d="M${r(x + b * 0.68)} ${y + 3}V${y + h - 3}" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 3"/>` +
      linie(`M${r(x + b * 0.14)} ${r(y + h * 0.36)}h${r(b * 0.4)}M${r(x + b * 0.14)} ${r(y + h * 0.64)}h${r(b * 0.26)}`, 2.5)
    );
  },
  // Namensschild auf der Brust (Raster des Wesens)
  namensschild(x, y, b) {
    const h = b * 0.38;
    return (
      `<rect x="${x}" y="${y}" width="${b}" height="${r(h)}" rx="3" fill="${WHITE}" stroke="${INK}" stroke-width="2.5"/>` +
      linie(`M${r(x + b * 0.2)} ${r(y + h / 2)}h${r(b * 0.6)}`, 2.5)
    );
  },
  umschlag(x, y, b) {
    const h = b * 0.68;
    return (
      `<rect x="${x}" y="${y}" width="${b}" height="${r(h)}" rx="${r(b * 0.08)}" fill="${WHITE}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` +
      linie(`M${x + 2} ${y + 3}L${r(x + b / 2)} ${r(y + h * 0.58)}L${x + b - 2} ${y + 3}`) +
      `<circle cx="${r(x + b / 2)}" cy="${r(y + h * 0.58)}" r="${r(b * 0.1)}" fill="${ANTWORT[3].hex}" stroke="${INK}" stroke-width="2.5"/>`
    );
  },
  kaffee(x, y, b) {
    const h = b * 1.05;
    return (
      linie(`M${r(x + b * 0.3)} ${r(y - b * 0.12)}q-6 -8 0 -16M${r(x + b * 0.6)} ${r(y - b * 0.12)}q-6 -8 0 -16`, 3) +
      `<path d="M${x + b} ${r(y + h * 0.25)}h${r(b * 0.18)}a${r(b * 0.2)} ${r(b * 0.2)} 0 0 1 0 ${r(b * 0.42)}h-${r(b * 0.18)}" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` +
      `<path d="M${x} ${y}H${x + b}V${r(y + h * 0.78)}Q${x + b} ${r(y + h)} ${r(x + b * 0.78)} ${r(y + h)}H${r(x + b * 0.22)}Q${x} ${r(y + h)} ${x} ${r(y + h * 0.78)}Z" fill="${WHITE}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` +
      `<path d="M${r(x + b * 0.18)} ${r(y + h * 0.45)}h${r(b * 0.64)}" stroke="${PINK}" stroke-width="5" stroke-linecap="round"/>`
    );
  },
  funkeln(x, y, s = 1.5, f = SUN) {
    return `<path transform="translate(${r(x)} ${r(y)}) scale(${s})" d="M0 -6Q1 -1 6 0Q1 1 0 6Q-1 1 -6 0Q-1 -1 0 -6Z" fill="${f}" stroke="${INK}" stroke-width="${r(2 / s)}" stroke-linejoin="round"/>`;
  },
  konfetti(teile) {
    return teile
      .map(([art, x, y, f, w = 0]) =>
        art === 'k'
          ? `<circle cx="${x}" cy="${y}" r="5" fill="${f}" stroke="${INK}" stroke-width="2"/>`
          : `<rect x="${x - 5}" y="${y - 8}" width="10" height="16" rx="2" fill="${f}" stroke="${INK}" stroke-width="2" transform="rotate(${w} ${x} ${y})"/>`,
      )
      .join('');
  },
  boden(x, y, b) {
    return linie(`M${r(x - b / 2)} ${y}H${r(x + b / 2)}`);
  },
};

// Aufkleber-Rand für dunklen Grund ohne Tafel (Hero, D-63): dieselbe Zeichnung darunter in Papier,
// jede Linie um `rand` breiter. Die Ink-Kontur bleibt die einzige Linie, der Rand trennt sie vom Grund.
const PAPIER = '#f4f6f9';
function aufkleber(inhalt, rand = 7) {
  const rand_ = inhalt
    .replace(/stroke-width="([\d.]+)"/g, (_, w) => `stroke-width="${r(+w + rand)}"`)
    .replace(/(fill|stroke)="(?!none")[^"]*"/g, (_, a) => `${a}="${PAPIER}"`);
  return `<g stroke-linejoin="round">${rand_}</g>${inhalt}`;
}

// Dekoratives SVG: eingebunden als <img alt="">, deshalb ohne Titel
function svg(b, h, inhalt) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${b} ${h}" width="${b}" height="${h}">${inhalt}</svg>\n`;
}

module.exports = { wesen, punkt, hand, farbe, schrift, req, svg, linie, aufkleber, ANTWORT, INK, WHITE, SUN, PINK, HELLBLAU, PAPIER, SW };
