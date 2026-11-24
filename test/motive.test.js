// Motive der Bildsprache (D-62): Die SVG-Dateien unter public/img/ entstehen aus dev/motive/erzeugen.js.
// Wer eine Datei von Hand ändert oder den Generator ändert, ohne neu zu erzeugen, macht diesen Test rot.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const { erzeugen, uebrig, seitenMitWesen, wesenInline } = require('../dev/motive/erzeugen.js');

const PUBLIC = join(__dirname, '..', 'public');
const IMG = join(PUBLIC, 'img');
const dateien = erzeugen();

// Ordner der Motive → Seite, die sie zeigt
const SEITE = {
  runde: 'lehrkraefte/index.html',
  landing: 'lehrkraefte/index.html',
  momente: 'lehrkraefte/index.html',
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
  }
});

// Wesen-Ebenen stehen inline in der Seite (D-65), damit Augen, Mund, Hut und Körper sich leise bewegen
test('Wesen-Ebenen stehen so in den Seiten, wie der Generator sie zeichnet', () => {
  for (const [datei, inhalt] of Object.entries(seitenMitWesen())) {
    assert.equal(readFileSync(join(PUBLIC, datei), 'utf8'), inhalt, `weicht ab: ${datei} (node dev/motive/erzeugen.js)`);
  }
  for (const [name, block] of Object.entries(wesenInline())) {
    const seite = readFileSync(join(PUBLIC, SEITE[name.split('/')[0]]), 'utf8');
    const i = seite.indexOf(`<!-- motiv:${name} -->`);
    const vorher = seite.lastIndexOf('<div', i);
    assert.match(seite.slice(vorher, i), /class="[^"]*motiv[^"]*" aria-hidden="true"/, `${name}: Wesen nicht für Screenreader verborgen`);
    for (const verboten of [/<script/i, /<style/i, /\sstyle=/i, /<text/i, /<image/i, /href=/i, /\son[a-z]+=/i, /url\(/i]) {
      assert.doesNotMatch(block, verboten, `${name}: ${verboten}`);
    }
    for (const teil of ['w-wipp', 'w-blink', 'w-mund']) assert.match(block, new RegExp(`class="${teil}`), `${name}: ${teil} fehlt`);
    assert.ok(Buffer.byteLength(block) <= 20 * 1024, `${name}: über 20 KB`);
  }
});
