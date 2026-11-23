// Konfiguration nur aus Umgebungsvariablen. Fehlt etwas Nötiges, startet der Server nicht
// und nennt alle Fehler auf einmal. Geheimnisse stehen nie im Code.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC = path.resolve(HERE, '..', '..', 'public');
const DEFAULT_PAGES = path.resolve(HERE, '..', 'seiten');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class ConfigError extends Error {
  constructor(problems) {
    super(`Konfiguration unvollständig:\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

const yes = (v) => ['ja', 'true', '1'].includes(String(v || '').trim().toLowerCase());

function int(env, name, fallback, { min, max }, problems) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} muss eine ganze Zahl zwischen ${min} und ${max} sein.`);
    return fallback;
  }
  return n;
}

export function loadConfig(env = process.env) {
  const problems = [];

  const port = int(env, 'PORT', 3000, { min: 1, max: 65535 }, problems);
  const host = env.HOST || '0.0.0.0';

  const databaseUrl = env.DATABASE_URL || '';
  if (!databaseUrl) problems.push('DATABASE_URL fehlt (z. B. postgres://leaqiz:…@db:5432/leaqiz).');

  // Öffentliche Adresse, z. B. https://leaqizz.com. Prüft die Herkunft von WebSocket-Verbindungen.
  let origin = null;
  try {
    const url = new URL(env.LEAQIZ_ORIGIN || '');
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Protokoll');
    origin = url.origin;
  } catch {
    problems.push('LEAQIZ_ORIGIN fehlt oder ist keine Adresse (z. B. https://leaqizz.com oder http://localhost:3000).');
  }
  const local = origin ? LOCAL_HOSTS.has(new URL(origin).hostname) : false;

  // Bis die Anmeldung für Lehrkräfte steht, darf jede Person Spiele anlegen – nur lokal erlaubt.
  const anonGames = yes(env.LEAQIZ_SPIELE_OHNE_ANMELDUNG);
  if (anonGames && origin && !local) {
    problems.push('LEAQIZ_SPIELE_OHNE_ANMELDUNG=ja ist nur lokal erlaubt (LEAQIZ_ORIGIN auf localhost). Öffentlich erst mit Anmeldung.');
  }

  // Anmeldung der Lehrkräfte (Better Auth): Schlüssel für Sitzungen und Signaturen
  const authSecret = env.BETTER_AUTH_SECRET || '';
  if (authSecret.length < 32) problems.push('BETTER_AUTH_SECRET fehlt oder ist kürzer als 32 Zeichen (z. B. openssl rand -base64 32).');

  // Mailversand für Anmeldelinks per SMTP (Hetzner: Port 587). Ohne SMTP_HOST nur lokal:
  // dann stehen die Links im Server-Log.
  const smtpHost = env.SMTP_HOST || '';
  const smtpPort = int(env, 'SMTP_PORT', 587, { min: 1, max: 65535 }, problems);
  const mailFrom = env.MAIL_FROM || '';
  if (smtpHost) {
    if (!env.SMTP_USER || !env.SMTP_PASS) problems.push('SMTP_USER und SMTP_PASS fehlen (Zugangsdaten des Postfachs).');
    if (!mailFrom) problems.push('MAIL_FROM fehlt (z. B. leaqizz <noreply@leaqizz.com>).');
  } else if (origin && !local) {
    problems.push('SMTP_HOST fehlt: Ohne Mailversand kann sich niemand anmelden.');
  }

  // Suchmaschinen: Standard gesperrt. Erst wenn leaqizz echt online ist, freigeben (D-46).
  const indexable = yes(env.LEAQIZ_INDEXIERBAR);

  // Hinter genau einem Reverse-Proxy (Caddy): Client-IP aus X-Forwarded-For
  const trustProxy = yes(env.LEAQIZ_HINTER_PROXY);

  const config = {
    port,
    host,
    databaseUrl,
    origin,
    local,
    anonGames,
    indexable,
    trustProxy,
    authSecret,
    mail: smtpHost
      ? { host: smtpHost, port: smtpPort, user: env.SMTP_USER, pass: env.SMTP_PASS, from: mailFrom }
      : null,
    publicDir: env.LEAQIZ_PUBLIC_DIR ? path.resolve(env.LEAQIZ_PUBLIC_DIR) : DEFAULT_PUBLIC,
    // Seiten nur für den Serverbetrieb (Datenschutzerklärung)
    pagesDir: DEFAULT_PAGES,
    // Spiele ohne Leinwand und ohne Aktivität werden nach dieser Zeit beendet
    gameIdleMs: int(env, 'LEAQIZ_SPIEL_LEERLAUF_MIN', 120, { min: 5, max: 24 * 60 }, problems) * 60_000,
    // Beendete Spiele (mit Spielnamen und Antworten) werden nach dieser Frist gelöscht
    retentionDays: int(env, 'LEAQIZ_LOESCHFRIST_TAGE', 30, { min: 1, max: 365 }, problems),
    // Grenzen je IP-Adresse. Eine Schule teilt sich oft eine IP: bei großen Schulen erhöhen.
    limits: {
      connectsPerMinute: int(env, 'LEAQIZ_GRENZE_VERBINDUNGEN_MINUTE', 300, { min: 10, max: 100_000 }, problems),
      pinMissesPerMinute: int(env, 'LEAQIZ_GRENZE_FALSCHE_PIN_MINUTE', 30, { min: 3, max: 10_000 }, problems),
      gamesPerHour: int(env, 'LEAQIZ_GRENZE_SPIELE_STUNDE', 60, { min: 1, max: 10_000 }, problems),
    },
  };

  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(config);
}
