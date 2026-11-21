// Reine Spiel-Logik: kein Netzwerk, keine Timer. Die Zeit kommt immer als
// Parameter `now` (ms) herein – dadurch ist alles deterministisch testbar.
// Läuft im Browser der Spielleitung (window.LeaqizGame) und in Node (Tests).
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeaqizGame = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const MAX_POINTS = 1000; // richtige Sofort-Antwort
const MIN_POINTS = 500; // richtige Antwort in letzter Sekunde
const STREAK_STEP = 100; // Bonus je weiterer richtiger Antwort in Folge
const STREAK_MAX = 500; // Deckel für den Serien-Bonus
const LATE_GRACE_MS = 500; // Netzwerk-Toleranz nach Ablauf des Timers

class GameError extends Error {}

// Kryptografisch sichere Zufallswerte (Web Crypto, in Browser und Node 20+ vorhanden).
function randomToken(bytes = 16) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Vergleich in konstanter Zeit, damit Tokens nicht über Laufzeiten erraten werden.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Punkte: 1000 bei sofortiger, 500 bei Antwort in letzter Sekunde, linear dazwischen.
// Serien-Bonus ab der zweiten richtigen Antwort in Folge. Doppelte-Punkte-Fragen verdoppeln die Summe.
function scoreAnswer({ correct, elapsedMs, limitMs, streak, double = false }) {
  if (!correct) return 0;
  const ratio = limitMs > 0 ? Math.min(Math.max(elapsedMs / limitMs, 0), 1) : 1;
  const base = Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * ratio);
  const bonus = Math.min(Math.max(streak - 1, 0) * STREAK_STEP, STREAK_MAX);
  return (base + bonus) * (double ? 2 : 1);
}

// Auszeichnungen am Spielende. Jede nur, wenn sie etwas aussagt; Gleichstand = mehrere Gewinner.
const AWARD_MIN = Object.freeze({ streak: 2, jump: 1, perfectQuestions: 2 });

function computeAwards(players, playedCount) {
  const list = [...players];
  const best = (key, valueOf, better, min) => {
    let top = null;
    for (const p of list) {
      const v = valueOf(p);
      if (v == null || (min != null && v < min)) continue;
      if (top === null || better(v, top)) top = v;
    }
    if (top === null) return null;
    const winners = list.filter((p) => valueOf(p) === top).map((p) => ({ id: p.id, nickname: p.nickname }));
    return { key, value: top, winners };
  };
  const awards = [
    best('fastest', (p) => (p.fastestMs == null ? null : p.fastestMs), (a, b) => a < b, null),
    best('streak', (p) => p.bestStreak || 0, (a, b) => a > b, AWARD_MIN.streak),
    best('jump', (p) => p.bestJump || 0, (a, b) => a > b, AWARD_MIN.jump),
  ];
  if (playedCount >= AWARD_MIN.perfectQuestions) {
    const perfect = list.filter((p) => p.correctCount === playedCount).map((p) => ({ id: p.id, nickname: p.nickname }));
    if (perfect.length) awards.push({ key: 'perfect', value: playedCount, winners: perfect });
  }
  return awards.filter(Boolean).map((a) => ({
    ...a,
    winners: a.winners.sort((x, y) => x.nickname.localeCompare(y.nickname, 'de')),
  }));
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
      bestStreak: 0,
      bestJump: 0,
      fastestMs: null, // schnellste richtige Antwort
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
    for (const p of this.players.values()) {
      if (safeEqual(p.token, token)) return p;
    }
    return null;
  }

  checkHostToken(token) {
    return safeEqual(this.hostToken, token);
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
    const double = Boolean(q.double);
    const before = new Map(rankPlayers(this.players.values()).map((r, i) => [r.id, { rank: r.rank, pos: i }]));
    for (const p of this.players.values()) {
      const a = this.round.answers.get(p.id);
      const correct = Boolean(a) && q.correct.includes(a.choice);
      p.streak = correct ? p.streak + 1 : 0;
      p.bestStreak = Math.max(p.bestStreak || 0, p.streak);
      const points = scoreAnswer({ correct, elapsedMs: a ? a.elapsedMs : 0, limitMs: this.round.limitMs, streak: p.streak, double });
      if (correct) {
        p.correctCount += 1;
        if (p.fastestMs == null || a.elapsedMs < p.fastestMs) p.fastestMs = a.elapsedMs;
      }
      p.score += points;
      p.answers[this.qIndex] = a ? { choice: a.choice, elapsedMs: a.elapsedMs, correct, points } : null;
      const b = before.get(p.id);
      p.last = { answered: Boolean(a), choice: a ? a.choice : null, correct, points, double, streak: p.streak, rankBefore: b.rank, posBefore: b.pos };
    }
    // Rangbewegung erst ab der zweiten Frage: vor der ersten stehen alle gleichauf.
    for (const r of rankPlayers(this.players.values())) {
      const p = this.players.get(r.id);
      p.last.rankAfter = r.rank;
      p.last.move = this.qIndex > 0 ? p.last.rankBefore - r.rank : 0;
      p.bestJump = Math.max(p.bestJump || 0, p.last.move);
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
      view.question = { type: q.type, text: q.text, options: q.options, timeLimit: q.timeLimit, double: Boolean(q.double) };
      if (this.state === 'reveal' || this.state === 'leaderboard') view.question.correct = q.correct;
    }
    if (this.state === 'reveal') view.counts = this.answerCounts();
    if (this.state === 'leaderboard') {
      view.leaderboard = ranking.slice(0, 5).map((r) => {
        const p = this.players.get(r.id);
        const last = p.last || {};
        return {
          ...r,
          delta: last.points || 0,
          streak: p.streak,
          move: last.move || 0,
          // Position in der vorigen Rangliste (für die Umsortier-Animation)
          posBefore: this.qIndex > 0 && Number.isInteger(last.posBefore) ? last.posBefore : null,
        };
      });
    }
    if (this.state === 'podium') {
      view.podium = ranking.filter((r) => r.rank <= 3);
      view.awards = this.awards();
      view.report = this.report();
    }
    return view;
  }

  // ranking optional übergeben: beim Senden an alle Spieler nur einmal sortieren.
  playerView(playerId, now, ranking = this.ranking()) {
    const p = this.players.get(playerId);
    if (!p) return null;
    const q = this.question;
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
      view.question = { type: q.type, text: q.text, options: q.options, timeLimit: q.timeLimit, double: Boolean(q.double) };
      if (this.state === 'reveal' || this.state === 'leaderboard') view.question.correct = q.correct;
    }
    if (this.state === 'question') {
      const mine = this.round.answers.get(playerId);
      view.answered = Boolean(mine);
      if (mine) view.choice = mine.choice; // eigene Wahl (nach Neuladen weiter sichtbar)
      // Wartefortschritt für alle, die schon geantwortet haben
      view.progress = { answered: this.round.answers.size, active: this.connectedPlayers().length };
    }
    if ((this.state === 'reveal' || this.state === 'leaderboard') && p.last) {
      view.result = { ...p.last, rankNow: me.rank };
    }
    if (idx > 0) {
      const above = ranking[idx - 1];
      if (above.score > p.score) view.behind = { nickname: above.nickname, gap: above.score - p.score };
    }
    if (this.state === 'podium') {
      view.podium = ranking.filter((r) => r.rank <= 3);
      // Nur die eigenen Auszeichnungen, ohne Namen anderer
      view.awards = this.awards()
        .filter((a) => a.winners.some((w) => w.id === playerId))
        .map((a) => ({ key: a.key, value: a.value, shared: a.winners.length - 1 }));
    }
    return view;
  }

  playedCount() {
    // Gespielt = geschlossene Fragen. Im Podium ist auch die letzte geschlossen.
    if (this.qIndex < 0) return 0;
    return this.state === 'countdown' || this.state === 'question' ? this.qIndex : this.qIndex + 1;
  }

  awards() {
    return computeAwards(this.players.values(), this.playedCount());
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

// ---------- Sichern und Wiederherstellen (Neuladen der Host-Seite) ----------

Game.prototype.toJSON = function toJSON() {
  return {
    v: 1,
    pin: this.pin,
    quiz: this.quiz,
    hostToken: this.hostToken,
    maxPlayers: this.maxPlayers,
    state: this.state,
    qIndex: this.qIndex,
    players: [...this.players.values()].map((p) => {
      const { connId, ...rest } = p;
      return rest;
    }),
    round: this.round ? { ...this.round, answers: [...this.round.answers] } : null,
    countdownEndsAt: this.countdownEndsAt,
    createdAt: this.createdAt,
    lastActivity: this.lastActivity,
  };
};

Game.fromJSON = function fromJSON(data, now) {
  if (!data || data.v !== 1) throw new GameError('Gespeichertes Spiel ist nicht lesbar.');
  const g = new Game({ pin: data.pin, quiz: data.quiz, now: data.createdAt, maxPlayers: data.maxPlayers });
  g.hostToken = data.hostToken;
  g.state = data.state;
  g.qIndex = data.qIndex;
  g.countdownEndsAt = data.countdownEndsAt;
  g.lastActivity = data.lastActivity;
  // Nach dem Neuladen ist zunächst niemand verbunden; Spieler melden sich mit ihrem Token zurück.
  g.players = new Map(data.players.map((p) => [p.id, { ...p, connected: false, disconnectedAt: now }]));
  g.round = data.round ? { ...data.round, answers: new Map(data.round.answers) } : null;
  return g;
};

return { Game, GameError, scoreAnswer, rankPlayers, computeAwards, randomToken, safeEqual, LATE_GRACE_MS, AWARD_MIN };
});
