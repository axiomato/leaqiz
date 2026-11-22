import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.js';

const BASE = { DATABASE_URL: 'postgres://u:p@localhost/db', LEAQIZ_ORIGIN: 'https://leaqizz.com' };

test('Konfiguration: Pflichtangaben fehlen → alle Fehler auf einmal', () => {
  assert.throws(
    () => loadConfig({}),
    (err) => err instanceof ConfigError && err.problems.length === 2 && /DATABASE_URL/.test(err.message) && /LEAQIZ_ORIGIN/.test(err.message),
  );
});

test('Konfiguration: sichere Vorgaben', () => {
  const c = loadConfig(BASE);
  assert.equal(c.port, 3000);
  assert.equal(c.origin, 'https://leaqizz.com');
  assert.equal(c.anonGames, false);
  assert.equal(c.indexable, false, 'Suchmaschinen sind gesperrt, bis jemand sie bewusst freigibt');
  assert.equal(c.trustProxy, false);
  assert.equal(c.retentionDays, 30);
  assert.equal(c.gameIdleMs, 120 * 60_000);
});

test('Konfiguration: Spiele ohne Anmeldung nur lokal', () => {
  assert.throws(() => loadConfig({ ...BASE, LEAQIZ_SPIELE_OHNE_ANMELDUNG: 'ja' }), /nur lokal/);
  const local = loadConfig({ ...BASE, LEAQIZ_ORIGIN: 'http://localhost:3000', LEAQIZ_SPIELE_OHNE_ANMELDUNG: 'ja' });
  assert.equal(local.anonGames, true);
});

test('Konfiguration: ungültige Zahlen und Adressen werden abgelehnt', () => {
  assert.throws(() => loadConfig({ ...BASE, PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ ...BASE, LEAQIZ_LOESCHFRIST_TAGE: '0' }), /LOESCHFRIST/);
  assert.throws(() => loadConfig({ ...BASE, LEAQIZ_ORIGIN: 'ftp://x' }), /LEAQIZ_ORIGIN/);
});
