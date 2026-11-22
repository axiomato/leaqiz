// Quizze der Lehrkraft (Phase 1, Schritt 3): anlegen, ändern, löschen, aus dem Browser übernehmen.
// Gespeichert im Format des Editors (normalizeDraft); unvollständige Entwürfe sind erlaubt,
// vollständig geprüft wird erst beim Spielstart. Jede Lehrkraft sieht nur ihre eigenen Quizze.
import { and, count, desc, eq } from 'drizzle-orm';
import { quiz } from './db/schema.js';
import { ValidationError, normalizeDraft } from './games/engine.js';

export const MAX_QUIZZES = 500;
export const MAX_IMPORT = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
const isUnique = (err) => err && (err.code === '23505' || (err.cause && err.cause.code === '23505'));

const toClient = (row) => ({
  id: row.id,
  localId: row.localId ?? null,
  title: row.title,
  questions: row.questions,
  updatedAt: new Date(row.updatedAt).getTime(),
});

function localIdOf(raw) {
  const v = raw && raw.localId;
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null;
}

export function registerQuizRoutes(app, { db, requireUser, requireSameOrigin }) {
  async function countFor(userId) {
    const [{ n }] = await db.select({ n: count() }).from(quiz).where(eq(quiz.ownerId, userId));
    return Number(n);
  }

  function draftOr400(raw, reply) {
    try {
      return normalizeDraft(raw);
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400).send({ error: err.message });
        return null;
      }
      throw err;
    }
  }

  app.get('/api/quizzes', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const rows = await db.select().from(quiz).where(eq(quiz.ownerId, user.id)).orderBy(desc(quiz.updatedAt));
    return { quizzes: rows.map(toClient) };
  });

  app.post('/api/quizzes', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!requireSameOrigin(request, reply)) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const draft = draftOr400(request.body, reply);
    if (!draft) return reply;
    if ((await countFor(user.id)) >= MAX_QUIZZES) return reply.code(409).send({ error: `Höchstens ${MAX_QUIZZES} Quizze je Konto. Lösche alte Quizze, um neue anzulegen.` });
    const [row] = await db.insert(quiz).values({ ownerId: user.id, title: draft.title, questions: draft.questions }).returning();
    return reply.code(201).send({ quiz: toClient(row) });
  });

  app.put('/api/quizzes/:id', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!requireSameOrigin(request, reply)) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const { id } = request.params;
    if (!isUuid(id)) return reply.code(404).send({ error: 'Dieses Quiz gibt es nicht.' });
    const draft = draftOr400(request.body, reply);
    if (!draft) return reply;
    const [row] = await db
      .update(quiz)
      .set({ title: draft.title, questions: draft.questions, updatedAt: new Date() })
      .where(and(eq(quiz.id, id), eq(quiz.ownerId, user.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Dieses Quiz gibt es nicht.' });
    return { quiz: toClient(row) };
  });

  app.delete('/api/quizzes/:id', async (request, reply) => {
    if (!requireSameOrigin(request, reply)) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const { id } = request.params;
    if (!isUuid(id)) return reply.code(404).send({ error: 'Dieses Quiz gibt es nicht.' });
    const rows = await db.delete(quiz).where(and(eq(quiz.id, id), eq(quiz.ownerId, user.id))).returning({ id: quiz.id });
    if (!rows.length) return reply.code(404).send({ error: 'Dieses Quiz gibt es nicht.' });
    return reply.code(204).send();
  });

  // Übernahme aus dem Browser-Speicher oder aus Dateien. Mit localId: bereits übernommene werden übersprungen.
  app.post('/api/quizzes/import', { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!requireSameOrigin(request, reply)) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const items = request.body && Array.isArray(request.body.quizzes) ? request.body.quizzes : null;
    if (!items) return reply.code(400).send({ error: 'Keine Quizze zum Übernehmen.' });
    if (items.length > MAX_IMPORT) return reply.code(400).send({ error: `Höchstens ${MAX_IMPORT} Quizze auf einmal.` });
    let room = MAX_QUIZZES - (await countFor(user.id));
    const imported = [];
    const invalid = [];
    let skipped = 0;
    for (const [index, raw] of items.entries()) {
      let draft;
      try {
        draft = normalizeDraft(raw);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        invalid.push({ index, error: err.message });
        continue;
      }
      if (room <= 0) {
        invalid.push({ index, error: `Höchstens ${MAX_QUIZZES} Quizze je Konto.` });
        continue;
      }
      try {
        const [row] = await db.insert(quiz).values({ ownerId: user.id, localId: localIdOf(raw), title: draft.title, questions: draft.questions }).returning();
        imported.push(toClient(row));
        room -= 1;
      } catch (err) {
        if (!isUnique(err)) throw err;
        skipped += 1; // schon übernommen
      }
    }
    return { imported, skipped, invalid };
  });

  // Gehört das Quiz der Lehrkraft? (für die Verknüpfung eines Live-Spiels)
  return {
    async ownQuizId(userId, id) {
      if (!userId || !isUuid(id)) return null;
      const [row] = await db.select({ id: quiz.id }).from(quiz).where(and(eq(quiz.id, id), eq(quiz.ownerId, userId)));
      return row ? row.id : null;
    },
  };
}
