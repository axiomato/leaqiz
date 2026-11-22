// Server mit echter PostgreSQL-Datenbank und Anmeldung für Tests (TEST_DATABASE_URL).
// Achtung: leert die Datenbank.
import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { openDb } from '../src/db/index.js';
import { GameRegistry } from '../src/games/registry.js';
import { PgGameStore } from '../src/games/store.js';
import { ORIGIN, quietLog, testConfig } from './helpers.js';

export const dbUrl = process.env.TEST_DATABASE_URL;
export const json = { 'Content-Type': 'application/json', Origin: ORIGIN };

export async function setupWithAuth() {
  const db = await openDb(dbUrl, { max: 4 });
  await db.pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await db.migrate();
  const config = testConfig({ anonGames: false, authSecret: 'test-geheimnis-'.repeat(4) });
  const outbox = [];
  const mailer = { local: true, send: async (m) => outbox.push(m) };
  const auth = createAuth({ config, db: db.db, mailer });
  const registry = new GameRegistry({ store: new PgGameStore(db.db), log: quietLog });
  const app = await buildApp({ config, registry, db, auth });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${app.server.address().port}`;

  // Anmelden über den Anmeldelink, liefert den Cookie-Kopf
  async function login(email) {
    const before = outbox.length;
    const res = await fetch(`${base}/api/auth/sign-in/magic-link`, { method: 'POST', headers: json, body: JSON.stringify({ email, callbackURL: '/host/' }) });
    if (res.status !== 200 || outbox.length !== before + 1) throw new Error(`Anmeldelink nicht verschickt (${res.status})`);
    const link = new URL(outbox.at(-1).text.match(/https?:\/\/\S+/)[0]);
    const verify = await fetch(`${base}${link.pathname}${link.search}`, { redirect: 'manual' });
    return verify.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  }

  return {
    db,
    outbox,
    base,
    registry,
    login,
    async stop() {
      registry.dispose();
      await app.close();
      await db.close();
    },
  };
}
