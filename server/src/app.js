// HTTP-Teil: liefert public/ aus, ergänzt die Browser-Konfiguration um den Spielserver
// und stellt die API bereit. Der WebSocket-Teil hängt in gateway.js am selben Server.
import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { RegistryError } from './games/registry.js';
import { RateLimiter } from './limits.js';

// Seiten, die Suchmaschinen finden dürfen, sobald LEAQIZ_INDEXIERBAR=ja (D-46).
// Spielleitung und Verbindungstest bleiben immer gesperrt: dort gibt es nichts zu finden.
export const INDEXABLE = new Set(['/', '/lehrkraefte/', '/datenschutz/', '/impressum/']);

const ROBOTS_META = /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i;

export async function buildApp({ config, registry, db = null, log = false, limits = {} }) {
  const app = Fastify({
    logger: log,
    trustProxy: config.trustProxy ? 1 : false,
    bodyLimit: 256 * 1024,
  });
  const wsOrigin = config.origin.replace(/^http/, 'ws');
  const creates = new RateLimiter({ limit: limits.gamesPerHour ?? 60, windowMs: 3600_000 });
  app.addHook('onClose', async () => creates.stop());

  // Robots, Sicherheits-Header und HTML-Anpassungen für den Serverbetrieb
  app.addHook('onSend', async (request, reply, payload) => {
    const pathname = request.url.split('?')[0];
    const indexable = config.indexable && INDEXABLE.has(pathname);
    reply.header('X-Robots-Tag', indexable ? 'index, follow' : 'noindex, nofollow');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'no-referrer');

    const type = String(reply.getHeader('content-type') || '');
    if (request.method !== 'GET' || !type.startsWith('text/html') || !payload || typeof payload.pipe !== 'function') return payload;
    const chunks = [];
    for await (const chunk of payload) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    let html = Buffer.concat(chunks).toString('utf8');
    // WebSocket zur eigenen Adresse erlauben (ältere Safari-Versionen zählen ws: nicht zu 'self')
    html = html.replace("connect-src 'self'", `connect-src 'self' ${wsOrigin}`);
    if (indexable) html = html.replace(ROBOTS_META, '<meta name="robots" content="index, follow" />');
    reply.removeHeader('content-length');
    return html;
  });

  // Browser-Konfiguration: Datei aus public/ plus Adresse des Spielservers
  const configFile = path.join(config.publicDir, 'js', 'config.js');
  app.get('/js/config.js', async (request, reply) => {
    const base = await fs.readFile(configFile, 'utf8');
    reply.header('Content-Type', 'text/javascript; charset=utf-8').header('Cache-Control', 'no-cache');
    return `${base}\n// Ergänzt vom Spielserver\nwindow.LEAQIZ_CONFIG.server = { ws: '/ws', api: '/api/' };\n`;
  });

  app.get('/api/health', async (request, reply) => {
    let database = null;
    if (db) {
      try {
        database = await db.ping();
      } catch {
        database = false;
      }
    }
    const ok = database !== false;
    reply.code(ok ? 200 : 503).header('Cache-Control', 'no-store');
    return { ok, database, ...registry.stats() };
  });

  // Neues Live-Spiel. Bis die Anmeldung steht, nur lokal ohne Konto (LEAQIZ_SPIELE_OHNE_ANMELDUNG).
  app.post('/api/games', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!config.anonGames) return reply.code(401).send({ error: 'Bitte melde dich an, um ein Live-Spiel zu starten.' });
    if (request.headers.origin && request.headers.origin !== config.origin) return reply.code(403).send({ error: 'Nicht erlaubt.' });
    if (!creates.take(request.ip)) return reply.code(429).send({ error: 'Zu viele neue Spiele in kurzer Zeit. Bitte später erneut versuchen.' });
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    try {
      const created = await registry.create(body.quiz);
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof RegistryError) return reply.code(err.status).send({ error: err.message });
      request.log.error(err);
      return reply.code(500).send({ error: 'Das Spiel ließ sich nicht anlegen. Bitte erneut versuchen.' });
    }
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden.' });
    return reply.code(404).type('text/plain; charset=utf-8').send('Nicht gefunden');
  });

  await app.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/',
    index: ['index.html'],
    redirect: true,
    cacheControl: false,
    // Entwicklungs-Schnappschüsse nie ausliefern
    allowedPath: (pathname) => !pathname.startsWith('/__snap'),
    setHeaders: (reply) => reply.header('Cache-Control', 'no-cache'),
  });

  return app;
}
