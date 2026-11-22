// Avatare: schräge Wesen aus Bausteinen (D-38). Ein Avatar ist eine Liste aus sechs Zahlen
// [Form, Augen, Mund, Extra, Körperfarbe, Grund]. Übertragen werden nur diese Zahlen; gezeichnet
// wird immer hier, nie aus fremdem Markup. Läuft im Browser (window.LeaqizAvatar) und in Node.
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeaqizAvatar = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const INK = '#121826';
const WHITE = '#ffffff';
const SUN = '#ffd43b';
const SW = 3.5; // Konturstärke im 100er-Raster
const FEAT = 1.2; // Gesicht etwas größer als im Teile-Raster: liest sich auch klein

// Formen: Umriss, Mitte des Gesichts, Ansatzpunkt für Hüte (x, y, Neigung)
const FORMS = [
  { id: 'blob', name: 'Blob', d: 'M50 30C70 29 83 42 82 61C81 80 68 91 50 90C32 91 19 80 18 61C17 42 30 31 50 30Z', face: [50, 60], top: [50, 30, 0] },
  { id: 'tropfen', name: 'Tropfen', d: 'M50 20C58 34 81 49 80 67C79 82 67 91 50 91C33 91 21 82 20 67C19 49 42 34 50 20Z', face: [50, 66], top: [50, 22, 0] },
  { id: 'wuerfel', name: 'Würfel', d: 'M34 33H66Q78 33 78 45V77Q78 89 66 89H34Q22 89 22 77V45Q22 33 34 33Z', face: [50, 61], top: [50, 33, 0], tilt: -7 },
  { id: 'knolle', name: 'Knolle', d: 'M39 31C53 25 74 31 80 47C86 63 82 84 64 90C48 95 27 90 21 74C16 58 23 37 39 31Z', face: [52, 61], top: [53, 28, 8] },
  { id: 'geist', name: 'Geist', d: 'M22 60C22 42 34 30 50 30C66 30 78 42 78 60V89Q71 81 64 89Q57 97 50 89Q43 81 36 89Q29 97 22 89Z', face: [50, 58], top: [50, 30, 0] },
  { id: 'ei', name: 'Ei', d: 'M50 25C66 25 80 47 80 65C80 82 67 92 50 92C33 92 20 82 20 65C20 47 34 25 50 25Z', face: [50, 63], top: [50, 25, 0] },
  { id: 'wolke', name: 'Wolke', d: 'M29 89C18 89 13 77 20 69C13 61 19 49 30 50C30 38 43 32 51 39C57 31 73 33 74 46C85 45 90 57 83 65C90 73 85 89 73 89Z', face: [51, 67], top: [51, 39, -6] },
  { id: 'zipfel', name: 'Zipfel', d: 'M50 25C53 25 55 27 57 31L82 79C85 85 81 90 75 90H25C19 90 15 85 18 79L43 31C45 27 47 25 50 25Z', face: [50, 70], top: [50, 26, 0] },
];

const eye = (x, y, r = 4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/>`;
const ball = (x, y, r, px, py, pr) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${WHITE}" stroke="${INK}" stroke-width="2.5"/><circle cx="${x + px}" cy="${y + py}" r="${pr}" fill="${INK}"/>`;
const line = (d, w = 3) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

// Augen: Mittelpunkt (0, 0) liegt 6 Einheiten über der Gesichtsmitte
const EYES = [
  { id: 'punkte', name: 'Punkte', svg: () => eye(-10, 0) + eye(10, 0) },
  { id: 'glubsch', name: 'Glubsch', svg: () => ball(-11, 0, 8, 2.5, 3, 3.5) + ball(11, 0, 8, -3, -1.5, 3.5) },
  { id: 'zyklop', name: 'Zyklop', svg: () => ball(0, -1, 12, 1.5, 1.5, 5.5) + `<circle cx="3.5" cy="-2.5" r="1.8" fill="${WHITE}"/>` },
  { id: 'drei', name: 'Drei', svg: () => eye(-13, 2, 3.5) + eye(0, -4, 3.5) + eye(13, 2, 3.5) },
  { id: 'lachen', name: 'Lachaugen', svg: () => line('M-16 2Q-10.5 -6 -5 2') + line('M5 2Q10.5 -6 16 2') },
  { id: 'brille', name: 'Sonnenbrille', svg: () => `<path d="M-19 -5H-3V1Q-3 7 -9 7H-13Q-19 7 -19 1ZM3 -5H19V1Q19 7 13 7H9Q3 7 3 1Z" fill="${INK}"/>` + line('M-3 -3H3', 2.5) + line('M-15 -2L-12 -2', 1.8).replace(INK, WHITE) + line('M7 -2L10 -2', 1.8).replace(INK, WHITE) },
  { id: 'ungleich', name: 'Ungleich', svg: () => ball(-9, -1, 9, 2, 2, 4) + eye(11, 1, 3.5) },
  { id: 'funkeln', name: 'Funkeln', svg: () => ['-10', '10'].map((x) => `<path transform="translate(${x} 0)" d="M0 -6Q1 -1 6 0Q1 1 0 6Q-1 1 -6 0Q-1 -1 0 -6Z" fill="${INK}"/>`).join('') },
];

// Münder: Mittelpunkt (0, 0) liegt 10 Einheiten unter der Gesichtsmitte
const MOUTHS = [
  { id: 'laecheln', name: 'Lächeln', svg: () => line('M-9 -1Q0 8 9 -1') },
  { id: 'luecke', name: 'Zahnlücke', svg: () => `<path d="M-12 -3Q0 15 12 -3Z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M-7 -3H-1.5V1.5H-7ZM1.5 -3H7V1.5H1.5Z" fill="${WHITE}"/>` },
  { id: 'zunge', name: 'Zunge', svg: () => `<path d="M-2 3Q-2 12 3.5 12Q9 12 8 3Z" fill="#ff8fab" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` + line('M-10 -1Q0 7 10 -1') },
  { id: 'oh', name: 'Oh', svg: () => `<ellipse cx="0" cy="1" rx="4.5" ry="5.5" fill="${INK}"/>` },
  { id: 'zickzack', name: 'Zickzack', svg: () => line('M-11 0L-5.5 -3.5L0 0L5.5 -3.5L11 0') },
  { id: 'vampir', name: 'Spitzzähnchen', svg: () => `<path d="M-6 2.6L-4 7.5L-2 3.8ZM2 3.8L4 7.5L6 2.6Z" fill="${WHITE}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>` + line('M-11 -1Q0 8 11 -1') },
  { id: 'schnauzer', name: 'Schnauzer', svg: () => `<path d="M0 -3C-4 -8 -12 -7 -16 0C-12 -2 -6 -1 0 2C6 -1 12 -2 16 0C12 -7 4 -8 0 -3Z" fill="${INK}"/>` + line('M-3 6Q0 8 3 6', 2.5) },
  { id: 'hase', name: 'Hasenzähne', svg: () => `<path d="M-4.5 1H-0.2V8H-4.5ZM0.2 1H4.5V8H0.2Z" fill="${WHITE}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` + line('M-10 -1Q0 4 10 -1') },
  { id: 'schief', name: 'Schief', svg: () => line('M-9 3Q2 5 10 -4') },
];

// Extras: Ansatzpunkt (0, 0) = Oberkante der Form; „hinten“ liegt unter dem Körper
const EXTRAS = [
  { id: 'ohne', name: 'Ohne', h: 0, svg: () => '' },
  { id: 'partyhut', name: 'Partyhut', h: 31, svg: () => `<path d="M-11 4L0 -24L11 4Z" fill="${SUN}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` + line('M-6 -8L4.5 -4', 2.5) + line('M-3 -16L2.5 -14', 2.5) + `<circle cx="0" cy="-26" r="4" fill="${WHITE}" stroke="${INK}" stroke-width="2.5"/>` },
  { id: 'krone', name: 'Krone', h: 18, svg: () => `<path d="M-14 4V-13L-7 -5L0 -17L7 -5L14 -13V4Z" fill="${SUN}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` },
  { id: 'antenne', name: 'Antenne', h: 26, svg: () => line('M0 3Q-5 -8 2 -17') + `<circle cx="2" cy="-20" r="5" fill="${SUN}" stroke="${INK}" stroke-width="2.5"/>` },
  { id: 'spross', name: 'Spross', h: 22, svg: () => line('M0 3V-12') + `<path d="M0 -10C-4 -19 -14 -19 -17 -15C-12 -9 -5 -8 0 -10ZM0 -12C4 -21 14 -21 17 -17C12 -11 5 -10 0 -12Z" fill="#8ce99a" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` },
  { id: 'schleife', name: 'Schleife', h: 12, svg: () => `<path d="M0 -3L-15 -11V5ZM0 -3L15 -11V5Z" fill="#ff8fab" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/><circle cx="0" cy="-3" r="4" fill="#ff8fab" stroke="${INK}" stroke-width="2.5"/>` },
  { id: 'propeller', name: 'Propeller', h: 23, svg: () => `<path d="M-14 5Q-14 -12 0 -12Q14 -12 14 5Z" fill="#74c0fc" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` + line('M0 -12V-17', 2.5) + `<path d="M0 -18Q-9 -23 -15 -18Q-9 -14 0 -18ZM0 -18Q9 -23 15 -18Q9 -14 0 -18Z" fill="#ff6b6b" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>` },
  { id: 'hoerner', name: 'Hörnchen', h: 15, back: true, svg: () => `<path d="M-15 10C-19 -2 -18 -10 -13 -14C-12 -6 -8 0 -4 6ZM15 10C19 -2 18 -10 13 -14C12 -6 8 0 4 6Z" fill="#fff3bf" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` },
  { id: 'pilz', name: 'Pilzhut', h: 17, svg: () => `<path d="M-20 6Q-20 -16 0 -16Q20 -16 20 6Z" fill="#ff6b6b" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/><circle cx="-9" cy="-6" r="3" fill="${WHITE}"/><circle cx="5" cy="-10" r="2.5" fill="${WHITE}"/><circle cx="11" cy="0" r="2.5" fill="${WHITE}"/>` },
  { id: 'tolle', name: 'Haartolle', h: 15, svg: () => line('M-4 3C-10 -6 -6 -14 1 -13', 3.2) + line('M0 3C2 -8 8 -11 13 -7', 3.2) + line('M4 3C6 -3 12 -2 13 2', 3.2) },
];

const COLORS = [
  { id: 'butter', name: 'Butter', hex: '#ffe8a3' },
  { id: 'minze', name: 'Minze', hex: '#b8f2e6' },
  { id: 'rosa', name: 'Rosa', hex: '#ffc9d9' },
  { id: 'himmel', name: 'Himmel', hex: '#c9d6ff' },
  { id: 'aprikose', name: 'Aprikose', hex: '#ffd2a8' },
  { id: 'flieder', name: 'Flieder', hex: '#e5dbff' },
  { id: 'limette', name: 'Limette', hex: '#d8f5a2' },
  { id: 'nebel', name: 'Nebel', hex: '#f1f3f5' },
];

// Grund: die vier Antwortfarben (D-02)
const GROUNDS = [
  { id: 'petrol', name: 'Petrol', hex: '#0f6e74' },
  { id: 'orange', name: 'Orange', hex: '#c2410c' },
  { id: 'violett', name: 'Violett', hex: '#6741d9' },
  { id: 'himbeere', name: 'Himbeere', hex: '#b0234f' },
];

const PARTS = Object.freeze({ forms: FORMS, eyes: EYES, mouths: MOUTHS, extras: EXTRAS, colors: COLORS, grounds: GROUNDS });
const SIZES = Object.freeze([FORMS.length, EYES.length, MOUTHS.length, EXTRAS.length, COLORS.length, GROUNDS.length]);

function isAvatar(code) {
  return Array.isArray(code) && code.length === SIZES.length && code.every((v, i) => Number.isInteger(v) && v >= 0 && v < SIZES[i]);
}

// Gleicher Name → gleicher Avatar (FNV-1a + mulberry32), damit ohne Auswahl sofort einer da ist
function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text).trim().toLocaleLowerCase('de')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(next) {
  return SIZES.map((n) => Math.floor(next() * n));
}
function fromName(name) {
  return pick(rng(hash(name)));
}
function random(next = Math.random) {
  return pick(next);
}

// Gleiche Avatare in einer Runde vermeiden: erst die Körperfarbe, dann den Grund weiterdrehen.
// Bei mehr Mitspielenden als Farbkombinationen bleibt ein Doppelter möglich (unschädlich).
function distinct(code, taken) {
  const key = (c) => c.join('.');
  const used = new Set(taken.map(key));
  if (!used.has(key(code))) return code;
  const [K, G] = [SIZES[4], SIZES[5]];
  for (let i = 1; i < K * G; i++) {
    const k = (code[4] + i) % K;
    const g = (code[5] + Math.floor((code[4] + i) / K)) % G;
    const next = [code[0], code[1], code[2], code[3], k, g];
    if (!used.has(key(next))) return next;
  }
  return code;
}

function render(code, { title = '', round = false } = {}) {
  const c = isAvatar(code) ? code : fromName('');
  const [f, e, m, x, k, g] = c;
  const form = FORMS[f];
  const extra = EXTRAS[x];
  const [fx, fy] = form.face;
  const [tx, ty, ta] = form.top;
  // Schräg: Neigung aus den Bausteinen abgeleitet, nicht übertragen
  const lean = (form.tilt || 0) + ((f * 7 + e * 3 + m) % 5 - 2) * 2.5;
  const hatLean = ta + ((e * 5 + m * 3 + x) % 3 - 1) * 9;
  const hat = extra.svg() ? `<g transform="translate(${tx} ${ty}) rotate(${hatLean})">${extra.svg()}</g>` : '';
  // Einpassen: Wesen samt Extra füllt das Feld, nichts ragt hinaus
  const top = ty - extra.h - 2;
  const bottom = 93;
  // Rund (Namens-Chips): Wesen etwas kleiner, damit nichts am Kreisrand anstößt
  const fit = Math.min(1.14, 88 / (bottom - top)) * (round ? 0.84 : 1);
  const mid = (top + bottom) / 2;
  const face = `<g transform="translate(${fx} ${fy}) scale(${FEAT})"><g transform="translate(0 -6)">${EYES[e].svg()}</g><g transform="translate(0 10)">${MOUTHS[m].svg()}</g></g>`;
  const label = title ? `<title>${String(title).replace(/[<&>"]/g, '')}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${title ? ' role="img"' : ' aria-hidden="true"'} class="avatar">${label}` +
    (round ? `<circle cx="50" cy="50" r="50" fill="${GROUNDS[g].hex}"/>` : `<rect width="100" height="100" rx="24" fill="${GROUNDS[g].hex}"/>`) +
    `<g transform="translate(50 50) rotate(${lean}) scale(${fit.toFixed(3)}) translate(-50 ${-mid})">` +
    (extra.back ? hat : '') +
    `<path d="${form.d}" fill="${COLORS[k].hex}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` +
    (extra.back ? '' : hat) +
    face +
    `</g></svg>`
  );
}

return { PARTS, SIZES, isAvatar, fromName, random, distinct, render, hash };
});
