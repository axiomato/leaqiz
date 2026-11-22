// PostgreSQL: Migration und Ablage der Spielstände. Läuft nur mit TEST_DATABASE_URL
// (in GitHub Actions immer gesetzt). Die Datenbank wird dabei geleert.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { GameRegistry } from '../src/games/registry.js';
import { PgGameStore } from '../src/games/store.js';
import { QUIZ, quietLog } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

test('PostgreSQL: Migration, Spiel sichern, wiederherstellen, Löschfrist', { skip: !url && 'TEST_DATABASE_URL nicht gesetzt' }, async () => {
  const db = await openDb(url, { max: 2 });
  try {
    await db.pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
    await db.migrate();
    await db.migrate(); // zweimal: nichts passiert

    const store = new PgGameStore(db.db);
    const first = new GameRegistry({ store, log: quietLog, persistMs: 5 });
    const { id, pin, hostToken } = await first.create(QUIZ);

    const { rows } = await db.pool.query('select pin, state, host_token_hash, snapshot from game where id = $1', [id]);
    assert.equal(rows[0].pin, pin);
    assert.equal(rows[0].state, 'lobby');
    assert.equal(rows[0].snapshot.game.hostToken, undefined);
    assert.notEqual(rows[0].host_token_hash, hostToken);

    // Gleiche PIN zweimal aktiv verhindert die Datenbank selbst
    await assert.rejects(store.insert({ id: crypto.randomUUID(), pin, hostTokenHash: 'x', title: 't', state: 'lobby', snapshot: {} }), (err) => err.cause?.code === '23505' || err.code === '23505');

    await first.flush();
    first.dispose();
    const second = new GameRegistry({ store, log: quietLog });
    assert.equal(await second.restoreAll(), 1);
    assert.ok(second.verifyHost(second.byPin(pin), hostToken));

    second.hostCommand(second.get(id), 'end');
    await new Promise((r) => setTimeout(r, 50));
    const ended = await db.pool.query('select ended_at from game where id = $1', [id]);
    assert.ok(ended.rows[0].ended_at);
    assert.equal((await store.loadActive()).length, 0);

    await db.pool.query("update game set ended_at = now() - interval '40 days' where id = $1", [id]);
    assert.equal(await store.deleteEndedBefore(new Date(Date.now() - 30 * 86_400_000)), 1);
    second.dispose();
  } finally {
    await db.close();
  }
});
