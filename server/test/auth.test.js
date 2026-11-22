// Anmeldung der Lehrkräfte gegen echte PostgreSQL-Datenbank (TEST_DATABASE_URL, in CI gesetzt).
// Ablauf: Anmeldelink anfordern → Link öffnen → Sitzung → Live-Spiel anlegen → abmelden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { openDb } from '../src/db/index.js';
import { GameRegistry } from '../src/games/registry.js';
import { PgGameStore } from '../src/games/store.js';
import { ORIGIN, QUIZ, quietLog, testConfig } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

async function setup() {
  const db = await openDb(url, { max: 4 });
  await db.pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await db.migrate();
  const config = testConfig({ anonGames: false, authSecret: 'test-geheimnis-'.repeat(4) });
  const outbox = [];
  const mailer = { local: true, send: async (m) => outbox.push(m) };
  const auth = createAuth({ config, db: db.db, mailer });
  const registry = new GameRegistry({ store: new PgGameStore(db.db), log: quietLog });
  const app = await buildApp({ config, registry, db, auth });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    db,
    outbox,
    base,
    async stop() {
      registry.dispose();
      await app.close();
      await db.close();
    },
  };
}

const json = { 'Content-Type': 'application/json', Origin: ORIGIN };

test('Anmeldung: Link per Mail, Sitzung, Live-Spiel nur angemeldet, Abmelden', { skip: !url && 'TEST_DATABASE_URL nicht gesetzt' }, async () => {
  const s = await setup();
  try {
    const sent = await fetch(`${s.base}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'Lehrerin@Schule.example', callbackURL: '/host/?angemeldet=1' }),
    });
    assert.equal(sent.status, 200);
    assert.equal(s.outbox.length, 1);
    const mail = s.outbox[0];
    assert.equal(mail.subject, 'Dein Anmeldelink für leaqizz');
    assert.match(mail.text, /gilt 15 Minuten/);
    const link = mail.text.match(/https?:\/\/\S+/)[0];
    assert.ok(link.startsWith(`${ORIGIN}/api/auth/magic-link/verify?token=`), 'Link zeigt auf die öffentliche Adresse');

    // Token nur als Hash gespeichert
    const token = new URL(link).searchParams.get('token');
    const stored = await s.db.pool.query('select value, identifier from verification');
    assert.ok(!JSON.stringify(stored.rows).includes(token));

    const verify = await fetch(`${s.base}${new URL(link).pathname}${new URL(link).search}`, { redirect: 'manual' });
    assert.equal(verify.status, 302);
    assert.equal(new URL(verify.headers.get('location'), ORIGIN).pathname, '/host/');
    const cookies = verify.headers.getSetCookie();
    const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    assert.match(cookie, /leaqizz\.session_token=/);
    assert.ok(cookies.some((c) => /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c)));

    // Derselbe Link funktioniert nur einmal
    const again = await fetch(`${s.base}${new URL(link).pathname}${new URL(link).search}`, { redirect: 'manual' });
    assert.ok(!again.headers.getSetCookie().some((c) => /session_token=[^;]+/.test(c) && !/session_token=;/.test(c)));

    const me = await fetch(`${s.base}/api/auth/get-session`, { headers: { Cookie: cookie } }).then((r) => r.json());
    assert.equal(me.user.email, 'lehrerin@schule.example');
    const sess = await s.db.pool.query('select ip_address, user_agent from session');
    assert.deepEqual(sess.rows, [{ ip_address: null, user_agent: null }], 'keine IP-Adresse und Browserkennung gespeichert');

    // Live-Spiel: ohne Sitzung abgelehnt, mit Sitzung angelegt und der Lehrkraft zugeordnet
    const anon = await fetch(`${s.base}/api/games`, { method: 'POST', headers: json, body: JSON.stringify({ quiz: QUIZ }) });
    assert.equal(anon.status, 401);
    const foreign = await fetch(`${s.base}/api/games`, { method: 'POST', headers: { ...json, Origin: 'https://fremd.example', Cookie: cookie }, body: JSON.stringify({ quiz: QUIZ }) });
    assert.equal(foreign.status, 403, 'fremde Seite darf mit der Sitzung kein Spiel anlegen');
    const created = await fetch(`${s.base}/api/games`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify({ quiz: QUIZ }) });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const owner = await s.db.pool.query('select owner_id from game where id = $1', [id]);
    assert.equal(owner.rows[0].owner_id, me.user.id);

    // Passkey einrichten nur angemeldet; Optionen gehören zur eigenen Adresse
    assert.equal((await fetch(`${s.base}/api/auth/passkey/generate-register-options`)).status, 401);
    const options = await fetch(`${s.base}/api/auth/passkey/generate-register-options`, { headers: { Cookie: cookie } }).then((r) => r.json());
    assert.equal(options.rp.id, 'localhost');
    assert.equal(options.rp.name, 'leaqizz');
    assert.ok(options.challenge);

    const out = await fetch(`${s.base}/api/auth/sign-out`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: '{}' });
    assert.equal(out.status, 200);
    const after = await fetch(`${s.base}/api/auth/get-session`, { headers: { Cookie: cookie } }).then((r) => r.json());
    assert.equal(after, null);

    // Konto löschen nimmt die Spiele mit (Löschkonzept)
    await s.db.pool.query('delete from "user"');
    assert.equal((await s.db.pool.query('select count(*)::int as n from game')).rows[0].n, 0);
  } finally {
    await s.stop();
  }
});

test('Anmeldung: fremde Herkunft abgelehnt, Anmeldelinks begrenzt', { skip: !url && 'TEST_DATABASE_URL nicht gesetzt' }, async () => {
  const s = await setup();
  try {
    const body = JSON.stringify({ email: 'a@schule.example', callbackURL: '/host/' });
    const foreign = await fetch(`${s.base}/api/auth/sign-in/magic-link`, { method: 'POST', headers: { ...json, Origin: 'https://fremd.example' }, body });
    assert.equal(foreign.status, 403);
    assert.equal(s.outbox.length, 0);
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await fetch(`${s.base}/api/auth/sign-in/magic-link`, { method: 'POST', headers: json, body })).status);
    }
    // Grenze: höchstens 5 Anfragen je IP in 10 Minuten (abgewiesene zählen mit)
    assert.equal(statuses.at(-1), 429);
    assert.ok(s.outbox.length >= 3 && s.outbox.length <= 5, `${s.outbox.length} Mails`);
  } finally {
    await s.stop();
  }
});
