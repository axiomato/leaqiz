'use strict';

// Host-Engine mit simuliertem Transport und simulierter Uhr:
// ganze Spiele, Wiederverbindung, Neuladen der Host-Seite, Schummelschutz.

const test = require('node:test');
const assert = require('node:assert/strict');
const { HostEngine, randomPin } = require('../public/js/engine/host-engine.js');

const QUIZ = {
  title: 'Engine',
  questions: [
    { type: 'quiz', text: 'Hauptstadt von Frankreich?', options: ['Berlin', 'Paris', 'Rom', 'Wien'], correct: [1], timeLimit: 10 },
    { type: 'truefalse', text: 'Wasser kocht auf Meereshöhe bei 100 °C.', correct: [0], timeLimit: 5 },
  ],
};

// Simulierte Uhr mit Timern
function fakeClock() {
  let now = 1_000_000;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

// Simulierter Transport: sammelt alles, was die Engine an Verbindungen schickt
function setup(extra = {}) {
  const clock = fakeClock();
  const outbox = new Map(); // connId -> messages
  const hostViews = [];
  let closedReason = null;
  const engine = HostEngine.create({
    quiz: QUIZ,
    options: { countdownMs: 1000, ...(extra.options || {}) },
    clock: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    send: (connId, msg) => {
      if (!outbox.has(connId)) outbox.set(connId, []);
      outbox.get(connId).push(msg);
    },
    onChange: (view) => hostViews.push(view),
    onClosed: (reason) => {
      closedReason = reason;
    },
  });
  let reqId = 0;
  const player = (connId) => {
    engine.attach(connId);
    return {
      connId,
      req(ev, p) {
        const id = ++reqId;
        engine.handle(connId, { k: 'req', id, ev, p });
        const ack = (outbox.get(connId) || []).find((m) => m.k === 'ack' && m.id === id);
        return ack ? ack.r : undefined;
      },
      lastState() {
        const states = (outbox.get(connId) || []).filter((m) => m.k === 'state');
        return states.at(-1) && states.at(-1).d;
      },
      messages: () => outbox.get(connId) || [],
    };
  };
  return { engine, clock, player, hostViews, lastHost: () => hostViews.at(-1), closed: () => closedReason };
}

test('PIN: sechs Ziffern, zufällig', () => {
  const pins = new Set(Array.from({ length: 50 }, randomPin));
  for (const p of pins) assert.match(p, /^\d{6}$/);
  assert.ok(pins.size > 40);
});

test('Ganzes Spiel: Beitritt, Antworten, frühes Schließen, Rangliste, Podium', () => {
  const { engine, clock, player, lastHost } = setup();
  const [a, b, c] = ['p1', 'p2', 'p3'].map(player);

  assert.equal(a.req('player:check').title, 'Engine');
  assert.equal(a.req('player:join', { nickname: 'Anna' }).ok, true);
  assert.equal(b.req('player:join', { nickname: 'Ben' }).ok, true);
  assert.equal(c.req('player:join', { nickname: 'anna' }).ok, false, 'Name ist schon vergeben');
  assert.equal(c.req('player:join', { nickname: 'Cem' }).ok, true);
  assert.equal(a.req('player:join', { nickname: 'Nochmal' }).ok, false, 'pro Verbindung nur ein Spieler');
  assert.equal(lastHost().players.length, 3);
  assert.equal(a.lastState().state, 'lobby');

  engine.next(); // Countdown
  assert.equal(a.lastState().state, 'countdown');
  assert.equal(a.req('player:answer', { choice: 1 }).ok, false, 'im Countdown keine Antwort');
  clock.advance(1000); // Frage öffnet per Timer
  const q = a.lastState();
  assert.equal(q.state, 'question');
  assert.equal(q.question.correct, undefined, 'Spieler kennt die Lösung nicht vorab');

  clock.advance(500);
  assert.equal(a.req('player:answer', { choice: 1 }).ok, true);
  assert.equal(a.req('player:answer', { choice: 1 }).ok, false, 'nur einmal antworten');
  assert.equal(b.req('player:answer', { choice: 9 }).ok, false, 'ungültige Antwort');
  b.req('player:answer', { choice: 0 });
  assert.equal(lastHost().answeredCount, 2);
  c.req('player:answer', { choice: 1 }); // alle haben geantwortet → Auflösung
  assert.equal(lastHost().state, 'reveal');
  assert.deepEqual(lastHost().counts, [1, 2, 0, 0]);
  assert.equal(a.lastState().result.correct, true);
  assert.equal(b.lastState().result.correct, false);
  assert.deepEqual(b.lastState().question.correct, [1]);

  engine.next(); // Zwischenstand
  assert.equal(lastHost().state, 'leaderboard');
  assert.equal(lastHost().leaderboard.at(-1).nickname, 'Ben');

  engine.next(); // Frage 2
  clock.advance(1000);
  c.req('player:answer', { choice: 0 });
  clock.advance(6000); // Timer schließt, obwohl nicht alle geantwortet haben
  assert.equal(lastHost().state, 'reveal');
  engine.next(); // letzte Frage → Podium
  const end = lastHost();
  assert.equal(end.state, 'podium');
  assert.equal(end.podium[0].nickname, 'Cem');
  assert.equal(end.report.players.length, 3);
  assert.equal(a.lastState().state, 'podium');
});

test('Getrennter Spieler: Frage schließt trotzdem früh, Rückkehr mit Token', () => {
  const { engine, clock, player, lastHost } = setup();
  const a = player('a1');
  const b = player('b1');
  a.req('player:join', { nickname: 'Anna' });
  const { token } = b.req('player:join', { nickname: 'Ben' });
  engine.next();
  clock.advance(1000);
  engine.detach('b1'); // Ben verliert die Verbindung
  assert.equal(lastHost().players.find((p) => p.nickname === 'Ben').connected, false);
  a.req('player:answer', { choice: 1 }); // alle verbundenen Spieler haben geantwortet
  assert.equal(lastHost().state, 'reveal');

  const b2 = player('b2');
  assert.equal(b2.req('player:resume', { token: 'f'.repeat(32) }).ok, false);
  assert.equal(b2.req('player:resume', { token }).ok, true);
  assert.equal(b2.lastState().nickname, 'Ben');
  assert.equal(b2.lastState().result.answered, false);
  assert.equal(lastHost().players.find((p) => p.nickname === 'Ben').connected, true);
});

test('Zweites Fenster übernimmt, altes Fenster wird abgemeldet', () => {
  const { player } = setup();
  const a = player('x1');
  const { token } = a.req('player:join', { nickname: 'Anna' });
  const a2 = player('x2');
  a2.req('player:resume', { token });
  assert.ok(a.messages().some((m) => m.k === 'closed'));
  assert.equal(a.req('player:answer', { choice: 0 }).ok, false);
});

test('Host-Seite neu laden: Spiel wird aus dem Speicherstand fortgesetzt', () => {
  const s = setup();
  const a = s.player('a1');
  const { token } = a.req('player:join', { nickname: 'Anna' });
  s.player('b1').req('player:join', { nickname: 'Ben' }); // Ben antwortet nicht
  s.engine.next();
  s.clock.advance(1000); // Frage läuft
  a.req('player:answer', { choice: 1 });
  const snap = JSON.parse(JSON.stringify(s.engine.snapshot())); // wie sessionStorage

  const views = [];
  const outbox = [];
  const restored = HostEngine.restore(snap, {
    clock: s.clock.now,
    setTimer: s.clock.setTimer,
    clearTimer: s.clock.clearTimer,
    send: (connId, msg) => outbox.push({ connId, msg }),
    onChange: (v) => views.push(v),
  });
  assert.equal(restored.pin, s.engine.pin);
  assert.equal(restored.hostView().state, 'question');
  assert.equal(restored.hostView().answeredCount, 1, 'Antwort bleibt erhalten');
  restored.attach('neu');
  restored.handle('neu', { k: 'req', id: 1, ev: 'player:resume', p: { token } });
  assert.equal(outbox.find((o) => o.msg.k === 'ack').msg.r.ok, true);
  s.clock.advance(20_000); // Timer läuft im wiederhergestellten Spiel weiter
  assert.equal(views.at(-1).state, 'reveal');
});

test('Nach Neuladen: Frage schließt nicht, nur weil der erste Rückkehrer schon geantwortet hat', () => {
  const s = setup();
  const a = s.player('a1');
  const b = s.player('b1');
  const { token: ta } = a.req('player:join', { nickname: 'Anna' });
  const { token: tb } = b.req('player:join', { nickname: 'Ben' });
  s.engine.next();
  s.clock.advance(1000);
  a.req('player:answer', { choice: 1 });
  const snap = JSON.parse(JSON.stringify(s.engine.snapshot()));
  const views = [];
  const out = [];
  const r = HostEngine.restore(snap, {
    clock: s.clock.now,
    setTimer: s.clock.setTimer,
    clearTimer: s.clock.clearTimer,
    send: (c, m) => out.push({ c, m }),
    onChange: (v) => views.push(v),
    options: { restoreGraceMs: 3000 },
  });
  r.attach('a2');
  r.handle('a2', { k: 'req', id: 1, ev: 'player:resume', p: { token: ta } });
  assert.equal(r.hostView().state, 'question', 'Ben ist noch nicht zurück');
  r.attach('b2');
  r.handle('b2', { k: 'req', id: 2, ev: 'player:resume', p: { token: tb } });
  r.handle('b2', { k: 'req', id: 3, ev: 'player:answer', p: { choice: 0 } });
  assert.equal(out.find((o) => o.m.k === 'ack' && o.m.id === 3).m.r.ok, true);
  assert.ok(out.some((o) => o.c === 'b2' && o.m.k === 'state' && o.m.d.answered), 'Ben sieht "Gesendet"');
  s.clock.advance(3100); // Schonfrist vorbei (Frage-Timer noch nicht): alle haben geantwortet → Auflösung
  assert.equal(r.hostView().state, 'reveal');
});

test('Gedrosselte Timer: überfällige Phase wird bei der nächsten Nachricht nachgeholt', () => {
  const { engine, player, lastHost } = setup();
  const a = player('a');
  a.req('player:join', { nickname: 'Anna' });
  engine.next();
  // Kein advance(): Timer feuert nicht (wie im Hintergrund-Tab), aber Zeit vergeht
  engine.now = () => Date.now() + 10 * 60_000;
  a.req('player:check');
  assert.equal(lastHost().state, 'question');
});

test('Spieler entfernen, Spiel beenden, Nachrichtenflut', () => {
  const { engine, player, lastHost, closed } = setup();
  const a = player('a');
  const b = player('b');
  a.req('player:join', { nickname: 'Anna' });
  b.req('player:join', { nickname: 'Ben' });
  const ben = lastHost().players.find((p) => p.nickname === 'Ben');
  engine.kick(ben.id);
  assert.ok(b.messages().some((m) => m.k === 'closed'));
  assert.equal(lastHost().players.length, 1);

  // 100 Anfragen ohne Pause: höchstens der Puffer (20) wird beantwortet
  let answered = 0;
  for (let i = 0; i < 100; i += 1) if (a.req('player:check')) answered += 1;
  assert.ok(answered <= 20, `beantwortet: ${answered}`);

  engine.end();
  assert.match(closed(), /beendet/);
  assert.ok(a.messages().some((m) => m.k === 'closed'));
  assert.throws(() => engine.next());
});

test('Ungültige Nachrichten werden ignoriert, unbekannte Anfragen abgelehnt', () => {
  const { engine, player } = setup();
  const a = player('a');
  engine.handle('a', null);
  engine.handle('a', 'text');
  engine.handle('a', { k: 'state', d: {} });
  engine.handle('unbekannt', { k: 'req', id: 1, ev: 'player:check' });
  assert.equal(a.messages().length, 0);
  assert.equal(a.req('host:next').ok, false, 'Spieler können keine Host-Aktionen auslösen');
});

test('Lobby: getrennte Spieler verschwinden nach 2 Minuten', () => {
  const { engine, clock, player, lastHost } = setup();
  player('a').req('player:join', { nickname: 'Anna' });
  engine.detach('a');
  assert.equal(lastHost().players.length, 1);
  clock.advance(3 * 60_000);
  assert.equal(lastHost().players.length, 0);
});

test('Last: 200 Spieler, eine Runde', () => {
  const { engine, clock, player, lastHost } = setup();
  const ps = Array.from({ length: 200 }, (_, i) => player(`c${i}`));
  ps.forEach((p, i) => p.req('player:join', { nickname: `P${i}` }));
  engine.next();
  clock.advance(1000);
  const t0 = process.hrtime.bigint();
  ps.forEach((p, i) => p.req('player:answer', { choice: i % 4 }));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(lastHost().state, 'reveal');
  assert.deepEqual(lastHost().counts, [50, 50, 50, 50]);
  assert.ok(ms < 2000, `zu langsam: ${ms} ms`);
});
