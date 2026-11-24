// Motive der Bildsprache (D-62): Die SVG-Dateien unter public/img/ entstehen aus dev/motive/erzeugen.js.
// Wer eine Datei von Hand ändert oder den Generator ändert, ohne neu zu erzeugen, macht diesen Test rot.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const { erzeugen, uebrig } = require('../dev/motive/erzeugen.js');

const PUBLIC = join(__dirname, '..', 'public');
const IMG = join(PUBLIC, 'img');
const dateien = erzeugen();

// Ordner der Motive → Seite, die sie zeigt
const SEITE = {
  runde: 'lehrkraefte/index.html',
  landing: 'lehrkraefte/index.html',
  momente: 'lehrkraefte/index.html',
  hero: 'lehrkraefte/index.html',
  preise: 'preise/index.html',
};

test('Motive entsprechen dem Generator, keine übrigen Dateien', () => {
  for (const [datei, inhalt] of Object.entries(dateien)) {
    const ziel = join(IMG, datei);
    assert.ok(existsSync(ziel), `fehlt: public/img/${datei} (node dev/motive/erzeugen.js)`);
    assert.equal(readFileSync(ziel, 'utf8'), inhalt, `weicht ab: public/img/${datei} (node dev/motive/erzeugen.js)`);
  }
  assert.deepEqual(uebrig(dateien), [], 'übrige Motiv-Dateien (node dev/motive/erzeugen.js räumt auf)');
});

test('Motive sind klein, statisch und ohne Schriftabhängigkeit', () => {
  for (const [datei, inhalt] of Object.entries(dateien)) {
    assert.ok(Buffer.byteLength(inhalt) <= 20 * 1024, `${datei}: über 20 KB`);
    assert.match(inhalt, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/, `${datei}: kein SVG-Kopf`);
    for (const verboten of [/<script/i, /<style/i, /<text/i, /<image/i, /<foreignObject/i, /<animate/i, /href=/i, /\son[a-z]+=/i, /url\(/i]) {
      assert.doesNotMatch(inhalt, verboten, `${datei}: ${verboten}`);
    }
  }
});

test('Jedes Motiv steht auf seiner Seite, dekorativ und mit festen Maßen', () => {
  const seiten = {};
  for (const datei of Object.keys(dateien)) {
    const seite = SEITE[datei.split('/')[0]];
    assert.ok(seite, `${datei}: keine Seite zugeordnet`);
    seiten[seite] ??= readFileSync(join(PUBLIC, seite), 'utf8');
    const tag = seiten[seite].match(new RegExp(`<img [^>]*src="\\.\\./img/${datei.replace(/\./g, '\\.')}"[^>]*>`));
    assert.ok(tag, `${seite} zeigt ${datei} nicht`);
    assert.match(tag[0], /alt=""/, `${datei}: dekoratives Bild braucht alt=""`);
    assert.match(tag[0], /width="\d+" height="\d+"/, `${datei}: Breite und Höhe fehlen (Layoutsprung)`);
    if (datei.endsWith('-wesen.svg')) assert.match(tag[0], /class="motiv__wesen"/, `${datei}: Wesen-Ebene ohne Klasse motiv__wesen`);
    // Hero (D-63): ruhige Pose und Reaktion liegen übereinander, sofort sichtbar (nicht lazy)
    if (datei.startsWith('hero/')) {
      const klasse = datei.endsWith('-ruhig.svg') ? 'fan__ruhig' : 'fan__jubel';
      assert.match(tag[0], new RegExp(`class="${klasse}"`), `${datei}: Pose ohne Klasse ${klasse}`);
      assert.doesNotMatch(tag[0], /loading="lazy"/, `${datei}: steht im ersten Bildschirm, nicht lazy laden`);
    }
  }
});
