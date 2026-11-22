// Alle laufenden Spiele dieses Servers. Je Spiel eine HostEngine im Speicher;
// ihr Zustand wird regelmäßig in der Datenbank gesichert und nach einem Neustart wiederhergestellt.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { GameError, HostEngine, ValidationError, isPin, randomPin, validateQuiz } from './engine.js';

export class RegistryError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

function sameHash(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const ENDED_IDLE = 'Das Spiel wurde nach langer Pause beendet.';

export class GameRegistry {
  constructor({ store, log = console, engineOptions = {}, idleMs = 2 * 3600_000, retentionDays = 30, persistMs = 2000, viewMs = 60, hostGraceMs = 15_000, maxGames = 300, now = Date.now }) {
    this.store = store;
    this.log = log;
    this.engineOptions = engineOptions;
    this.idleMs = idleMs;
    this.retentionMs = retentionDays * 86_400_000;
    this.persistMs = persistMs;
    this.viewMs = viewMs;
    this.hostGraceMs = hostGraceMs;
    this.maxGames = maxGames;
    this.now = now;
    this.games = new Map(); // id -> entry
    this.pins = new Map(); // pin -> entry
    this.seq = 0;
    this.sweeper = null;
    this.stopping = false;
  }

  get size() {
    return this.games.size;
  }

  get(id) {
    return this.games.get(id) || null;
  }

  byPin(pin) {
    return isPin(pin) ? this.pins.get(pin) || null : null;
  }

  // ---------- Anlegen und Wiederherstellen ----------

  async create(rawQuiz, { ownerId = null } = {}) {
    let quiz;
    try {
      quiz = validateQuiz(rawQuiz);
    } catch (err) {
      if (err instanceof ValidationError) throw new RegistryError(err.message, 400);
      throw err;
    }
    if (this.games.size >= this.maxGames) throw new RegistryError('Gerade laufen sehr viele Spiele. Bitte in ein paar Minuten erneut versuchen.', 503);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pin = randomPin();
      if (this.pins.has(pin)) continue;
      const id = randomUUID();
      const hostToken = randomBytes(24).toString('base64url');
      const entry = this.#entry(id, hashToken(hostToken));
      entry.engine = HostEngine.create({ quiz, pin, ...this.#hooks(entry) });
      this.#mount(entry);
      try {
        await this.store.insert({ id, ownerId, pin, hostTokenHash: entry.hostTokenHash, title: quiz.title, ...this.#snapshot(entry) });
      } catch (err) {
        this.#unmount(entry);
        entry.engine.end('');
        // PIN in der Datenbank noch belegt (z. B. von einem anderen Server-Prozess): neue würfeln
        if (err && (err.code === '23505' || err.cause?.code === '23505')) continue;
        throw err;
      }
      return { id, pin, hostToken };
    }
    throw new RegistryError('Gerade ist keine Spiel-PIN frei. Bitte erneut versuchen.', 503);
  }

  async restoreAll() {
    const rows = await this.store.loadActive();
    let restored = 0;
    for (const row of rows) {
      const entry = this.#entry(row.id, row.hostTokenHash);
      try {
        entry.engine = HostEngine.restore(row.snapshot, this.#hooks(entry));
      } catch (err) {
        this.log.error(`Spiel ${row.id} ließ sich nicht wiederherstellen: ${err.message}`);
        await this.store.end(row.id, { state: 'broken', snapshot: row.snapshot }).catch(() => {});
        continue;
      }
      if (this.pins.has(entry.engine.pin)) {
        entry.engine.end('');
        await this.store.end(row.id, { state: 'duplicate', snapshot: row.snapshot }).catch(() => {});
        continue;
      }
      this.#mount(entry, { restored: true });
      restored += 1;
    }
    return restored;
  }

  #entry(id, hostTokenHash) {
    return {
      id,
      hostTokenHash,
      engine: null,
      hosts: new Set(),
      players: new Map(), // connId -> Verbindung
      hostSeenAt: this.now(),
      lastState: null,
      persistTimer: null,
      viewTimer: null,
      hostTimer: null,
      saving: Promise.resolve(),
      ended: false,
    };
  }

  #hooks(entry) {
    return {
      options: this.engineOptions,
      // Spiel-Timer halten den Prozess nicht am Leben (das tut der HTTP-Server)
      setTimer: (fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        return t;
      },
      send: (connId, msg) => {
        const conn = entry.players.get(connId);
        if (conn) conn.send(msg);
      },
      onChange: (view) => this.#changed(entry, view),
      onClosed: (reason) => this.#closed(entry, reason),
    };
  }

  #mount(entry, { restored = false } = {}) {
    this.games.set(entry.id, entry);
    this.pins.set(entry.engine.pin, entry);
    entry.lastState = entry.engine.game.state;
    if (restored) this.#hostPresence(entry);
  }

  #unmount(entry) {
    if (this.games.get(entry.id) === entry) this.games.delete(entry.id);
    if (entry.engine && this.pins.get(entry.engine.pin) === entry) this.pins.delete(entry.engine.pin);
  }

  // ---------- Verbindungen ----------

  verifyHost(entry, token) {
    return Boolean(entry && !entry.ended && typeof token === 'string' && token.length <= 64 && sameHash(entry.hostTokenHash, hashToken(token)));
  }

  attachHost(entry, conn) {
    entry.hosts.add(conn);
    entry.hostSeenAt = this.now();
    this.#hostPresence(entry);
    return entry.engine.hostView();
  }

  detachHost(entry, conn) {
    if (this.stopping) return;
    entry.hosts.delete(conn);
    entry.hostSeenAt = this.now();
    this.#hostPresence(entry);
  }

  // Handys zeigen „Spielleitung nicht verbunden“ erst nach kurzer Frist (Neuladen der Leinwand)
  #hostPresence(entry) {
    clearTimeout(entry.hostTimer);
    entry.hostTimer = null;
    const game = entry.engine.game;
    if (entry.hosts.size > 0) {
      if (!game.hostConnected) {
        game.hostConnected = true;
        entry.engine.broadcast();
      }
    } else if (game.hostConnected && !entry.ended) {
      entry.hostTimer = setTimeout(() => {
        entry.hostTimer = null;
        if (entry.ended || entry.hosts.size > 0) return;
        game.hostConnected = false;
        entry.engine.broadcast();
      }, this.hostGraceMs);
      entry.hostTimer.unref?.();
    }
  }

  // Befehle der Leinwand. Ergebnis wie bei Spieler-Anfragen: { ok, error? }
  hostCommand(entry, ev, p = {}) {
    entry.hostSeenAt = this.now();
    if (entry.ended) return { ok: false, error: 'Das Spiel ist beendet.' };
    try {
      if (ev === 'next') entry.engine.next();
      else if (ev === 'kick') {
        if (typeof p.playerId !== 'string') throw new GameError('Spieler nicht gefunden.');
        entry.engine.kick(p.playerId);
      } else if (ev === 'end') entry.engine.end();
      else throw new GameError('Unbekannter Befehl.');
      return { ok: true };
    } catch (err) {
      if (err instanceof GameError || err instanceof ValidationError) return { ok: false, error: err.message };
      this.log.error(err);
      return { ok: false, error: 'Interner Fehler. Bitte erneut versuchen.' };
    }
  }

  attachPlayer(entry, conn) {
    this.seq += 1;
    const connId = `c${this.seq}`;
    entry.players.set(connId, conn);
    entry.engine.attach(connId);
    return connId;
  }

  playerMessage(entry, connId, msg) {
    if (!entry.players.has(connId)) return;
    entry.engine.handle(connId, msg);
  }

  detachPlayer(entry, connId) {
    // Beim Herunterfahren nicht abmelden: sonst schlösse die Frage, weil „alle Verbundenen“ geantwortet haben
    if (this.stopping || !entry.players.delete(connId)) return;
    entry.engine.detach(connId);
  }

  // ---------- Sichern ----------

  // Snapshot ohne Leinwand-Token: das steht nur als Hash in der Datenbank
  #snapshot(entry) {
    const snap = entry.engine.snapshot();
    const { hostToken, ...game } = snap.game;
    return { state: game.state, snapshot: { ...snap, game } };
  }

  #changed(entry, view) {
    if (entry.ended) return;
    const urgent = view.state !== entry.lastState;
    entry.lastState = view.state;
    this.#schedulePersist(entry, urgent);
    if (!entry.viewTimer && entry.hosts.size) {
      entry.viewTimer = setTimeout(() => {
        entry.viewTimer = null;
        if (entry.ended) return;
        const d = entry.engine.hostView();
        for (const host of entry.hosts) host.send({ k: 'view', d });
      }, urgent ? 0 : this.viewMs);
    }
  }

  #schedulePersist(entry, urgent) {
    if (urgent) {
      clearTimeout(entry.persistTimer);
      entry.persistTimer = null;
      this.#persist(entry);
    } else if (!entry.persistTimer) {
      entry.persistTimer = setTimeout(() => {
        entry.persistTimer = null;
        this.#persist(entry);
      }, this.persistMs);
    }
  }

  #persist(entry, final = false) {
    const data = this.#snapshot(entry);
    // Nacheinander schreiben, damit ein älterer Stand nie einen neueren überholt
    entry.saving = entry.saving
      .then(() => (final ? this.store.end(entry.id, data) : this.store.save(entry.id, data)))
      .catch((err) => this.log.error(`Spiel ${entry.id} nicht gesichert: ${err.message}`));
    return entry.saving;
  }

  #closed(entry, reason) {
    if (entry.ended) return;
    entry.ended = true;
    clearTimeout(entry.persistTimer);
    clearTimeout(entry.viewTimer);
    clearTimeout(entry.hostTimer);
    this.#unmount(entry);
    if (!reason) return; // nie veröffentlicht (Anlegen fehlgeschlagen)
    this.#persist(entry, true);
    for (const host of entry.hosts) host.send({ k: 'closed', reason });
    // Abschiedsnachricht zustellen lassen, dann Verbindungen schließen
    const conns = [...entry.hosts, ...entry.players.values()];
    setTimeout(() => conns.forEach((c) => c.close()), 1000).unref?.();
  }

  // ---------- Aufräumen ----------

  async sweep() {
    const now = this.now();
    for (const entry of [...this.games.values()]) {
      const last = Math.max(entry.engine.game.lastActivity || 0, entry.hostSeenAt);
      if (entry.hosts.size === 0 && now - last > this.idleMs) entry.engine.end(ENDED_IDLE);
    }
    const removed = await this.store.deleteEndedBefore(new Date(now - this.retentionMs));
    if (removed) this.log.info?.(`${removed} beendete Spiele nach Löschfrist entfernt.`);
    return removed;
  }

  startSweep(everyMs = 60_000) {
    this.sweeper = setInterval(() => this.sweep().catch((err) => this.log.error(`Aufräumen fehlgeschlagen: ${err.message}`)), everyMs);
    this.sweeper.unref?.();
  }

  // Beim Herunterfahren: Stand aller Spiele sichern. Spiele laufen nach dem Neustart weiter.
  async flush() {
    this.stopping = true;
    clearInterval(this.sweeper);
    const pending = [];
    for (const entry of this.games.values()) {
      clearTimeout(entry.persistTimer);
      entry.persistTimer = null;
      pending.push(this.#persist(entry));
    }
    await Promise.all(pending);
  }

  // Für Tests: alle Timer der Engines stoppen, ohne Spiele zu beenden
  dispose() {
    clearInterval(this.sweeper);
    for (const entry of this.games.values()) {
      entry.ended = true;
      clearTimeout(entry.persistTimer);
      clearTimeout(entry.viewTimer);
      clearTimeout(entry.hostTimer);
      const e = entry.engine;
      e.closed = true;
      e.clearTimer(e.timer);
      e.clearTimer(e.sweeper);
      e.clearTimer(e.progressTimer);
    }
    this.games.clear();
    this.pins.clear();
  }

  stats() {
    let players = 0;
    for (const entry of this.games.values()) players += entry.players.size;
    return { games: this.games.size, connections: players };
  }
}
