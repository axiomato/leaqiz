'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GameError, scoreAnswer, rankPlayers } = require('../src/game');
const { validateQuiz, validateNickname, ValidationError } = require('../src/validate');

const quiz = validateQuiz({
  title: 'Test',
  questions: [
    { type: 'quiz', text: '2+2?', options: ['3', '4', '5'], correct: [1], timeLimit: 10 },
    { type: 'truefalse', text: 'Die Erde ist rund.', correct: [0], timeLimit: 5 },
  ],
});

test('Punkte: sofort 1000, letzte Sekunde 500, falsch 0', () => {
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 0, limitMs: 10000, streak: 1 }), 1000);
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 10000, limitMs: 10000, streak: 1 }), 500);
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 5000, limitMs: 10000, streak: 1 }), 750);
  assert.equal(scoreAnswer({ correct: false, elapsedMs: 0, limitMs: 10000, streak: 0 }), 0);
});

test('Serien-Bonus ab der zweiten richtigen Antwort, gedeckelt bei 500', () => {
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 0, limitMs: 1000, streak: 2 }), 1100);
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 0, limitMs: 1000, streak: 20 }), 1500);
});

test('Rangfolge: Gleichstand teilt den Platz (1, 2, 2, 4)', () => {
  const r = rankPlayers([
    { id: 'a', nickname: 'A', score: 10 },
    { id: 'b', nickname: 'B', score: 5 },
    { id: 'c', nickname: 'C', score: 5 },
    { id: 'd', nickname: 'D', score: 1 },
  ]);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 2, 4]);
});

test('Validierung: leere Antwort, fehlende richtige Antwort, Wahr/Falsch fix', () => {
  assert.throws(() => validateQuiz({ title: 'x', questions: [{ text: 'a', options: ['1', ''], correct: [0] }] }), ValidationError);
  assert.throws(() => validateQuiz({ title: 'x', questions: [{ text: 'a', options: ['1', '2'], correct: [] }] }), ValidationError);
  assert.throws(() => validateQuiz({ title: 'x', questions: [] }), ValidationError);
  const tf = validateQuiz({ title: 'x', questions: [{ type: 'truefalse', text: 'a', options: ['egal'], correct: [1] }] });
  assert.deepEqual(tf.questions[0].options, ['Wahr', 'Falsch']);
  assert.equal(tf.questions[0].timeLimit, 20, 'unbekanntes Zeitlimit → Standard 20 s');
});

test('Validierung: Spielname wird bereinigt und begrenzt', () => {
  assert.equal(validateNickname('  Anna \u0000  B '), 'Anna B');
  assert.throws(() => validateNickname('   '), ValidationError);
  assert.throws(() => validateNickname('x'.repeat(21)), ValidationError);
});

test('Kompletter Ablauf mit Punkten, Serie und Podium', () => {
  let t = 0;
  const g = new Game({ pin: '123456', quiz, now: t });
  const anna = g.addPlayer('Anna', t);
  const ben = g.addPlayer('Ben', t);
  assert.throws(() => g.addPlayer('anna', t), GameError, 'Name ist case-insensitiv eindeutig');

  g.advance(t, 1000); // lobby → countdown
  assert.equal(g.state, 'countdown');
  assert.throws(() => g.submitAnswer(anna.id, 1, t), GameError);
  g.openQuestion((t += 1000));

  // Spieleransicht verrät die richtige Antwort nicht vorab
  assert.equal(g.playerView(anna.id, t).question.correct, undefined);

  assert.equal(g.submitAnswer(anna.id, 1, t), false); // sofort richtig
  assert.throws(() => g.submitAnswer(anna.id, 0, t), GameError, 'nur eine Antwort');
  assert.equal(g.submitAnswer(ben.id, 0, (t += 2000)), true); // falsch, alle haben geantwortet
  g.closeQuestion(t);
  assert.equal(g.state, 'reveal');
  assert.equal(anna.score, 1000);
  assert.equal(ben.score, 0);
  assert.deepEqual(g.hostView(t).counts, [1, 1, 0]);
  assert.deepEqual(g.playerView(ben.id, t).question.correct, [1]);
  assert.deepEqual(g.playerView(ben.id, t).behind, { nickname: 'Anna', gap: 1000 });

  g.advance(t, 1000); // reveal → leaderboard
  assert.equal(g.state, 'leaderboard');
  g.advance(t, 1000); // → countdown Frage 2
  g.openQuestion((t += 1000));
  g.submitAnswer(anna.id, 0, (t += 2500)); // richtig nach halber Zeit, Serie 2
  g.advance(t, 1000); // Host schließt vorzeitig
  assert.equal(anna.score, 1000 + 750 + 100);
  assert.equal(ben.last.answered, false);

  g.advance(t, 1000); // letzte Frage: reveal → podium
  assert.equal(g.state, 'podium');
  const view = g.hostView(t);
  assert.equal(view.podium[0].nickname, 'Anna');
  assert.equal(view.report.players[0].correctCount, 2);
  assert.equal(view.report.players[1].answers[1], null);
});

test('Späte Antworten nach Ablauf + Toleranz werden abgelehnt', () => {
  const g = new Game({ pin: '111111', quiz, now: 0 });
  const p = g.addPlayer('P', 0);
  g.advance(0, 0);
  g.openQuestion(0);
  assert.throws(() => g.submitAnswer(p.id, 1, 10_000 + 501), /abgelaufen/);
});

test('Host-Token und Spieler-Token werden sicher verglichen', () => {
  const g = new Game({ pin: '222222', quiz, now: 0 });
  const p = g.addPlayer('P', 0);
  assert.equal(g.findPlayerByToken(p.token), p);
  assert.equal(g.findPlayerByToken('x'.repeat(32)), null);
  assert.equal(g.findPlayerByToken(undefined), null);
  assert.equal(g.checkHostToken(g.hostToken), true);
  assert.equal(g.checkHostToken('falsch'), false);
});
