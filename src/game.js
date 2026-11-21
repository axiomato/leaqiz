'use strict';

// Reine Spiel-Logik: keine Sockets, keine Timer. Die Zeit kommt immer als
// Parameter `now` (ms) herein – dadurch ist alles deterministisch testbar.

const crypto = require('node:crypto');

const MAX_POINTS = 1000; // richtige Sofort-Antwort
const MIN_POINTS = 500; // richtige Antwort in letzter Sekunde
const STREAK_STEP = 100; // Bonus je weiterer richtiger Antwort in Folge
const STREAK_MAX = 500; // Deckel für den Serien-Bonus
const LATE_GRACE_MS = 500; // Netzwerk-Toleranz nach Ablauf des Timers

class GameError extends Error {}

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Punkte: 1000 bei sofortiger, 500 bei Antwort in letzter Sekunde, linear dazwischen.
// Serien-Bonus ab der zweiten richtigen Antwort in Folge.
function scoreAnswer({ correct, elapsedMs, limitMs, streak }) {
  if (!correct) return 0;
  const ratio = limitMs > 0 ? Math.min(Math.max(elapsedMs / limitMs, 0), 1) : 1;
  const base = Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * ratio);
  const bonus = Math.min(Math.max(streak - 1, 0) * STREAK_STEP, STREAK_MAX);
  return base + bonus;
}

// Wettkampf-Rangfolge (1, 2, 2, 4). Bei Gleichstand alphabetisch für eine stabile Anzeige.
function rankPlayers(players) {
  const sorted = [...players].sort(
    (a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'de'),
  );
  let rank = 0;
  let prevScore = null;
  return sorted.map((p, i) => {
    if (p.score !== prevScore) {
      rank = i + 1;
      prevScore = p.score;
    }
    return { id: p.id, nickname: p.nickname, score: p.score, rank };
  });
}

class Game {
  constructor({ pin, quiz, now, maxPlayers = 200 }) {
    this.pin = pin;
    this.quiz = quiz;
    this.hostToken = randomToken();
    this.maxPlayers = maxPlayers;
    this.state = 'lobby'; // lobby | countdown | question | reveal | leaderboard | podium
    this.qIndex = -1;
    this.players = new Map();
    this.round = null;
    this.countdownEndsAt = null;
    this.createdAt = now;
    this.lastActivity = now;
    this.hostConnected = true;
    this.hostLeftAt = null;
  }

  get question() {
    return this.quiz.questions[this.qIndex] || null;
  }

  get questionCount() {
    return this.quiz.questions.length;
  }

  get isLastQuestion() {
    return this.qIndex >= this.questionCount - 1;
  }

  touch(now) {
    this.lastActivity = now;
  }

  // ---------- Spieler ----------

  addPlayer(nickname, now) {
    if (this.state === 'podium') throw new GameError('Dieses Spiel ist bereits beendet.');
    if (this.players.size >= this.maxPlayers) throw new GameError('Das Spiel ist voll.');
    const key = nickname.toLocaleLowerCase('de');
    for (const p of this.players.values()) {
      if (p.nickname.toLocaleLowerCase('de') === key) throw new GameError('Dieser Spielname ist schon vergeben.');
    }
    const player = {
      id: randomToken(8),
      token: randomToken(),
      nickname,
      score: 0,
      streak: 0,
      correctCount: 0,
      last: null, // Ergebnis der letzten Frage
      answers: [],
      connected: true,
      disconnectedAt: null,
      joinedAt: now,
    };
    this.players.set(player.id, player);
    this.touch(now);
    return player;
  }

  findPlayerByToken(token) {
    if (typeof token !== 'string' || token.length !== 32) return null;
    const probe = Buffer.from(token);
    for (const p of this.players.values()) {
      const candidate = Buffer.from(p.token);
      if (candidate.length === probe.length && crypto.timingSafeEqual(candidate, probe)) return p;
    }
    return null;
  }

  checkHostToken(token) {
    if (typeof token !== 'string') return false;
    const a = Buffer.from(token);
    const b = Buffer.from(this.hostToken);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  removePlayer(id) {
    const existed = this.players.delete(id);
    if (this.round) this.round.answers.delete(id);
    return existed;
  }

  setConnected(player, connected, now) {
    player.connected = connected;
    player.disconnectedAt = connected ? null : now;
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  // ---------- Ablauf ----------

  startCountdown(now, countdownMs) {
    if (this.state !== 'lobby' && this.state !== 'leaderboard') throw new GameError('Jetzt kann keine neue Frage starten.');
    if (this.state === 'lobby' && this.players.size === 0) throw new GameError('Es ist noch niemand beigetreten.');
    if (this.isLastQuestion) throw new GameError('Es gibt keine weitere Frage.');
    this.qIndex += 1;
    this.state = 'countdown';
    this.round = null;
    this.countdownEndsAt = now + countdownMs;
    this.touch(now);
  }

  openQuestion(now) {
    if (this.state !== 'countdown') throw new GameError('Die Frage kann gerade nicht geöffnet werden.');
    const limitMs = this.question.timeLimit * 1000;
    this.state = 'question';
    this.countdownEndsAt = null;
    this.round = { openedAt: now, closesAt: now + limitMs, limitMs, answers: new Map() };
    this.touch(now);
  }

  submitAnswer(playerId, choice, now) {
    if (this.state !== 'question') throw new GameError('Gerade ist keine Antwort möglich.');
    const player = this.players.get(playerId);
    if (!player) throw new GameError('Du bist nicht in diesem Spiel.');
    if (this.round.answers.has(playerId)) throw new GameError('Du hast schon geantwortet.');
    if (!Number.isInteger(choice) || choice < 0 || choice >= this.question.options.length) {
      throw new GameError('Ungültige Antwort.');
    }
    if (now > this.round.closesAt + LATE_GRACE_MS) throw new GameError('Die Zeit ist abgelaufen.');
    const elapsedMs = Math.min(Math.max(now - this.round.openedAt, 0), this.round.limitMs);
    this.round.answers.set(playerId, { choice, elapsedMs });
    this.touch(now);
    return this.allAnswered();
  }

  // Alle verbundenen Spieler haben geantwortet → Frage darf früher schließen.
  allAnswered() {
    if (this.state !== 'question') return false;
    const connected = this.connectedPlayers();
    return connected.length > 0 && connected.every((p) => this.round.answers.has(p.id));
  }

  closeQuestion(now) {
    if (this.state !== 'question') throw new GameError('Es läuft gerade keine Frage.');
    const q = this.question;
    const before = new Map(rankPlayers(this.players.values()).map((r) => [r.id, r.rank]));
    for (const p of this.players.values()) {
      const a = this.round.answers.get(p.id);
      const correct = Boolean(a) && q.correct.includes(a.choice);
      p.streak = correct ? p.streak + 1 : 0;
      const points = scoreAnswer({ correct, elapsedMs: a ? a.elapsedMs : 0, limitMs: this.round.limitMs, streak: p.streak });
      if (correct) p.correctCount += 1;
      p.score += points;
      p.answers[this.qIndex] = a ? { choice: a.choice, elapsedMs: a.elapsedMs, correct, points } : null;
      p.last = { answered: Boolean(a), choice: a ? a.choice : null, correct, points, streak: p.streak, rankBefore: before.get(p.id) };
    }
    this.state = 'reveal';
    this.touch(now);
  }

  finish(now) {
    this.state = 'podium';
    this.round = null;
    this.countdownEndsAt = null;
    this.touch(now);
  }

  // Host klickt „Weiter“. Gibt zurück, ob sich etwas geändert hat.
  advance(now, countdownMs) {
    switch (this.state) {
      case 'lobby':
      case 'leaderboard':
        this.startCountdown(now, countdownMs);
        return true;
      case 'question':
        this.closeQuestion(now);
        return true;
      case 'reveal':
        if (this.isLastQuestion) this.finish(now);
        else {
          this.state = 'leaderboard';
          this.touch(now);
        }
        return true;
      default:
        return false; // countdown und podium laufen ohne Host-Eingriff
    }
  }

  // ---------- Ansichten (absoluter Zustand, damit Reconnects trivial sind) ----------

  ranking() {
    return rankPlayers(this.players.values());
  }

  answerCounts() {
    const q = this.question;
    const counts = q ? q.options.map(() => 0) : [];
    if (this.round) for (const a of this.round.answers.values()) counts[a.choice] += 1;
    return counts;
  }

  remainingMs(now) {
    if (this.state === 'countdown') return Math.max(0, this.countdownEndsAt - now);
    if (this.state === 'question') return Math.max(0, this.round.closesAt - now);
    return 0;
  }

  hostView(now) {
    const q = this.question;
    const ranking = this.ranking();
    const view = {
      pin: this.pin,
      title: this.quiz.title,
      state: this.state,
      qIndex: this.qIndex,
      qCount: this.questionCount,
      isLast: this.isLastQuestion,
      remainingMs: this.remainingMs(now),
      players: [...this.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({ id: p.id, nickname: p.nickname, connected: p.connected })),
      question: null,
      answeredCount: this.round ? this.round.answers.size : 0,
      activeCount: this.connectedPlayers().length,
      counts: null,
      leaderboard: null,
      podium: null,
      report: null,
    };
    if (q && this.state !== 'lobby' && this.state !== 'podium') {
      view.question = { type: q.type, text: q.text, options: q.options, timeLimit: q.timeLimit };
      if (this.state === 'reveal' || this.state === 'leaderboard') view.question.correct = q.correct;
    }
    if (this.state === 'reveal') view.counts = this.answerCounts();
    if (this.state === 'leaderboard') {
      view.leaderboard = ranking.slice(0, 5).map((r) => {
        const p = this.players.get(r.id);
        return { ...r, delta: p.last ? p.last.points : 0, streak: p.streak };
      });
    }
    if (this.state === 'podium') {
      view.podium = ranking.filter((r) => r.rank <= 3);
      view.report = this.report();
    }
    return view;
  }

  playerView(playerId, now) {
    const p = this.players.get(playerId);
    if (!p) return null;
    const q = this.question;
    const ranking = this.ranking();
    const idx = ranking.findIndex((r) => r.id === playerId);
    const me = ranking[idx];
    const view = {
      pin: this.pin,
      title: this.quiz.title,
      state: this.state,
      qIndex: this.qIndex,
      qCount: this.questionCount,
      remainingMs: this.remainingMs(now),
      nickname: p.nickname,
      hostOnline: this.hostConnected,
      score: p.score,
      rank: me.rank,
      playerCount: this.players.size,
      question: null,
      answered: false,
      result: null,
      behind: null,
      podium: null,
    };
    // Richtige Antworten erst nach dem Schließen der Frage senden (kein Schummeln über DevTools).
    if (q && (this.state === 'countdown' || this.state === 'question' || this.state === 'reveal' || this.state === 'leaderboard')) {
      view.question = { type: q.type, text: q.text, options: q.options, timeLimit: q.timeLimit };
      if (this.state === 'reveal' || this.state === 'leaderboard') view.question.correct = q.correct;
    }
    if (this.state === 'question') view.answered = this.round.answers.has(playerId);
    if ((this.state === 'reveal' || this.state === 'leaderboard') && p.last) {
      view.result = { ...p.last, rankNow: me.rank };
    }
    if (idx > 0) {
      const above = ranking[idx - 1];
      if (above.score > p.score) view.behind = { nickname: above.nickname, gap: above.score - p.score };
    }
    if (this.state === 'podium') view.podium = ranking.filter((r) => r.rank <= 3);
    return view;
  }

  // Auswertung für den CSV-Export des Hosts.
  report() {
    const questions = this.quiz.questions.slice(0, this.qIndex + 1).map((q) => ({
      text: q.text,
      options: q.options,
      correct: q.correct,
    }));
    const players = this.ranking().map((r) => {
      const p = this.players.get(r.id);
      return {
        rank: r.rank,
        nickname: p.nickname,
        score: p.score,
        correctCount: p.correctCount,
        answers: questions.map((_, i) => p.answers[i] || null),
      };
    });
    return { title: this.quiz.title, questions, players };
  }
}

module.exports = { Game, GameError, scoreAnswer, rankPlayers, randomToken, LATE_GRACE_MS };
