'use strict';

// Ende-zu-Ende über echte WebSockets: Host + 3 Spieler spielen ein ganzes Quiz.

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../src/app');

const QUIZ = {
  title: 'E2E',
  questions: [
    { type: 'quiz', text: 'Hauptstadt von Frankreich?', options: ['Berlin', 'Paris', 'Rom', 'Wien'], correct: [1], timeLimit: 5 },
    { type: 'truefalse', text: 'Wasser kocht auf Meereshöhe bei 100 °C.', correct: [0], timeLimit: 5 },
  ],
};

function start(overrides = {}) {
  const app = createApp({ countdownMs: 50, sweepMs: 60_000, ...overrides });
  return new Promise((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve({ app, url: `http://127.0.0.1:${app.server.address().port}` }));
  });
}

function client(url) {
  return connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
}

function call(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

// Wartet auf den nächsten Zustand, der die Bedingung erfüllt.
function waitFor(socket, event, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout beim Warten auf ${event}`));
    }, timeoutMs);
    function handler(state) {
      if (!predicate || predicate(state)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(state);
      }
    }
    socket.on(event, handler);
  });
}

test('Ganzes Spiel: Beitritt, Antworten, frühes Schließen, Rangliste, Podium, Report', async (t) => {
  const { app, url } = await start();
  const host = client(url);
  const players = ['Anna', 'Ben', 'Cem'].map(() => client(url));
  t.after(() => {
    host.close();
    players.forEach((p) => p.close());
    app.close();
  });

  const created = await call(host, 'host:create', { quiz: QUIZ });
  assert.equal(created.ok, true);
  assert.match(created.pin, /^\d{6}$/);

  // Falsche PIN, doppelter Name
  const wrong = await call(players[0], 'player:join', { pin: '000000', nickname: 'X' });
  assert.equal(wrong.ok, false);

  const joins = [];
  for (const [i, name] of ['Anna', 'Ben', 'Cem'].entries()) {
    joins.push(await call(players[i], 'player:join', { pin: created.pin, nickname: name }));
  }
  assert.ok(joins.every((j) => j.ok));
  const dup = await call(client(url), 'player:join', { pin: created.pin, nickname: 'anna' });
  assert.equal(dup.ok, false);

  // Frage 1 starten: Countdown → Frage öffnet automatisch
  const q1 = waitFor(players[0], 'player:state', (s) => s.state === 'question' && s.qIndex === 0);
  assert.equal((await call(host, 'host:next')).ok, true);
  const s1 = await q1;
  assert.equal(s1.question.correct, undefined, 'Spieler kennt die Lösung nicht vorab');
  assert.equal(s1.question.options.length, 4);

  // Alle antworten → Frage schließt ohne Timer
  const reveal1 = waitFor(host, 'host:state', (s) => s.state === 'reveal');
  assert.equal((await call(players[0], 'player:answer', { choice: 1 })).ok, true);
  assert.equal((await call(players[0], 'player:answer', { choice: 1 })).ok, false, 'nur einmal antworten');
  await call(players[1], 'player:answer', { choice: 0 });
  await call(players[2], 'player:answer', { choice: 1 });
  const r1 = await reveal1;
  assert.deepEqual(r1.counts, [1, 2, 0, 0]);
  assert.deepEqual(r1.question.correct, [1]);

  // Rangliste
  const lb = waitFor(host, 'host:state', (s) => s.state === 'leaderboard');
  await call(host, 'host:next');
  const board = await lb;
  assert.equal(board.leaderboard.length, 3);
  assert.ok(board.leaderboard[0].score > 0);
  assert.equal(board.leaderboard.at(-1).nickname, 'Ben');

  // Frage 2: ein Spieler trennt die Verbindung, die anderen antworten → schließt trotzdem früh
  const q2 = waitFor(host, 'host:state', (s) => s.state === 'question' && s.qIndex === 1);
  await call(host, 'host:next');
  await q2;
  players[2].close();
  await new Promise((r) => setTimeout(r, 100));
  const reveal2 = waitFor(host, 'host:state', (s) => s.state === 'reveal' && s.qIndex === 1);
  await call(players[0], 'player:answer', { choice: 0 });
  await call(players[1], 'player:answer', { choice: 0 });
  await reveal2;

  // Letzte Frage → Podium mit Report
  const podium = waitFor(host, 'host:state', (s) => s.state === 'podium');
  const playerPodium = waitFor(players[0], 'player:state', (s) => s.state === 'podium');
  await call(host, 'host:next');
  const end = await podium;
  const p0 = await playerPodium;
  assert.equal(end.podium[0].nickname, 'Anna');
  assert.equal(p0.rank, 1);
  assert.equal(end.report.players.length, 3);
  assert.equal(end.report.players.find((p) => p.nickname === 'Cem').answers[1], null);

  // Host beendet → alle bekommen game:closed
  const closed = waitFor(players[0], 'game:closed');
  await call(host, 'host:end');
  await closed;
  assert.equal(app.games.size, 0);
});

test('Timer schließt die Frage, wenn nicht alle antworten', async (t) => {
  const { app, url } = await start();
  const host = client(url);
  const p = client(url);
  t.after(() => {
    host.close();
    p.close();
    app.close();
  });
  const quiz = { title: 'T', questions: [{ type: 'quiz', text: 'Q', options: ['a', 'b'], correct: [0], timeLimit: 5 }] };
  const { pin } = await call(host, 'host:create', { quiz });
  await call(p, 'player:join', { pin, nickname: 'Schläfer' });
  await call(host, 'host:next');
  const reveal = await waitFor(host, 'host:state', (s) => s.state === 'reveal', 7000);
  assert.deepEqual(reveal.counts, [0, 0]);
});

test('Reconnect: Spieler und Host kommen mit Token zurück', async (t) => {
  const { app, url } = await start();
  const host = client(url);
  const p = client(url);
  const cleanup = [host, p];
  t.after(() => {
    cleanup.forEach((s) => s.close());
    app.close();
  });
  const { pin, hostToken } = await call(host, 'host:create', { quiz: QUIZ });
  const { token } = await call(p, 'player:join', { pin, nickname: 'Pendler' });
  p.close();
  host.close();
  await new Promise((r) => setTimeout(r, 100));

  const p2 = client(url);
  const host2 = client(url);
  cleanup.push(p2, host2);
  assert.equal((await call(p2, 'player:resume', { pin, token })).ok, true);
  assert.equal((await call(client(url), 'player:resume', { pin, token: 'f'.repeat(32) })).ok, false, 'falsches Token');
  const stateP = waitFor(host2, 'host:state');
  const resumed = await call(host2, 'host:resume', { pin, hostToken });
  assert.equal(resumed.ok, true);
  const state = await stateP;
  assert.equal(state.players[0].connected, true);
  assert.equal((await call(client(url), 'host:resume', { pin, hostToken: 'falsch' })).ok, false);
});

test('Host-Passwort, ungültiges Quiz, PIN-Raten wird gebremst', async (t) => {
  const { app, url } = await start({ hostPassword: 'geheim' });
  const host = client(url);
  const guesser = client(url);
  t.after(() => {
    host.close();
    guesser.close();
    app.close();
  });
  const noPw = await call(host, 'host:create', { quiz: QUIZ });
  assert.equal(noPw.ok, false);
  assert.equal(noPw.code, 'password');
  const badQuiz = await call(host, 'host:create', { quiz: { title: 'x', questions: [] }, password: 'geheim' });
  assert.equal(badQuiz.ok, false);
  assert.equal((await call(host, 'host:create', { quiz: QUIZ, password: 'geheim' })).ok, true);

  let lastError = '';
  for (let i = 0; i < 21; i += 1) {
    const r = await call(guesser, 'player:join', { pin: String(100000 + i), nickname: 'X' });
    lastError = r.error;
    await new Promise((res) => setTimeout(res, 110)); // unter dem Event-Limit bleiben
  }
  assert.match(lastError, /Zu viele Versuche/);
});

test('Spieler-Adresse: bei localhost LAN-Adresse, mit PUBLIC_URL feste Adresse', async (t) => {
  const local = await start();
  const fixed = await start({ publicUrl: 'https://quiz.example.de' });
  const a = connect(local.url.replace('127.0.0.1', 'localhost'), { transports: ['websocket'], forceNew: true, reconnection: false });
  const b = client(fixed.url);
  t.after(() => {
    a.close();
    b.close();
    local.app.close();
    fixed.app.close();
  });
  const resLocal = await call(a, 'host:create', { quiz: QUIZ });
  const port = local.app.server.address().port;
  assert.ok(resLocal.joinUrl === '' || new RegExp(`^http://\\d+\\.\\d+\\.\\d+\\.\\d+:${port}$`).test(resLocal.joinUrl), resLocal.joinUrl);
  const resFixed = await call(b, 'host:create', { quiz: QUIZ });
  assert.equal(resFixed.joinUrl, 'https://quiz.example.de');
});

test('HTTP: Seiten, Sicherheits-Header, kein Pfad-Ausbruch', async (t) => {
  const { app, url } = await start();
  t.after(() => app.close());
  const res = await fetch(`${url}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${url}/host`)).status, 200);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
  assert.equal((await fetch(`${url}/%2e%2e/package.json`)).status, 404);
  assert.equal((await fetch(`${url}/..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${url}/socket.io/socket.io.min.js`)).status, 200, 'Client-Bibliothek kommt vom eigenen Server');
});
