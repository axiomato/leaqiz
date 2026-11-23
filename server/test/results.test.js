// Ergebnisse vergangener Live-Spiele und Aufräumen abgelaufener Anmeldungen,
// gegen echte PostgreSQL-Datenbank (TEST_DATABASE_URL)
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUIZ } from './helpers.js';
import { dbUrl, json, setupWithAuth } from './db-helpers.js';
import { deleteExpired } from '../src/cleanup.js';

const skip = !dbUrl && 'TEST_DATABASE_URL nicht gesetzt';

// Eine Runde direkt an der Spiellogik durchspielen (ohne Handys): Ida schnell und richtig, Jan falsch, Kim antwortet nicht.
function playRound(entry, { questions = 2, finish = true } = {}) {
  const g = entry.engine.game;
  let t = Date.now();
  const ida = g.addPlayer('Ida', t, [1, 2, 3, 4, 5, 1]);
  const jan = g.addPlayer('Jan', t);
  g.addPlayer('Kim', t);
  for (let i = 0; i < questions; i += 1) {
    g.startCountdown(t, 0);
    g.openQuestion(t);
    const q = g.question;
    g.submitAnswer(ida.id, q.correct[0], t + 1000);
    g.submitAnswer(jan.id, q.correct[0] === 0 ? 1 : 0, t + 3000);
    g.closeQuestion(t + 5000);
    t += 6000;
    if (i < questions - 1 || !finish) g.state = 'leaderboard';
  }
  if (finish) g.finish(t);
  entry.engine.changed(); // wie nach jedem Schritt: Stand sichern
  return entry.saving;
}

test('Ergebnisse: nur eigene, aus dem Endstand, mit Löschfrist; löschen nur von der eigenen Seite', { skip }, async () => {
  const s = await setupWithAuth();
  try {
    const lea = await s.login('lea@schule.example');
    const max = await s.login('max@schule.example');
    const as = (cookie) => ({ ...json, Cookie: cookie });
    const del = (cookie, origin = json.Origin) => ({ Origin: origin, Cookie: cookie });
    const start = async (cookie) => (await fetch(`${s.base}/api/games`, { method: 'POST', headers: as(cookie), body: JSON.stringify({ quiz: QUIZ }) })).json();

    assert.equal((await fetch(`${s.base}/api/results`)).status, 401);

    // Spiel 1: komplett gespielt und geschlossen
    const done = await start(lea);
    playRound(s.registry.get(done.id));
    assert.deepEqual(s.registry.hostCommand(s.registry.get(done.id), 'end'), { ok: true });
    // Spiel 2: am Podium, Leinwand noch offen
    const open = await start(lea);
    await playRound(s.registry.get(open.id));
    // Spiel 3: vor der ersten Frage beendet → kein Ergebnis
    const empty = await start(lea);
    s.registry.hostCommand(s.registry.get(empty.id), 'end');
    // Spiel 4: nach einer Frage vorzeitig beendet
    const early = await start(lea);
    playRound(s.registry.get(early.id), { questions: 1, finish: false });
    s.registry.hostCommand(s.registry.get(early.id), 'end');
    // Spiel von Max
    const foreign = await start(max);
    playRound(s.registry.get(foreign.id));
    s.registry.hostCommand(s.registry.get(foreign.id), 'end');
    await new Promise((r) => setTimeout(r, 100));

    const list = await fetch(`${s.base}/api/results`, { headers: { Cookie: lea } });
    assert.equal(list.status, 200);
    assert.equal(list.headers.get('cache-control'), 'no-store');
    const { results, retentionDays } = await list.json();
    assert.equal(retentionDays, 30);
    assert.deepEqual(results.map((r) => r.id).sort(), [done.id, open.id, early.id].sort(), 'ohne leeres Spiel, ohne fremdes');
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    assert.equal(byId[done.id].complete, true);
    assert.equal(byId[done.id].running, false);
    assert.equal(byId[done.id].players, 3);
    assert.equal(byId[done.id].played, 2);
    assert.equal(byId[done.id].questionCount, 2);
    const days = (new Date(byId[done.id].deleteAt) - new Date(byId[done.id].endedAt)) / 86_400_000;
    assert.equal(days, 30, 'Löschfrist ab Spielende');
    assert.equal(byId[open.id].running, true);
    assert.equal(byId[open.id].deleteAt, null);
    assert.equal(byId[early.id].complete, false);
    assert.equal(byId[early.id].played, 1);

    // Auswertung: Rangliste, Antworten, Verteilung, Auszeichnungen – ohne Tokens und Kennungen
    const res = await fetch(`${s.base}/api/results/${done.id}`, { headers: { Cookie: lea } });
    assert.equal(res.status, 200);
    const { result } = await res.json();
    assert.equal(result.title, QUIZ.title);
    assert.equal(result.questions.length, 2);
    assert.deepEqual(result.players.map((p) => [p.rank, p.nickname, p.correctCount]), [[1, 'Ida', 2], [2, 'Jan', 0], [2, 'Kim', 0]]);
    assert.deepEqual(result.players[0].avatar, [1, 2, 3, 4, 5, 1]);
    assert.equal(result.players[0].answers[0].correct, true);
    assert.equal(result.players[0].answers[0].elapsedMs, 1000);
    assert.equal(result.players[2].answers[0], null, 'Kim hat nicht geantwortet');
    assert.deepEqual(result.stats[0], { counts: [1, 1, 0], answered: 2, correct: 1, avgMs: 2000 });
    assert.ok(result.awards.some((a) => a.key === 'perfect' && a.winners.includes('Ida')));
    const raw = JSON.stringify(result);
    for (const p of s.registry.get(open.id).engine.game.players.values()) assert.ok(!raw.includes(p.token));
    assert.ok(!/token|"id":"[0-9a-f]{16}"/.test(raw.replace(`"id":"${done.id}"`, '')), 'keine Tokens oder Spieler-Kennungen');

    // Vorzeitig beendet: nur die geschlossene Frage
    const part = (await fetch(`${s.base}/api/results/${early.id}`, { headers: { Cookie: lea } }).then((r) => r.json())).result;
    assert.equal(part.questions.length, 1);
    assert.equal(part.players[0].answers.length, 1);

    // Fremde Ergebnisse und leere Spiele gibt es nicht
    assert.equal((await fetch(`${s.base}/api/results/${foreign.id}`, { headers: { Cookie: lea } })).status, 404);
    assert.equal((await fetch(`${s.base}/api/results/${empty.id}`, { headers: { Cookie: lea } })).status, 404);
    assert.equal((await fetch(`${s.base}/api/results/kein-uuid`, { headers: { Cookie: lea } })).status, 404);

    // Löschen: fremde Seite 403, fremdes Konto 404; ein geöffnetes Spiel wird erst beendet
    assert.equal((await fetch(`${s.base}/api/results/${done.id}`, { method: 'DELETE', headers: del(lea, 'https://fremd.example') })).status, 403);
    assert.equal((await fetch(`${s.base}/api/results/${foreign.id}`, { method: 'DELETE', headers: del(lea) })).status, 404);
    assert.equal((await fetch(`${s.base}/api/results/${open.id}`, { method: 'DELETE', headers: del(lea) })).status, 204);
    assert.equal(s.registry.get(open.id), null, 'geöffnetes Spiel beendet');
    assert.equal((await fetch(`${s.base}/api/results/${done.id}`, { method: 'DELETE', headers: del(lea) })).status, 204);
    const rows = await s.db.pool.query('select id from game where id = any($1)', [[done.id, open.id, foreign.id]]);
    assert.deepEqual(rows.rows.map((r) => r.id), [foreign.id], 'gelöscht samt Spielnamen und Antworten, fremdes bleibt');
    const after = await fetch(`${s.base}/api/results`, { headers: { Cookie: lea } }).then((r) => r.json());
    assert.deepEqual(after.results.map((r) => r.id), [early.id]);
  } finally {
    await s.stop();
  }
});

test('Aufräumen: abgelaufene Anmeldungen und Anmeldelinks werden gelöscht', { skip }, async () => {
  const s = await setupWithAuth();
  try {
    const cookie = await s.login('nora@schule.example');
    await fetch(`${s.base}/api/auth/sign-in/magic-link`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'nora@schule.example', callbackURL: '/host/' }) });
    const count = async (table) => (await s.db.pool.query(`select count(*)::int as n from ${table}`)).rows[0].n;
    assert.equal(await count('session'), 1);
    assert.equal(await count('verification'), 1);

    assert.deepEqual(await deleteExpired(s.db.db), { sessions: 0, links: 0 }, 'gültige bleiben');
    const later = new Date(Date.now() + 31 * 86_400_000);
    assert.deepEqual(await deleteExpired(s.db.db, later), { sessions: 1, links: 1 });
    assert.equal(await count('session'), 0);
    assert.equal(await count('verification'), 0);
    assert.equal((await fetch(`${s.base}/api/quizzes`, { headers: { Cookie: cookie } })).status, 401);
  } finally {
    await s.stop();
  }
});
