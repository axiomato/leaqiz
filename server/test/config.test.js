import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.js';

const BASE = {
  DATABASE_URL: 'postgres://u:p@localhost/db',
  LEAQIZ_ORIGIN: 'https://leaqizz.com',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  SMTP_HOST: 'mail.example.org',
  SMTP_USER: 'noreply@leaqizz.com',
  SMTP_PASS: 'geheim',
  MAIL_FROM: 'leaqizz <noreply@leaqizz.com>',
};

test('Konfiguration: Pflichtangaben fehlen → alle Fehler auf einmal', () => {
  assert.throws(
    () => loadConfig({}),
    (err) => err instanceof ConfigError && err.problems.length === 3 && /DATABASE_URL/.test(err.message) && /LEAQIZ_ORIGIN/.test(err.message) && /BETTER_AUTH_SECRET/.test(err.message),
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

test('Konfiguration: öffentlich nur mit Mailversand, lokal landen Links im Log', () => {
  const { SMTP_HOST, ...noMail } = BASE;
  assert.throws(() => loadConfig(noMail), /SMTP_HOST fehlt/);
  assert.throws(() => loadConfig({ ...BASE, SMTP_PASS: '' }), /SMTP_USER und SMTP_PASS/);
  assert.equal(loadConfig({ ...noMail, LEAQIZ_ORIGIN: 'http://localhost:3000' }).mail, null);
  assert.equal(loadConfig(BASE).mail.port, 587);
  assert.throws(() => loadConfig({ ...BASE, BETTER_AUTH_SECRET: 'kurz' }), /BETTER_AUTH_SECRET/);
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

test('Konfiguration: Abo nur mit Zahlungsweg; Simulation nur lokal; PayPal braucht alle Zugangsdaten', () => {
  assert.deepEqual(loadConfig(BASE).billing, { required: false, provider: null, paypal: null, operatorMail: null });
  assert.throws(() => loadConfig({ ...BASE, LEAQIZ_ABO: 'ja' }), (err) => /LEAQIZ_ZAHLUNG=paypal/.test(err.message));
  assert.throws(() => loadConfig({ ...BASE, LEAQIZ_ZAHLUNG: 'simulation' }), (err) => /nur lokal/.test(err.message));
  assert.throws(() => loadConfig({ ...BASE, LEAQIZ_ZAHLUNG: 'paypal' }), (err) => ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_PLAN_ID'].every((n) => err.message.includes(n)));
  const c = loadConfig({ ...BASE, LEAQIZ_ABO: 'ja', LEAQIZ_ZAHLUNG: 'paypal', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's', PAYPAL_WEBHOOK_ID: 'w', PAYPAL_PLAN_ID: 'P-1', LEAQIZ_BETREIBER_MAIL: 'info@example.org' });
  assert.equal(c.billing.required, true);
  assert.equal(c.billing.paypal.environment, 'sandbox', 'Vorgabe ist die Sandbox, nie aus Versehen echtes Geld');
  assert.equal(c.billing.operatorMail, 'info@example.org');
});
