// Die Preisseite (public/preise/) nennt dieselben Beträge, Fristen und Ersparnis wie das Angebot des Servers.
// Ändert sich ANGEBOT, schlägt dieser Test fehl, bis die Seite nachgezogen ist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ANGEBOT, TARIFE, ersparnisProzent, euro, jahrProMonatCent } from '../src/billing/angebot.js';

const html = fs.readFileSync(new URL('../../public/preise/index.html', import.meta.url), 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

test('Angebot: Jahrespass je Monat und Ersparnis gegenüber dem Monatsabo', () => {
  assert.equal(jahrProMonatCent, 399);
  assert.equal(ersparnisProzent, 20);
});

test('Preisseite: Beträge, Laufzeit, Umsatzsteuer und Fristen wie im Angebot', () => {
  assert.ok(text.includes(`${euro(TARIFE.monat.preisCent)} im Monat`), 'Monatsabo');
  assert.ok(text.includes(`${euro(TARIFE.jahr.preisCent)} für 12 Monate`), 'Jahrespass');
  assert.ok(text.includes(`Entspricht ${euro(jahrProMonatCent)} im Monat`), 'Jahrespass je Monat');
  assert.ok(text.includes(`${ersparnisProzent} % günstiger als monatlich`), 'Ersparnis');
  assert.ok(text.includes(`${ANGEBOT.ustSatz} % Umsatzsteuer`), 'Umsatzsteuer');
  assert.ok(text.includes(`${ANGEBOT.widerrufTage} Tagen`), 'Widerrufsfrist');
  assert.ok(text.includes(`${ANGEBOT.erinnerungTage} Tage vor dem Ende`), 'Erinnerung');
  assert.ok(text.includes(`ab ${ANGEBOT.verlaengernTage} Tage vor dem Ende`), 'Verlängern');
  // Keine anderen Euro-Beträge als 0 €, die beiden Preise und der Jahrespass je Monat
  const amounts = new Set([...text.matchAll(/(\d+(?:,\d{2})?) €/g)].map((m) => m[1]));
  const plain = (cent) => euro(cent).replace(' €', '');
  assert.deepEqual([...amounts].sort(), ['0', plain(TARIFE.monat.preisCent), plain(TARIFE.jahr.preisCent), plain(jahrProMonatCent)].sort());
});
