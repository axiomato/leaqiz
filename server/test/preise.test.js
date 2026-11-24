// Die Preisseite (public/preise/) nennt dieselben Beträge wie das Angebot des Servers.
// Ändert sich ANGEBOT, schlägt dieser Test fehl, bis die Seite nachgezogen ist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ANGEBOT, euro } from '../src/billing/angebot.js';

const html = fs.readFileSync(new URL('../../public/preise/index.html', import.meta.url), 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('Preisseite: Monatspreis, erstes Jahr und Umsatzsteuer wie im Angebot', () => {
  assert.ok(text.includes(`${euro(ANGEBOT.monatCent)} im Monat`), 'Monatspreis');
  assert.ok(text.includes(`${euro(ANGEBOT.ersteZahlungCent)} für das erste Jahr`), 'erstes Jahr');
  assert.ok(text.includes(`${ANGEBOT.ustSatz} % Umsatzsteuer`), 'Umsatzsteuer');
  assert.ok(text.includes(`${ANGEBOT.widerrufTage} Tagen`), 'Widerrufsfrist');
  // Keine anderen Euro-Beträge als 0 €, Monatspreis und erstes Jahr
  const amounts = new Set([...text.matchAll(/(\d+(?:,\d{2})?) €/g)].map((m) => m[1]));
  assert.deepEqual([...amounts].sort(), ['0', euro(ANGEBOT.ersteZahlungCent).replace(' €', ''), euro(ANGEBOT.monatCent).replace(' €', '')].sort());
});
