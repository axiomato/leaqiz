// Abo-Wege: Angebot, Abschluss, Rückkehr vom Zahlungsanbieter, Benachrichtigungen,
// Kündigen und Widerrufen ohne Anmeldung (§ 312k, § 356a BGB) samt Seiten.
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { ANGEBOT, ersparnisProzent, hasAccess, jahrProMonatCent, tarifOf, withinWithdrawal } from './angebot.js';
import { AboError } from './service.js';
import { RateLimiter } from '../limits.js';

const iso = (d) => (d ? new Date(d).toISOString() : null);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// Seiten, die nur der Server ausliefert (server/seiten/)
export const CONTRACT_PAGES = {
  '/vertraege-kuendigen/': 'kuendigen.html',
  '/vertrag-widerrufen/': 'widerrufen.html',
  '/agb/': 'agb.html',
  '/widerrufsbelehrung/': 'widerrufsbelehrung.html',
};

// Angebot für Oberfläche und Preisseite: Tarife plus abgeleitete Werte (Jahrespass je Monat, Ersparnis)
const angebotView = () => ({ ...ANGEBOT, jahrProMonatCent, ersparnisProzent });

export function aboView(sub, payments = [], now = new Date()) {
  if (!sub) return null;
  const tarif = tarifOf(sub);
  return {
    number: sub.number,
    plan: tarif.id,
    planName: tarif.name,
    status: sub.status,
    access: hasAccess(sub, now),
    concludedAt: iso(sub.concludedAt),
    startedAt: iso(sub.startedAt),
    currentPeriodEnd: iso(sub.currentPeriodEnd),
    cancelRequestedAt: iso(sub.cancelRequestedAt),
    endsAt: iso(sub.endsAt),
    canWithdraw: sub.status !== 'withdrawn' && withinWithdrawal(sub, now),
    payments: payments.filter((p) => p.subscriptionId === undefined || p.subscriptionId === sub.id).map((p) => ({ kind: p.kind, grossCent: p.grossCent, vatCent: p.vatCent, paidAt: iso(p.paidAt) })),
  };
}

// Formularangaben prüfen; Fehlermeldungen nennen das Feld
function contractContent(body, kind) {
  const b = body && typeof body === 'object' ? body : {};
  const content = { name: str(b.name, 120), email: str(b.email, 200), number: str(b.number, 40) || null };
  if (!content.name) throw new AboError('Bitte gib deinen Namen an.');
  if (!looksLikeEmail(content.email)) throw new AboError('Bitte gib die E-Mail-Adresse an, mit der du den Vertrag abgeschlossen hast.');
  if (kind === 'kuendigung') {
    content.art = b.art === 'ausserordentlich' ? 'ausserordentlich' : 'ordentlich';
    content.grund = content.art === 'ausserordentlich' ? str(b.grund, 2000) || null : null;
    if (content.art === 'ausserordentlich' && !content.grund) throw new AboError('Bitte nenne den Grund für die außerordentliche Kündigung.');
    content.datum = /^\d{4}-\d{2}-\d{2}$/.test(String(b.datum || '')) ? b.datum : null;
  }
  return content;
}

export function registerBillingRoutes(app, { abo, config, requireUser, requireSameOrigin, currentUser }) {
  const forms = new RateLimiter({ limit: 5, windowMs: 10 * 60_000 });
  app.addHook('onClose', async () => forms.stop());

  app.get('/api/abo/angebot', async (request, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return { angebot: angebotView(), required: config.billing.required, provider: abo.provider.name };
  });

  app.get('/api/abo', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const me = await requireUser(request, reply);
    if (!me) return reply;
    const { sub, next, payments, blocked } = await abo.overview(me.id);
    const now = abo.now();
    // kaufbar: je Tarif null (kaufbar) oder der Grund, warum gerade nicht
    return { angebot: angebotView(), required: config.billing.required, email: me.email, abo: aboView(sub, payments, now), next: aboView(next, payments, now), gesperrt: blocked };
  });

  app.post('/api/abo/start', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!requireSameOrigin(request, reply)) return reply;
    const me = await requireUser(request, reply);
    if (!me) return reply;
    try {
      const body = request.body || {};
      return await abo.start(me, { immediateStart: body.sofortBeginnen === true, plan: typeof body.tarif === 'string' ? body.tarif : '' });
    } catch (err) {
      if (err instanceof AboError) return reply.code(err.status).send({ error: err.message });
      request.log.error(err);
      return reply.code(502).send({ error: 'Der Zahlungsdienst antwortet gerade nicht. Bitte später erneut versuchen.' });
    }
  });

  // Rückkehr nach der Zustimmung beim Zahlungsanbieter (Navigation, nicht fetch)
  app.get('/abo/zurueck/', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const me = await currentUser(request);
    if (!me) return reply.redirect('/host/?abo=anmelden');
    // Monatsabo kommt mit subscription_id zurück, der Jahrespass (Bestellung) mit token
    const q = request.query || {};
    const providerId = str(q.subscription_id, 64) || str(q.token, 64);
    try {
      const sub = await abo.confirmReturn(me, providerId);
      // Aktiv auch, wenn ein verlängerter Jahrespass erst später beginnt
      return reply.redirect(sub && (hasAccess(sub, abo.now()) || ['active', 'cancelled'].includes(sub.status)) ? '/host/?abo=aktiv' : '/host/?abo=offen');
    } catch (err) {
      request.log.error(err);
      return reply.redirect('/host/?abo=offen');
    }
  });
  app.get('/abo/abgebrochen/', async (request, reply) => reply.header('Cache-Control', 'no-store').redirect('/host/?abo=abgebrochen'));

  // Benachrichtigungen von PayPal: Echtheit über die Prüf-API, jede genau einmal
  if (abo.provider.name === 'paypal') {
    app.post('/api/abo/paypal', async (request, reply) => {
      const event = request.body;
      if (!event || typeof event !== 'object' || !event.id) return reply.code(400).send({ error: 'Ungültig.' });
      let ok = false;
      try {
        ok = await abo.provider.verifyWebhook(request.headers, event);
      } catch (err) {
        request.log.error(err);
        return reply.code(503).send({ error: 'Prüfung nicht möglich.' });
      }
      if (!ok) return reply.code(400).send({ error: 'Signatur ungültig.' });
      try {
        await abo.applyEvent(abo.provider.toEvent(event));
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Verarbeitung fehlgeschlagen.' });
      }
      return reply.code(200).send({ ok: true });
    });
  }

  // Simulation (nur lokal): Zustimmungsseite ersetzt PayPal
  if (abo.provider.name === 'simulation') {
    app.get('/abo/simulation/', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const approved = abo.provider.approve(str(request.query && request.query.id, 64));
      if (!approved) return reply.code(404).type('text/plain; charset=utf-8').send('Unbekannter Vertrag');
      if (approved.payment) await abo.applyEvent(approved.payment);
      return reply.redirect(approved.returnUrl);
    });
  }

  // Kündigen und Widerrufen: ohne Anmeldung, nur von der eigenen Seite, begrenzt je IP
  for (const [url, kind] of [['/api/vertrag/kuendigen', 'kuendigung'], ['/api/vertrag/widerrufen', 'widerruf']]) {
    app.post(url, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!requireSameOrigin(request, reply)) return reply;
      if (!forms.take(`${kind}:${request.ip}`)) return reply.code(429).send({ error: 'Zu viele Anfragen. Bitte warte einige Minuten.' });
      let content;
      try {
        content = contractContent(request.body, kind);
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
      const { receivedAt } = kind === 'kuendigung' ? await abo.requestCancel(content) : await abo.requestWithdraw(content);
      // Gleiche Antwort mit oder ohne passenden Vertrag: verrät nicht, wer Kundin oder Kunde ist
      return { receivedAt: receivedAt.toISOString(), content };
    });
  }

  for (const [url, file] of Object.entries(CONTRACT_PAGES)) {
    const page = (request, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(createReadStream(path.join(config.pagesDir, file)));
    app.get(url, page);
    app.get(`${url}index.html`, page);
  }
  app.get('/vertrag/vertrag.js', (request, reply) => reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'no-cache').send(createReadStream(path.join(config.pagesDir, 'vertrag.js'))));
}
