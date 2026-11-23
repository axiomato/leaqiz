// Server mit echter PostgreSQL-Datenbank und Anmeldung für Tests (TEST_DATABASE_URL).
// Achtung: leert die Datenbank.
import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { openDb } from '../src/db/index.js';
import { GameRegistry } from '../src/games/registry.js';
import { PgGameStore } from '../src/games/store.js';
import { createAboService } from '../src/billing/service.js';
import { createSimulation } from '../src/billing/simulation.js';
import { ORIGIN, quietLog, testConfig } from './helpers.js';

export const dbUrl = process.env.TEST_DATABASE_URL;
export const json = { 'Content-Type': 'application/json', Origin: ORIGIN };

// billing: { required } schaltet das Abo mit dem Zahlungsweg „simulation“ ein; clock.now steuert die Zeit
export async function setupWithAuth({ billing = null } = {}) {
  const db = await openDb(dbUrl, { max: 4 });
  await db.pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await db.migrate();
  const config = testConfig({
    anonGames: false,
    authSecret: 'test-geheimnis-'.repeat(4),
    billing: billing ? { required: Boolean(billing.required), provider: 'simulation', paypal: null, operatorMail: 'betrieb@example.org' } : undefined,
  });
  const outbox = [];
  const mailer = { local: true, send: async (m) => outbox.push(m) };
  const auth = createAuth({ config, db: db.db, mailer });
  const registry = new GameRegistry({ store: new PgGameStore(db.db), log: quietLog });
  const clock = { now: null };
  const now = () => clock.now || new Date();
  const provider = billing ? createSimulation({ now }) : null;
  const abo = billing ? createAboService({ db: db.db, provider, mailer, origin: ORIGIN, operator: 'betrieb@example.org', log: quietLog, now }) : null;
  const app = await buildApp({ config, registry, db, auth, abo });
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
    abo,
    provider,
    clock,
    async stop() {
      registry.dispose();
      await app.close();
      await db.close();
    },
  };
}
