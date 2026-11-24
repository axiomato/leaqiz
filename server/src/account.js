// Konto der Lehrkraft: Daten herunterladen (Art. 15 und 20 DSGVO) und Konto löschen (Art. 17).
// Löschen beendet zuerst laufende Spiele der Lehrkraft und entfernt dann das Konto;
// die Datenbank nimmt Sitzungen, Passkeys, Quizze und Spiele mit (ON DELETE CASCADE).
import { asc, desc, eq, sql } from 'drizzle-orm';
import { game, passkey, quiz, session, user, verification } from './db/schema.js';
import { sessionHeaders } from './auth.js';

export const ENDED_ACCOUNT_DELETED = 'Die Spielleitung hat ihr Konto gelöscht. Das Spiel ist beendet.';

const iso = (d) => (d ? new Date(d).toISOString() : null);
const sameEmail = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

export function registerAccountRoutes(app, { db, auth, abo = null, registry, requireUser, requireSameOrigin, log }) {
  // Alles, was zum Konto gespeichert ist, als eine JSON-Datei.
  // Spiele ohne Spielstand (enthält Spielnamen der Schüler:innen; die Ergebnisse gibt es als CSV an der Leinwand).
  app.get('/api/account/export', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const me = await requireUser(request, reply);
    if (!me) return reply;
    const [row] = await db.select().from(user).where(eq(user.id, me.id));
    const passkeys = await db.select({ name: passkey.name, createdAt: passkey.createdAt, deviceType: passkey.deviceType }).from(passkey).where(eq(passkey.userId, me.id)).orderBy(asc(passkey.createdAt));
    const sessions = await db.select({ createdAt: session.createdAt, expiresAt: session.expiresAt }).from(session).where(eq(session.userId, me.id)).orderBy(asc(session.createdAt));
    const quizzes = await db.select().from(quiz).where(eq(quiz.ownerId, me.id)).orderBy(desc(quiz.updatedAt));
    const games = await db
      .select({ title: game.title, state: game.state, createdAt: game.createdAt, endedAt: game.endedAt })
      .from(game)
      .where(eq(game.ownerId, me.id))
      .orderBy(desc(game.createdAt));
    const billing = abo ? await abo.exportFor(me.id) : { subs: [], payments: [] };
    const exportedAt = new Date();
    const data = {
      format: 'leaqizz-konto-export',
      version: 1,
      exportedAt: exportedAt.toISOString(),
      account: { email: row.email, emailVerified: row.emailVerified, createdAt: iso(row.createdAt) },
      passkeys: passkeys.map((p) => ({ name: p.name, deviceType: p.deviceType, createdAt: iso(p.createdAt) })),
      sessions: sessions.map((s) => ({ createdAt: iso(s.createdAt), expiresAt: iso(s.expiresAt) })),
      quizzes: quizzes.map((q) => ({ title: q.title, questions: q.questions, createdAt: iso(q.createdAt), updatedAt: iso(q.updatedAt) })),
      games: games.map((g) => ({ title: g.title, state: g.state, createdAt: iso(g.createdAt), endedAt: iso(g.endedAt) })),
      subscriptions: billing.subs.map((s) => ({
        number: s.number,
        plan: s.plan,
        status: s.status,
        concludedAt: iso(s.concludedAt),
        startedAt: iso(s.startedAt),
        currentPeriodEnd: iso(s.currentPeriodEnd),
        cancelRequestedAt: iso(s.cancelRequestedAt),
        endsAt: iso(s.endsAt),
        payments: billing.payments.filter((p) => p.subscriptionId === s.id).map((p) => ({ kind: p.kind, grossCent: p.grossCent, vatCent: p.vatCent, paidAt: iso(p.paidAt) })),
      })),
    };
    reply.header('Content-Disposition', `attachment; filename="leaqizz-daten-${exportedAt.toISOString().slice(0, 10)}.json"`);
    reply.type('application/json; charset=utf-8');
    return JSON.stringify(data, null, 2);
  });

  // Konto endgültig löschen. Zur Bestätigung muss die eigene E-Mail-Adresse mitkommen.
  app.post('/api/account/delete', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!requireSameOrigin(request, reply)) return reply;
    const me = await requireUser(request, reply);
    if (!me) return reply;
    const confirm = request.body && request.body.email;
    if (!sameEmail(confirm, me.email)) return reply.code(400).send({ error: 'Die E-Mail-Adresse stimmt nicht mit deinem Konto überein.' });

    // 1. Laufende Spiele beenden: Leinwand und Handys erfahren es, der Endstand wird noch gesichert
    const ended = await registry.endForOwner(me.id, ENDED_ACCOUNT_DELETED);
    // 2. Abo beenden: keine weiteren Abbuchungen. Vertrag und Zahlungen bleiben (Aufbewahrung 8 Jahre).
    if (abo) {
      try {
        await abo.onAccountDeleted(me.id);
      } catch (err) {
        log.error(`Abo beim Löschen nicht beendet: ${err.message}`);
        return reply.code(502).send({ error: 'Dein Abo ließ sich gerade nicht beenden. Bitte später erneut versuchen.' });
      }
    }
    // 3. Abmelden über Better Auth, damit der Browser seine Cookies verliert
    let cookies = [];
    try {
      const res = await auth.api.signOut({ headers: sessionHeaders(request), asResponse: true });
      cookies = res.headers.getSetCookie();
    } catch (err) {
      log.warn(`Abmelden vor dem Löschen fehlgeschlagen: ${err.message}`);
    }
    // 4. Konto löschen (nimmt Sitzungen, Passkeys, Quizze und Spiele mit) und offene Anmeldelinks
    await db.transaction(async (tx) => {
      const needle = JSON.stringify({ email: me.email }).slice(1, -1);
      await tx.delete(verification).where(sql`strpos(${verification.value}, ${needle}) > 0`);
      await tx.delete(user).where(eq(user.id, me.id));
    });
    log.info(`Konto gelöscht (${ended} laufende Spiele beendet)`);
    if (cookies.length) reply.header('set-cookie', cookies);
    return { ok: true };
  });
}
