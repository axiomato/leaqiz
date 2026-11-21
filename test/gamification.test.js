'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, scoreAnswer, computeAwards } = require('../public/js/engine/game.js');
const { validateQuiz } = require('../public/js/engine/validate.js');

const quiz = validateQuiz({
  title: 'Gamification',
  questions: [
    { type: 'quiz', text: 'Q1', options: ['a', 'b'], correct: [0], timeLimit: 10 },
    { type: 'quiz', text: 'Q2', options: ['a', 'b'], correct: [0], timeLimit: 10, double: true },
    { type: 'quiz', text: 'Q3', options: ['a', 'b'], correct: [0], timeLimit: 10 },
  ],
});

// Spielt eine Frage: answers = { name: [choice, elapsedMs] }
function play(game, players, answers, t) {
  game.advance(t, 0); // countdown
  game.openQuestion(t);
  for (const [name, [choice, ms]] of Object.entries(answers)) game.submitAnswer(players[name].id, choice, t + ms);
  game.advance(t + 20000, 0); // schließen → reveal
  return t + 30000;
}

function setup(names) {
  const game = new Game({ pin: '123456', quiz, now: 0 });
  const players = {};
  for (const n of names) players[n] = game.addPlayer(n, 0);
  return { game, players };
}

test('Doppelte Punkte: verdoppelt Grundpunkte und Serien-Bonus; Flag übersteht die Validierung', () => {
  assert.equal(quiz.questions[1].double, true);
  assert.equal(quiz.questions[0].double, false);
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 0, limitMs: 1000, streak: 2, double: true }), 2200);
  assert.equal(scoreAnswer({ correct: false, elapsedMs: 0, limitMs: 1000, streak: 0, double: true }), 0);
  const nonBool = validateQuiz({ title: 'x', questions: [{ text: 'a', options: ['1', '2'], correct: [0], double: 'ja' }] });
  assert.equal(nonBool.questions[0].double, false, 'nur echtes true zählt');
});

test('Doppelte Punkte: Spiel rechnet doppelt und meldet es Host und Spieler', () => {
  const { game, players } = setup(['Anna']);
  let t = play(game, players, { Anna: [0, 0] }, 0);
  game.advance(t, 0); // leaderboard
  t = play(game, players, { Anna: [0, 0] }, t);
  assert.equal(players.Anna.last.points, 2200, '(1000 + 100 Serie) × 2');
  assert.equal(players.Anna.last.double, true);
  assert.equal(game.hostView(t).question.double, true);
  assert.equal(game.playerView(players.Anna.id, t).question.double, true);
});

test('Rangbewegung: erst ab Frage 2, mit Position davor für die Animation', () => {
  const { game, players } = setup(['Anna', 'Ben', 'Cem']);
  let t = play(game, players, { Anna: [0, 0], Ben: [1, 0], Cem: [1, 0] }, 0);
  assert.equal(players.Ben.last.move, 0, 'nach Frage 1 keine Bewegung');
  game.advance(t, 0);
  const lb1 = game.hostView(t).leaderboard;
  assert.equal(lb1[0].posBefore, null);
  // Frage 2 (doppelt): Cem schnell richtig, Anna falsch → Cem zieht vorbei
  t = play(game, players, { Anna: [1, 0], Ben: [1, 0], Cem: [0, 0] }, t);
  assert.equal(players.Cem.last.move, 1, 'Cem: Platz 2 → 1');
  assert.equal(players.Anna.last.move, -1);
  game.advance(t, 0);
  const lb2 = game.hostView(t).leaderboard;
  assert.equal(lb2[0].nickname, 'Cem');
  assert.equal(lb2[0].move, 1);
  assert.equal(lb2[0].posBefore, 2, 'Cem stand vorher an Position 3 (alphabetisch hinter Ben)');
  assert.equal(lb2[1].nickname, 'Anna');
  assert.equal(lb2[1].posBefore, 0);
  assert.equal(players.Cem.bestJump, 1);
});

test('Auszeichnungen: schnellste Antwort, längste Serie, Aufholjagd, fehlerfrei', () => {
  const { game, players } = setup(['Anna', 'Ben', 'Cem', 'Dora']);
  let t = play(game, players, { Anna: [0, 900], Ben: [0, 4000], Cem: [1, 100], Dora: [0, 2000] }, 0);
  game.advance(t, 0);
  t = play(game, players, { Anna: [0, 1500], Ben: [1, 300], Cem: [0, 200], Dora: [0, 3000] }, t);
  game.advance(t, 0);
  t = play(game, players, { Anna: [0, 2500], Ben: [0, 700], Cem: [0, 800], Dora: [1, 50] }, t);
  game.advance(t, 0); // letzte Frage → podium
  assert.equal(game.state, 'podium');

  const awards = Object.fromEntries(game.hostView(t).awards.map((a) => [a.key, a]));
  assert.deepEqual(awards.fastest.winners.map((w) => w.nickname), ['Cem'], 'Cem: 200 ms (seine falsche 100 ms zählt nicht)');
  assert.equal(awards.fastest.value, 200);
  assert.deepEqual(awards.streak.winners.map((w) => w.nickname), ['Anna'], 'Anna: 3 in Folge');
  assert.equal(awards.streak.value, 3);
  assert.deepEqual(awards.perfect.winners.map((w) => w.nickname), ['Anna']);
  assert.ok(awards.jump, 'jemand ist in einer Runde aufgestiegen');
  assert.ok(awards.jump.winners.map((w) => w.nickname).includes('Cem'));

  // Spieler sieht nur eigene Auszeichnungen, ohne fremde Namen
  const anna = game.playerView(players.Anna.id, t).awards;
  assert.deepEqual(anna.map((a) => a.key).sort(), ['perfect', 'streak']);
  assert.equal(JSON.stringify(anna).includes('Cem'), false);
  assert.deepEqual(game.playerView(players.Dora.id, t).awards, []);
});

test('Auszeichnungen: Gleichstand teilt, Schwellen verhindern leere Titel', () => {
  const ps = [
    { id: 'a', nickname: 'Anna', fastestMs: 500, bestStreak: 1, bestJump: 0, correctCount: 1 },
    { id: 'b', nickname: 'Ben', fastestMs: 500, bestStreak: 1, bestJump: 0, correctCount: 0 },
    { id: 'c', nickname: 'Cem', fastestMs: null, bestStreak: 0, bestJump: 0, correctCount: 0 },
  ];
  const awards = computeAwards(ps, 1);
  assert.deepEqual(awards.map((a) => a.key), ['fastest'], 'Serie < 2, kein Sprung, fehlerfrei erst ab 2 Fragen');
  assert.deepEqual(awards[0].winners.map((w) => w.nickname), ['Anna', 'Ben']);
  assert.deepEqual(computeAwards([], 3), []);
});

test('Neuladen: alte Spielstände ohne neue Felder bleiben spielbar', () => {
  const { game, players } = setup(['Anna']);
  const data = JSON.parse(JSON.stringify(game.toJSON()));
  for (const p of data.players) {
    delete p.bestStreak;
    delete p.bestJump;
    delete p.fastestMs;
  }
  const g2 = Game.fromJSON(data, 1);
  g2.setConnected(g2.players.get(players.Anna.id), true, 1);
  const t = play(g2, { Anna: g2.players.get(players.Anna.id) }, { Anna: [0, 0] }, 1);
  assert.equal(g2.players.get(players.Anna.id).bestStreak, 1);
  assert.equal(g2.players.get(players.Anna.id).fastestMs, 0);
  assert.ok(Array.isArray(g2.awards()));
  assert.ok(t > 0);
});
