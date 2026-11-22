'use strict';

// Festlegung des Nutzers: Suchmaschinen sind für alle GitHub-Pages-Projekte gesperrt.
// Jede ausgelieferte HTML-Seite muss deshalb „noindex, nofollow“ tragen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__snap' ? [] : htmlFiles(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

test('jede Seite sperrt Suchmaschinen (noindex, nofollow)', () => {
  const files = htmlFiles(ROOT);
  assert.ok(files.length > 0, 'keine HTML-Seiten gefunden');
  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    const m = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i);
    assert.ok(m, `${path.relative(ROOT, f)}: robots-Meta fehlt`);
    assert.match(m[1], /noindex/, `${path.relative(ROOT, f)}: noindex fehlt`);
    assert.match(m[1], /nofollow/, `${path.relative(ROOT, f)}: nofollow fehlt`);
  }
});

test('keine robots.txt, die das Lesen der Sperre verhindert', () => {
  // Disallow in robots.txt hielte Crawler davon ab, das noindex überhaupt zu sehen
  assert.ok(!fs.existsSync(path.join(ROOT, 'robots.txt')) || !/Disallow:\s*\/\s*$/m.test(fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8')));
});
