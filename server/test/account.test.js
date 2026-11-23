// Konto: Daten herunterladen und Konto löschen, gegen echte PostgreSQL-Datenbank (TEST_DATABASE_URL)
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUIZ } from './helpers.js';
import { dbUrl, json, setupWithAuth } from './db-helpers.js';

const skip = !dbUrl && 'TEST_DATABASE_URL nicht gesetzt';

test('Daten herunterladen: alles zum Konto als JSON-Datei, nur angemeldet', { skip }, async () => {
  const s = await setupWithAuth();
  try {
    assert.equal((await fetch(`${s.base}/api/account/export`)).status, 401);
    const cookie = await s.login('dora@schule.example');
    const headers = { ...json, Cookie: cookie };
    await fetch(`${s.base}/api/quizzes`, { method: 'POST', headers, body: JSON.stringify(QUIZ) });
    await fetch(`${s.base}/api/games`, { method: 'POST', headers, body: JSON.stringify({ quiz: QUIZ }) });

    const res = await fetch(`${s.base}/api/account/export`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="leaqizz-daten-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const data = await res.json();
    assert.equal(data.format, 'leaqizz-konto-export');
    assert.equal(data.account.email, 'dora@schule.example');
    assert.equal(data.quizzes.length, 1);
    assert.equal(data.quizzes[0].title, QUIZ.title);
    assert.equal(data.games.length, 1);
    assert.equal(data.sessions.length, 1);
    assert.deepEqual(data.passkeys, []);
    assert.ok(!JSON.stringify(data).includes('snapshot'), 'Spielstände mit Schülernamen gehören nicht in den Export');
  } finally {
    await s.stop();
  }
});

test('Konto löschen: nur mit eigener E-Mail, beendet laufende Spiele, nimmt alles mit', { skip }, async () => {
  const s = await setupWithAuth();
  try {
    const emil = await s.login('emil@schule.example');
    const frida = await s.login('frida@schule.example');
    const as = (cookie) => ({ ...json, Cookie: cookie });
    await fetch(`${s.base}/api/quizzes`, { method: 'POST', headers: as(emil), body: JSON.stringify(QUIZ) });
    await fetch(`${s.base}/api/quizzes`, { method: 'POST', headers: as(frida), body: JSON.stringify(QUIZ) });
    await fetch(`${s.base}/api/games`, { method: 'POST', headers: as(emil), body: JSON.stringify({ quiz: QUIZ }) });
    await fetch(`${s.base}/api/games`, { method: 'POST', headers: as(frida), body: JSON.stringify({ quiz: QUIZ }) });
    assert.equal(s.registry.stats().games, 2);
    // Offener Anmeldelink für emil, der mit gelöscht werden soll
    await fetch(`${s.base}/api/auth/sign-in/magic-link`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'emil@schule.example', callbackURL: '/host/' }) });
    const count = async (sql, params = []) => (await s.db.pool.query(sql, params)).rows[0].n;

    const del = (cookie, body, origin = json.Origin) => fetch(`${s.base}/api/account/delete`, { method: 'POST', headers: { ...as(cookie), Origin: origin }, body: JSON.stringify(body) });
    assert.equal((await del(emil, { email: 'emil@schule.example' }, 'https://fremd.example')).status, 403);
    const wrong = await del(emil, { email: 'frida@schule.example' });
    assert.equal(wrong.status, 400);
    assert.match((await wrong.json()).error, /stimmt nicht/);
    assert.equal(await count(`select count(*)::int as n from "user"`), 2);

    const ok = await del(emil, { email: '  Emil@Schule.example ' });
    assert.equal(ok.status, 200);
    assert.ok(ok.headers.getSetCookie().some((c) => /leaqizz\.session_token=;/.test(c) && /Max-Age=0/i.test(c)), 'Sitzungs-Cookie wird gelöscht');

    // Alte Sitzung gilt nicht mehr; Daten von emil weg, frida unberührt
    assert.equal((await fetch(`${s.base}/api/quizzes`, { headers: { Cookie: emil } })).status, 401);
    assert.equal(await count(`select count(*)::int as n from "user" where email = $1`, ['emil@schule.example']), 0);
    assert.equal(await count(`select count(*)::int as n from session`), 1);
    assert.equal(await count(`select count(*)::int as n from quiz`), 1);
    assert.equal(await count(`select count(*)::int as n from game`), 1);
    assert.equal(await count(`select count(*)::int as n from verification where value like '%emil@schule.example%'`), 0);
    assert.equal(s.registry.stats().games, 1, 'laufendes Spiel von emil ist beendet');
    assert.equal((await fetch(`${s.base}/api/quizzes`, { headers: { Cookie: frida } }).then((r) => r.json())).quizzes.length, 1);
  } finally {
    await s.stop();
  }
});
