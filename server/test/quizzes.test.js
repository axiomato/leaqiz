// Quizze der Lehrkraft gegen echte PostgreSQL-Datenbank (TEST_DATABASE_URL, in CI gesetzt)
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUIZ } from './helpers.js';
import { dbUrl, json, setupWithAuth } from './db-helpers.js';

const skip = !dbUrl && 'TEST_DATABASE_URL nicht gesetzt';

test('Quizze: anlegen, ändern, löschen – nur eigene, nur angemeldet', { skip }, async () => {
  const s = await setupWithAuth();
  try {
    const anna = await s.login('anna@schule.example');
    const ben = await s.login('ben@schule.example');
    const as = (cookie) => ({ ...json, Cookie: cookie });
    // DELETE ohne Body, also ohne Content-Type (sonst lehnt Fastify den leeren Body ab)
    const del = (cookie) => ({ Origin: json.Origin, Cookie: cookie });

    assert.equal((await fetch(`${s.base}/api/quizzes`)).status, 401);

    // Entwurf darf unvollständig sein (Antwort fehlt noch), wird aber normalisiert
    const draft = { title: '  Brüche\u0000 ', questions: [{ type: 'quiz', text: 'Was ist 1/2 + 1/4?', options: ['3/4', '2/6'], correct: [] }] };
    const created = await fetch(`${s.base}/api/quizzes`, { method: 'POST', headers: as(anna), body: JSON.stringify(draft) });
    assert.equal(created.status, 201);
    const { quiz } = await created.json();
    assert.equal(quiz.title, 'Brüche');
    assert.deepEqual(quiz.questions[0].options, ['3/4', '2/6', '', ''], 'Format des Editors: 4 Antwortfelder');
    assert.ok(Number.isInteger(quiz.updatedAt));

    const changed = await fetch(`${s.base}/api/quizzes/${quiz.id}`, { method: 'PUT', headers: as(anna), body: JSON.stringify({ ...quiz, questions: [{ ...quiz.questions[0], correct: [0] }] }) });
    assert.equal(changed.status, 200);
    assert.deepEqual((await changed.json()).quiz.questions[0].correct, [0]);

    // Ben sieht und ändert Annas Quiz nicht
    assert.deepEqual((await fetch(`${s.base}/api/quizzes`, { headers: { Cookie: ben } }).then((r) => r.json())).quizzes, []);
    assert.equal((await fetch(`${s.base}/api/quizzes/${quiz.id}`, { method: 'PUT', headers: as(ben), body: JSON.stringify(quiz) })).status, 404);
    assert.equal((await fetch(`${s.base}/api/quizzes/${quiz.id}`, { method: 'DELETE', headers: del(ben) })).status, 404);
    assert.equal((await fetch(`${s.base}/api/quizzes/kein-uuid`, { method: 'DELETE', headers: del(anna) })).status, 404);

    // Fremde Seite darf nicht schreiben; kaputte Eingabe ergibt 400 mit Grund
    assert.equal((await fetch(`${s.base}/api/quizzes`, { method: 'POST', headers: { ...as(anna), Origin: 'https://fremd.example' }, body: JSON.stringify(draft) })).status, 403);
    const bad = await fetch(`${s.base}/api/quizzes`, { method: 'POST', headers: as(anna), body: JSON.stringify({ title: 'x' }) });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /Fragen fehlen/);

    // Live-Spiel aus dem Quiz: Verknüpfung nur zum eigenen Quiz
    const own = await fetch(`${s.base}/api/games`, { method: 'POST', headers: as(anna), body: JSON.stringify({ quiz: QUIZ, quizId: quiz.id }) }).then((r) => r.json());
    const foreign = await fetch(`${s.base}/api/games`, { method: 'POST', headers: as(ben), body: JSON.stringify({ quiz: QUIZ, quizId: quiz.id }) }).then((r) => r.json());
    const links = await s.db.pool.query('select id, quiz_id from game where id = any($1)', [[own.id, foreign.id]]);
    const byId = Object.fromEntries(links.rows.map((r) => [r.id, r.quiz_id]));
    assert.equal(byId[own.id], quiz.id);
    assert.equal(byId[foreign.id], null);

    assert.equal((await fetch(`${s.base}/api/quizzes/${quiz.id}`, { method: 'DELETE', headers: del(anna) })).status, 204);
    assert.deepEqual((await fetch(`${s.base}/api/quizzes`, { headers: { Cookie: anna } }).then((r) => r.json())).quizzes, []);
    const kept = await s.db.pool.query('select quiz_id from game where id = $1', [own.id]);
    assert.equal(kept.rows[0].quiz_id, null, 'Spiel bleibt, Verknüpfung entfällt');
  } finally {
    await s.stop();
  }
});

test('Quizze übernehmen: aus dem Browser ohne Doppelte, ungültige mit Grund', { skip }, async () => {
  const s = await setupWithAuth();
  try {
    const cookie = await s.login('carla@schule.example');
    const headers = { ...json, Cookie: cookie };
    const local = [
      { localId: 'lokal-1', title: 'Hauptstädte', questions: [{ type: 'quiz', text: 'Frankreich?', options: ['Paris', 'Lyon'], correct: [0] }] },
      { localId: 'lokal-2', title: 'Wahr oder falsch', questions: [{ type: 'truefalse', text: 'Die Erde ist rund.', correct: [0] }] },
      { title: 'Ohne Fragen-Liste' },
    ];
    const first = await fetch(`${s.base}/api/quizzes/import`, { method: 'POST', headers, body: JSON.stringify({ quizzes: local }) }).then((r) => r.json());
    assert.equal(first.imported.length, 2);
    assert.equal(first.skipped, 0);
    assert.deepEqual(first.invalid.map((i) => i.index), [2]);
    assert.deepEqual(first.imported.map((q) => q.localId), ['lokal-1', 'lokal-2']);

    const again = await fetch(`${s.base}/api/quizzes/import`, { method: 'POST', headers, body: JSON.stringify({ quizzes: local.slice(0, 2) }) }).then((r) => r.json());
    assert.equal(again.imported.length, 0);
    assert.equal(again.skipped, 2, 'zweimal übernehmen legt nichts doppelt an');

    const list = await fetch(`${s.base}/api/quizzes`, { headers: { Cookie: cookie } }).then((r) => r.json());
    assert.equal(list.quizzes.length, 2);

    const tooMany = await fetch(`${s.base}/api/quizzes/import`, { method: 'POST', headers, body: JSON.stringify({ quizzes: Array.from({ length: 101 }, () => local[0]) }) });
    assert.equal(tooMany.status, 400);

    // Konto löschen nimmt die Quizze mit
    await s.db.pool.query('delete from "user"');
    assert.equal((await s.db.pool.query('select count(*)::int as n from quiz')).rows[0].n, 0);
  } finally {
    await s.stop();
  }
});
