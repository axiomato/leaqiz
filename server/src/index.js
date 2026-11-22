// Start: Konfiguration prüfen, Datenbank migrieren, Spiele wiederherstellen, Server öffnen.
import { buildApp } from './app.js';
import { createAuth } from './auth.js';
import { createMailer } from './mail.js';
import { ConfigError, loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { attachGateway } from './games/gateway.js';
import { GameRegistry } from './games/registry.js';
import { PgGameStore } from './games/store.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const db = await openDb(config.databaseUrl);
await db.migrate();

const registry = new GameRegistry({
  store: new PgGameStore(db.db),
  idleMs: config.gameIdleMs,
  retentionDays: config.retentionDays,
});
const restored = await registry.restoreAll();

const mailer = createMailer(config.mail, console);
const auth = createAuth({ config, db: db.db, mailer });
const app = await buildApp({ config, registry, db, auth, log: { level: process.env.LOG_LEVEL || 'info' }, limits: config.limits });
const gateway = attachGateway({ server: app.server, registry, config, log: app.log, limits: config.limits });
await app.listen({ port: config.port, host: config.host });
registry.startSweep();
app.log.info(`leaqizz-Server bereit unter ${config.origin} (${restored} Spiele wiederhergestellt)`);

// Herunterfahren (z. B. bei einem Update): Spielstände sichern, Spiele laufen nach dem Neustart weiter
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal}: sichere Spielstände und fahre herunter`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await registry.flush();
    gateway.close();
    await new Promise((r) => setTimeout(r, 100));
    await app.close();
    await db.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
