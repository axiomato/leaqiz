// Host-Engine: Der Browser der Spielleitung ist der Spiel-Server.
// Sie verwaltet genau ein Spiel, beantwortet Anfragen der Spieler und steuert die Timer.
// Unabhängig vom Transport: Nachrichten kommen über handle(), Antworten gehen über send().
// Läuft im Browser (window.LeaqizEngine) und in Node (Tests).
(function (root, factory) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const deps = isNode ? [require('./game.js'), require('./validate.js')] : [root.LeaqizGame, root.LeaqizValidate];
  const api = factory(...deps);
  if (isNode) module.exports = api;
  else root.LeaqizEngine = api;
})(typeof self !== 'undefined' ? self : globalThis, function (GameLib, Validate) {
  'use strict';

  const { Game, GameError } = GameLib;
  const { validateQuiz, validateNickname, ValidationError } = Validate;

  const DEFAULTS = Object.freeze({
    countdownMs: 4000, // Lesezeit vor jeder Frage
    maxPlayers: 200,
    lobbyDropMs: 2 * 60_000, // getrennte Spieler verschwinden nach 2 min aus der Lobby
    sweepMs: 30_000,
    closeGraceMs: 200, // Frage schließt kurz nach Ablauf, damit späte Pakete noch zählen
    restoreGraceMs: 15_000, // nach Neuladen der Host-Seite: Spieler erst zurückkommen lassen
  });

  function randomPin() {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return String(100000 + (buf[0] % 900000));
  }

  class HostEngine {
    // send(connId, message), onChange(hostView), onClosed(reason)
    constructor({ game, options = {}, clock, setTimer, clearTimer, send, onChange, onClosed }) {
      this.game = game;
      this.opts = { ...DEFAULTS, ...options };
      this.now = clock || (() => Date.now());
      this.setTimer = setTimer || ((fn, ms) => setTimeout(fn, ms));
      this.clearTimer = clearTimer || ((t) => clearTimeout(t));
      this.send = send;
      this.onChange = onChange || (() => {});
      this.onClosed = onClosed || (() => {});
      this.conns = new Map(); // connId -> { playerId, tokens, refilledAt }
      this.timer = null;
      this.sweeper = null;
      this.closed = false;
      this.restoredAt = null;
      this.startSweep();
      this.schedule();
    }

    static create({ quiz, pin, ...rest }) {
      const valid = validateQuiz(quiz);
      const opts = { ...DEFAULTS, ...(rest.options || {}) };
      const now = (rest.clock || Date.now)();
      const game = new Game({ pin: pin || randomPin(), quiz: valid, now, maxPlayers: opts.maxPlayers });
      return new HostEngine({ ...rest, game });
    }

    static restore(snapshot, rest) {
      const now = (rest.clock || Date.now)();
      const game = Game.fromJSON(snapshot.game, now);
      const engine = new HostEngine({ ...rest, options: { ...(rest.options || {}), ...(snapshot.options || {}) }, game });
      // Nach dem Neuladen sind alle Spieler kurz getrennt. Ohne Schonfrist würde die
      // Frage schließen, sobald der erste zurückgekehrte Spieler schon geantwortet hat.
      engine.restoredAt = now;
      engine.setTimer(() => engine.tick(), engine.opts.restoreGraceMs + 10);
      return engine;
    }

    snapshot() {
      return { v: 1, game: this.game.toJSON(), options: { countdownMs: this.opts.countdownMs } };
    }

    get pin() {
      return this.game.pin;
    }

    // ---------- Verbindungen ----------

    attach(connId) {
      if (this.closed) return;
      this.conns.set(connId, { playerId: null, tokens: 20, refilledAt: this.now() });
    }

    detach(connId) {
      const conn = this.conns.get(connId);
      this.conns.delete(connId);
      if (!conn || !conn.playerId || this.closed) return;
      const player = this.game.players.get(conn.playerId);
      if (!player || player.connId !== connId) return;
      player.connId = null;
      this.game.setConnected(player, false, this.now());
      if (this.game.allAnswered()) this.closeQuestionEarly();
      else this.changed();
    }

    // Eingehende Nachricht eines Spielers: { k: 'req', id, ev, p }
    handle(connId, msg) {
      if (this.closed) return;
      const conn = this.conns.get(connId);
      if (!conn || !msg || typeof msg !== 'object' || msg.k !== 'req' || typeof msg.ev !== 'string') return;
      if (!this.allow(conn)) return; // Flut: still verwerfen
      this.tick();
      const id = Number.isInteger(msg.id) ? msg.id : null;
      const payload = msg.p && typeof msg.p === 'object' ? msg.p : {};
      let result;
      try {
        result = { ok: true, ...(this.dispatch(connId, conn, msg.ev, payload) || {}) };
      } catch (err) {
        if (err instanceof GameError || err instanceof ValidationError) result = { ok: false, error: err.message };
        else {
          if (typeof console !== 'undefined') console.error(err);
          result = { ok: false, error: 'Interner Fehler. Bitte erneut versuchen.' };
        }
      }
      if (id !== null) this.send(connId, { k: 'ack', id, r: result });
      if (this.after) {
        const fn = this.after;
        this.after = null;
        fn();
      }
    }

    // Token-Bucket: 20 Nachrichten Puffer, 10 pro Sekunde
    allow(conn) {
      const now = this.now();
      conn.tokens = Math.min(20, conn.tokens + ((now - conn.refilledAt) / 1000) * 10);
      conn.refilledAt = now;
      if (conn.tokens < 1) return false;
      conn.tokens -= 1;
      return true;
    }

    dispatch(connId, conn, ev, p) {
      const game = this.game;
      switch (ev) {
        case 'player:check':
          if (game.state === 'podium') throw new GameError('Dieses Spiel ist bereits beendet.');
          return { pin: game.pin, title: game.quiz.title };

        case 'player:join': {
          if (conn.playerId) throw new GameError('Du bist schon im Spiel.');
          const player = game.addPlayer(validateNickname(p.nickname), this.now());
          this.bind(connId, conn, player);
          this.after = () => {
            this.emitPlayer(player);
            this.changed(false);
          };
          return { playerId: player.id, token: player.token, pin: game.pin };
        }

        case 'player:resume': {
          const player = game.findPlayerByToken(p.token);
          if (!player) throw new GameError('Dieses Spiel gibt es nicht mehr.');
          this.bind(connId, conn, player);
          this.after = () => {
            this.emitPlayer(player);
            this.changed(false);
          };
          return { playerId: player.id, pin: game.pin };
        }

        case 'player:answer': {
          const player = this.playerOf(conn);
          const all = game.submitAnswer(player.id, p.choice, this.now());
          this.after = () => {
            if (all && this.canCloseEarly()) this.closeQuestionEarly();
            else {
              this.emitPlayer(player);
              this.changed(false);
            }
          };
          return {};
        }

        case 'player:leave': {
          const player = this.playerOf(conn);
          game.removePlayer(player.id);
          conn.playerId = null;
          this.after = () => {
            if (game.allAnswered()) this.closeQuestionEarly();
            else this.changed(false);
          };
          return {};
        }

        default:
          throw new GameError('Unbekannte Anfrage.');
      }
    }

    playerOf(conn) {
      const player = conn.playerId ? this.game.players.get(conn.playerId) : null;
      if (!player) throw new GameError('Du bist in keinem Spiel.');
      return player;
    }

    bind(connId, conn, player) {
      if (player.connId && player.connId !== connId) {
        // Gleicher Spieler in zweitem Fenster: altes Fenster abmelden
        this.send(player.connId, { k: 'closed', reason: 'Du spielst jetzt in einem anderen Fenster weiter.' });
        const old = this.conns.get(player.connId);
        if (old) old.playerId = null;
      }
      conn.playerId = player.id;
      player.connId = connId;
      this.game.setConnected(player, true, this.now());
    }

    // ---------- Aktionen der Spielleitung (lokal, ohne Netzwerk) ----------

    next() {
      this.assertOpen();
      this.tick();
      const changed = this.game.advance(this.now(), this.opts.countdownMs);
      if (changed) {
        this.schedule();
        this.broadcast();
      }
      return changed;
    }

    kick(playerId) {
      this.assertOpen();
      const player = this.game.players.get(playerId);
      if (!player) throw new GameError('Spieler nicht gefunden.');
      this.game.removePlayer(player.id);
      if (player.connId) {
        this.send(player.connId, { k: 'closed', reason: 'Du wurdest von der Spielleitung aus dem Spiel entfernt.' });
        const conn = this.conns.get(player.connId);
        if (conn) conn.playerId = null;
      }
      if (this.game.allAnswered()) this.closeQuestionEarly();
      else this.changed();
    }

    end(reason = 'Die Spielleitung hat das Spiel beendet.') {
      if (this.closed) return;
      this.closed = true;
      this.clearTimer(this.timer);
      this.clearTimer(this.sweeper);
      for (const p of this.game.players.values()) {
        if (p.connId) this.send(p.connId, { k: 'closed', reason });
      }
      this.onClosed(reason);
    }

    assertOpen() {
      if (this.closed) throw new GameError('Das Spiel ist beendet.');
    }

    hostView() {
      return this.game.hostView(this.now());
    }

    // ---------- Zeitsteuerung ----------

    // Überfällige Phasen nachholen (z. B. wenn der Browser Timer im Hintergrund drosselt).
    tick() {
      const g = this.game;
      const now = this.now();
      let changed = false;
      if (g.state === 'countdown' && now >= g.countdownEndsAt) {
        g.openQuestion(now);
        changed = true;
      }
      if (g.state === 'question' && (now >= g.round.closesAt + this.opts.closeGraceMs || (this.canCloseEarly() && g.allAnswered()))) {
        g.closeQuestion(now);
        changed = true;
      }
      if (changed) {
        this.schedule();
        this.broadcast();
      }
      return changed;
    }

    schedule() {
      this.clearTimer(this.timer);
      this.timer = null;
      if (this.closed) return;
      const g = this.game;
      const now = this.now();
      let due = null;
      if (g.state === 'countdown') due = g.countdownEndsAt;
      else if (g.state === 'question') due = g.round.closesAt + this.opts.closeGraceMs;
      if (due !== null) this.timer = this.setTimer(() => this.tick(), Math.max(0, due - now));
    }

    canCloseEarly() {
      return this.restoredAt === null || this.now() - this.restoredAt >= this.opts.restoreGraceMs;
    }

    closeQuestionEarly() {
      if (this.game.state !== 'question' || !this.canCloseEarly()) {
        this.changed(false);
        return;
      }
      this.game.closeQuestion(this.now());
      this.schedule();
      this.broadcast();
    }

    startSweep() {
      const run = () => {
        if (this.closed) return;
        const g = this.game;
        if (g.state === 'lobby') {
          const now = this.now();
          let changed = false;
          for (const p of [...g.players.values()]) {
            if (!p.connected && now - p.disconnectedAt > this.opts.lobbyDropMs) {
              g.removePlayer(p.id);
              changed = true;
            }
          }
          if (changed) this.changed();
        }
        this.tick();
        this.sweeper = this.setTimer(run, this.opts.sweepMs);
      };
      this.sweeper = this.setTimer(run, this.opts.sweepMs);
    }

    // ---------- Senden ----------

    emitPlayer(player, ranking) {
      if (!player.connId || !player.connected) return;
      this.send(player.connId, { k: 'state', d: this.game.playerView(player.id, this.now(), ranking) });
    }

    // Host-Ansicht aktualisieren (und speichern); optional auch alle Spieler
    changed(all = false) {
      if (all) this.broadcast();
      else this.onChange(this.hostView());
    }

    broadcast() {
      const ranking = this.game.ranking();
      for (const p of this.game.players.values()) this.emitPlayer(p, ranking);
      this.onChange(this.hostView());
    }
  }

  return { HostEngine, DEFAULTS, randomPin, GameError, ValidationError };
});
