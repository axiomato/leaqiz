// Start: Konfiguration prüfen, Datenbank migrieren, Spiele wiederherstellen, Server öffnen.
import { buildApp } from './app.js';
import { startCleanup } from './cleanup.js';
import { createAuth } from './auth.js';
import { createMailer } from './mail.js';
import { ConfigError, loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { attachGateway } from './games/gateway.js';
import { GameRegistry } from './games/registry.js';
import { PgGameStore } from './games/store.js';
import { createAboService } from './billing/service.js';
import { createPayPal } from './billing/paypal.js';
import { createSimulation } from './billing/simulation.js';

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
// Abo: Zahlungsweg aus der Konfiguration (PayPal; „simulation“ nur lokal)
const provider = config.billing.provider === 'paypal' ? createPayPal(config.billing.paypal) : config.billing.provider === 'simulation' ? createSimulation() : null;
const abo = provider ? createAboService({ db: db.db, provider, mailer, origin: config.origin, operator: config.billing.operatorMail, log: console }) : null;
const app = await buildApp({ config, registry, db, auth, abo, log: { level: process.env.LOG_LEVEL || 'info' }, limits: config.limits });
const gateway = attachGateway({ server: app.server, registry, config, log: app.log, limits: config.limits });
await app.listen({ port: config.port, host: config.host });
registry.startSweep();
const stopCleanup = startCleanup(db.db, app.log);
// Jahrespass: Erinnerung vor dem Ende (stündlich prüfen, jede Mail nur einmal)
const reminders = abo
  ? setInterval(() => abo.remindExpiring().then((n) => n && app.log.info(`${n} Erinnerungen an endende Jahrespässe verschickt.`)).catch((err) => app.log.error(err)), 60 * 60_000)
  : null;
if (reminders) reminders.unref();
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
    stopCleanup();
    if (reminders) clearInterval(reminders);
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
