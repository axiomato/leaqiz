// Motive der Bildsprache (D-62): Die SVG-Dateien unter public/img/ entstehen aus dev/motive/erzeugen.js.
// Wer eine Datei von Hand ändert oder den Generator ändert, ohne neu zu erzeugen, macht diesen Test rot.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const { erzeugen } = require('../dev/motive/erzeugen.js');

const IMG = join(__dirname, '..', 'public', 'img');
const motive = erzeugen();

test('Motive entsprechen dem Generator', () => {
  for (const [datei, inhalt] of Object.entries(motive)) {
    const ziel = join(IMG, datei);
    assert.ok(existsSync(ziel), `fehlt: public/img/${datei} (node dev/motive/erzeugen.js)`);
    assert.equal(readFileSync(ziel, 'utf8'), inhalt, `weicht ab: public/img/${datei} (node dev/motive/erzeugen.js)`);
  }
});

test('Motive sind klein, statisch und ohne Schriftabhängigkeit', () => {
  for (const [datei, inhalt] of Object.entries(motive)) {
    assert.ok(Buffer.byteLength(inhalt) <= 20 * 1024, `${datei}: über 20 KB`);
    assert.match(inhalt, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/, `${datei}: kein SVG-Kopf`);
    for (const verboten of [/<script/i, /<style/i, /<text/i, /<image/i, /<foreignObject/i, /href=/i, /\son[a-z]+=/i, /url\(/i]) {
      assert.doesNotMatch(inhalt, verboten, `${datei}: ${verboten}`);
    }
  }
});

test('Landingpage bindet die Runden-Motive dekorativ ein', () => {
  const html = readFileSync(join(__dirname, '..', 'public', 'lehrkraefte', 'index.html'), 'utf8');
  for (const datei of Object.keys(motive).filter((d) => d.startsWith('runde/'))) {
    const tag = html.match(new RegExp(`<img src="\\.\\./img/${datei.replace('.', '\\.')}"[^>]*>`));
    assert.ok(tag, `Landingpage zeigt ${datei} nicht`);
    assert.match(tag[0], /alt=""/, `${datei}: dekoratives Bild braucht alt=""`);
    assert.match(tag[0], /width="\d+" height="\d+"/, `${datei}: Breite und Höhe fehlen (Layoutsprung)`);
  }
});
