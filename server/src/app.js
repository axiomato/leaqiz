// HTTP-Teil: liefert public/ aus, ergänzt die Browser-Konfiguration um den Spielserver
// und stellt die API bereit. Der WebSocket-Teil hängt in gateway.js am selben Server.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { AUTH_BASE, sessionHeaders, toWebRequest } from './auth.js';
import { RegistryError } from './games/registry.js';
import { RateLimiter } from './limits.js';
import { registerQuizRoutes } from './quizzes.js';
import { registerAccountRoutes } from './account.js';
import { registerResultRoutes } from './results.js';

// Seiten, die Suchmaschinen finden dürfen, sobald LEAQIZ_INDEXIERBAR=ja (D-46).
// Spielleitung und Verbindungstest bleiben immer gesperrt: dort gibt es nichts zu finden.
export const INDEXABLE = new Set(['/', '/lehrkraefte/', '/datenschutz/', '/impressum/']);

const ROBOTS_META = /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i;

// Protokoll ohne IP-Adressen und ohne Abfrageteil der Adresse: Anfragen werden nur mit Methode,
// Pfad und Status geloggt (Datensparsamkeit, siehe Datenschutzerklärung).
export function withoutAddresses(log) {
  if (!log || typeof log !== 'object') return log;
  return {
    ...log,
    serializers: {
      req: (req) => ({ method: req.method, url: String(req.url || '').split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  };
}

export async function buildApp({ config, registry, db = null, auth = null, log = false, limits = {} }) {
  const app = Fastify({
    logger: withoutAddresses(log),
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

  // Datenschutzerklärung für den Serverbetrieb (server/seiten/), nicht die der GitHub-Pages-Fassung.
  // Als Stream, damit die HTML-Anpassungen oben (Robots, CSP) greifen.
  const privacyFile = path.join(config.pagesDir, 'datenschutz.html');
  const privacy = (request, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(createReadStream(privacyFile));
  app.get('/datenschutz/', privacy);
  app.get('/datenschutz/index.html', privacy);

  // Der Verbindungstest prüft die Direktverbindung (PeerJS, STUN, TURN) und spricht dafür Server Dritter an.
  // Im Serverbetrieb laufen Spiele über den eigenen Server; der Test wäre irreführend.
  app.get('/check/', (request, reply) => reply.redirect('/'));
  app.get('/check/index.html', (request, reply) => reply.redirect('/'));

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

  // Anmeldung (Better Auth): alle Wege unter /api/auth/ weiterreichen
  if (auth) {
    app.route({
      method: ['GET', 'POST'],
      url: `${AUTH_BASE}/*`,
      async handler(request, reply) {
        const response = await auth.handler(toWebRequest(request, config));
        reply.code(response.status);
        reply.header('Cache-Control', 'no-store');
        for (const [key, value] of response.headers) {
          if (key !== 'set-cookie' && key !== 'content-length') reply.header(key, value);
        }
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header('set-cookie', cookies);
        return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
      },
    });
  }

  async function currentUser(request) {
    if (!auth) return null;
    const result = await auth.api.getSession({ headers: sessionHeaders(request) });
    return result ? result.user : null;
  }

  async function requireUser(request, reply) {
    const user = await currentUser(request);
    if (!user) reply.code(401).send({ error: 'Bitte melde dich an.' });
    return user;
  }

  // Schreibende Anfragen nur von der eigenen Seite (Schutz gegen fremde Seiten mit der Sitzung der Lehrkraft)
  function requireSameOrigin(request, reply) {
    if (request.headers.origin === config.origin) return true;
    reply.code(403).send({ error: 'Nicht erlaubt.' });
    return false;
  }

  // Quizze der Lehrkraft (nur mit Anmeldung und Datenbank)
  const quizzes = auth && db ? registerQuizRoutes(app, { db: db.db, requireUser, requireSameOrigin }) : null;
  // Konto: Daten herunterladen, Konto löschen
  if (auth && db) registerAccountRoutes(app, { db: db.db, auth, registry, requireUser, requireSameOrigin, log: app.log });
  // Ergebnisse vergangener Live-Spiele (aus dem gesicherten Endstand)
  if (auth && db) registerResultRoutes(app, { db: db.db, registry, requireUser, requireSameOrigin, retentionDays: config.retentionDays });

  // Neues Live-Spiel: nur für angemeldete Lehrkräfte. Ohne Konto nur lokal (LEAQIZ_SPIELE_OHNE_ANMELDUNG).
  app.post('/api/games', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!requireSameOrigin(request, reply)) return reply;
    const user = await currentUser(request);
    if (!user && !config.anonGames) return reply.code(401).send({ error: 'Bitte melde dich an, um ein Live-Spiel zu starten.' });
    if (!creates.take(user ? `u:${user.id}` : request.ip)) return reply.code(429).send({ error: 'Zu viele neue Spiele in kurzer Zeit. Bitte später erneut versuchen.' });
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    try {
      const quizId = quizzes && user ? await quizzes.ownQuizId(user.id, body.quizId) : null;
      const created = await registry.create(body.quiz, { ownerId: user ? user.id : null, quizId });
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
