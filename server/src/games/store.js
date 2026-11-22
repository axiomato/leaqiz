// Ablage der Spielstände. PgGameStore für den Betrieb, MemoryGameStore für Tests ohne Datenbank.
// Beide haben dieselbe Oberfläche.
import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { game } from '../db/schema.js';

export class PgGameStore {
  constructor(db) {
    this.db = db;
  }

  async insert({ id, pin, hostTokenHash, title, state, snapshot }) {
    await this.db.insert(game).values({ id, pin, hostTokenHash, title, state, snapshot });
  }

  async save(id, { state, snapshot }) {
    await this.db.update(game).set({ state, snapshot, updatedAt: new Date() }).where(eq(game.id, id));
  }

  async end(id, { state, snapshot }) {
    const now = new Date();
    await this.db.update(game).set({ state, snapshot, updatedAt: now, endedAt: now }).where(and(eq(game.id, id), isNull(game.endedAt)));
  }

  // Laufende Spiele für die Wiederherstellung nach einem Neustart
  async loadActive() {
    return this.db
      .select({ id: game.id, pin: game.pin, hostTokenHash: game.hostTokenHash, snapshot: game.snapshot })
      .from(game)
      .where(isNull(game.endedAt));
  }

  // Löschfrist: beendete Spiele samt Spielnamen und Antworten entfernen
  async deleteEndedBefore(date) {
    const rows = await this.db.delete(game).where(and(isNotNull(game.endedAt), lt(game.endedAt, date))).returning({ id: game.id });
    return rows.length;
  }
}

export class MemoryGameStore {
  constructor() {
    this.rows = new Map();
  }

  async insert(row) {
    for (const r of this.rows.values()) {
      if (r.pin === row.pin && !r.endedAt) throw new Error('PIN belegt');
    }
    this.rows.set(row.id, { ...structuredClone(row), endedAt: null, updatedAt: new Date() });
  }

  async save(id, { state, snapshot }) {
    const r = this.rows.get(id);
    if (r) Object.assign(r, { state, snapshot: structuredClone(snapshot), updatedAt: new Date() });
  }

  async end(id, { state, snapshot }) {
    const r = this.rows.get(id);
    if (r && !r.endedAt) Object.assign(r, { state, snapshot: structuredClone(snapshot), updatedAt: new Date(), endedAt: new Date() });
  }

  async loadActive() {
    return [...this.rows.values()].filter((r) => !r.endedAt).map((r) => structuredClone({ id: r.id, pin: r.pin, hostTokenHash: r.hostTokenHash, snapshot: r.snapshot }));
  }

  async deleteEndedBefore(date) {
    let n = 0;
    for (const [id, r] of this.rows) {
      if (r.endedAt && r.endedAt < date) {
        this.rows.delete(id);
        n += 1;
      }
    }
    return n;
  }
}
