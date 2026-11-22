// Avatare (D-38): Nur sechs Zahlen werden übertragen; gezeichnet wird immer aus den eigenen
// Bausteinen. Ungültige Eingaben dürfen nie in das SVG gelangen.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../public/js/avatar.js');

test('Bausteine: sechs Achsen, jede mit mindestens zwei Teilen', () => {
  assert.equal(A.SIZES.length, 6);
  for (const n of A.SIZES) assert.ok(n >= 2);
});

test('gleicher Name ergibt gleichen, gültigen Avatar; Groß-/Kleinschreibung egal', () => {
  const a = A.fromName('Emil');
  assert.ok(A.isAvatar(a));
  assert.deepEqual(a, A.fromName(' emil '));
  assert.notDeepEqual(a, A.fromName('Mila'));
});

test('isAvatar lehnt alles außer sechs gültigen ganzen Zahlen ab', () => {
  for (const bad of [null, '1,2,3,4,5,6', [0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, -1], [0, 0, 0, 0, 0, 1.5], [99, 0, 0, 0, 0, 0], ['0', 0, 0, 0, 0, 0]]) {
    assert.equal(A.isAvatar(bad), false, JSON.stringify(bad));
  }
  assert.equal(A.isAvatar(A.SIZES.map((n) => n - 1)), true);
});

test('jede Kombination zeichnet ein vollständiges SVG', () => {
  const [F, E, M, X, K, G] = A.SIZES;
  let n = 0;
  for (let f = 0; f < F; f++) for (let e = 0; e < E; e++) for (let m = 0; m < M; m++) for (let x = 0; x < X; x++) {
    const svg = A.render([f, e, m, x, (f + e) % K, (m + x) % G]);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 100 100"[^>]*>.*<\/svg>$/s);
    assert.doesNotMatch(svg, /undefined|NaN/);
    n++;
  }
  assert.equal(n, F * E * M * X);
});

test('ungültiger Avatar fällt auf einen gültigen zurück, Titel wird entschärft', () => {
  const svg = A.render(['<script>', 0, 0, 0, 0, 0], { title: '<b>Emil</b>' });
  assert.doesNotMatch(svg, /<script|<b>/);
  assert.match(svg, /<title>bEmil\/b<\/title>/);
  assert.match(A.render([0, 0, 0, 0, 0, 0]), /aria-hidden="true"/);
});

test('Würfeln liefert gültige Avatare', () => {
  for (let i = 0; i < 200; i++) assert.ok(A.isAvatar(A.random()));
});
