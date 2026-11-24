'use strict';

// Nach dem Start leitet GitHub Pages nur noch weiter (D-61). Die Seiten tragen die Suchmaschinen-Sperre,
// das Ziel wird eingesetzt, Pfad und Abfrage bleiben erhalten, ein falsches Ziel bricht ab.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'deploy', 'site', 'zusammenstellen.sh');
const run = (env) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
  const res = spawnSync('bash', [SCRIPT, out], { env: { ...process.env, ...env }, encoding: 'utf8' });
  return { out, res };
};

test('Weiterleitung: Sperre, Ziel eingesetzt, Pfad und Abfrage mitgenommen', () => {
  const { out, res } = run({ PAGES_ZIEL: 'https://leaqizz.com', SHA: 'abc1234' });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(fs.readdirSync(out).sort(), ['404.html', 'index.html']);
  for (const f of ['index.html', '404.html']) {
    const html = fs.readFileSync(path.join(out, f), 'utf8');
    assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
    assert.ok(!html.includes('__ZIEL__'), `${f}: Platzhalter übrig`);
    assert.ok(html.includes('content="0; url=https://leaqizz.com/"'));
    // Skript wie im Browser ausführen
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    for (const [pathname, search, expected] of [
      ['/leaqiz/host/', '', 'https://leaqizz.com/host/'],
      ['/leaqiz/', '?pin=123456', 'https://leaqizz.com/?pin=123456'],
      ['/leaqiz', '', 'https://leaqizz.com/'],
      ['/leaqiz/lehrkraefte/', '', 'https://leaqizz.com/lehrkraefte/'],
    ]) {
      let target = null;
      new Function('location', script)({ pathname, search, hash: '', replace: (u) => (target = u) });
      assert.equal(target, expected);
    }
  }
});

test('Ohne Ziel: die Website mit Versionsnummer; falsches Ziel bricht ab', () => {
  const site = run({ PAGES_ZIEL: '', SHA: 'abc1234' });
  assert.equal(site.res.status, 0, site.res.stderr);
  const host = fs.readFileSync(path.join(site.out, 'host', 'index.html'), 'utf8');
  assert.ok(host.includes('?v=abc1234') && !host.includes('?v=dev'));
  for (const bad of ['http://leaqizz.com', 'https://leaqizz.com/', 'https://leaqizz.com/pfad', 'javascript:alert(1)', 'https://x.com";alert(1);"']) {
    assert.notEqual(run({ PAGES_ZIEL: bad }).res.status, 0, `${bad} sollte abbrechen`);
  }
});
