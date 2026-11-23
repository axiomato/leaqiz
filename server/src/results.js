// Ergebnisse vergangener Live-Spiele (Phase 1, Schritt 5).
// Gelesen aus dem gesicherten Endstand des Spiels (Spalte snapshot): keine zweite Kopie der
// Spielnamen und Antworten. Es gilt dieselbe Löschfrist wie für das Spiel (LEAQIZ_LOESCHFRIST_TAGE);
// danach sind auch die Ergebnisse weg. Jede Lehrkraft sieht nur ihre eigenen Spiele.
import { and, desc, eq, isNotNull, notInArray, or, sql } from 'drizzle-orm';
import { game } from './db/schema.js';
import { Game } from './games/engine.js';
import { isUuid } from './quizzes.js';

export const MAX_RESULTS = 200;
export const ENDED_FOR_DELETE = 'Die Spielleitung hat das Spiel beendet.';
const NOT_FOUND = 'Dieses Ergebnis gibt es nicht (mehr).';
// Bei der Wiederherstellung aussortierte Spiele (nicht lesbar oder doppelte PIN)
const DISCARDED = ['broken', 'duplicate'];

const iso = (d) => (d ? new Date(d).toISOString() : null);
const qIndex = sql`(${game.snapshot}->'game'->>'qIndex')::int`;
const playerCount = sql`jsonb_array_length(${game.snapshot}->'game'->'players')`;
const questionCount = sql`jsonb_array_length(${game.snapshot}->'game'->'quiz'->'questions')`;

// Gespielt = geschlossene Fragen (wie Game#playedCount)
function playedOf(state, index) {
  if (!Number.isInteger(index) || index < 0) return 0;
  return state === 'countdown' || state === 'question' ? index : index + 1;
}

// Ergebnis vorhanden: Spiel beendet oder am Podium, mindestens eine Frage geschlossen, mindestens ein Mitspieler
function hasResult(ownerId) {
  return and(
    eq(game.ownerId, ownerId),
    or(isNotNull(game.endedAt), eq(game.state, 'podium')),
    notInArray(game.state, DISCARDED),
    sql`${qIndex} >= (case when ${game.state} in ('countdown', 'question') then 1 else 0 end)`,
    sql`${playerCount} > 0`,
  );
}

function deleteAtOf(endedAt, retentionDays) {
  return endedAt ? new Date(new Date(endedAt).getTime() + retentionDays * 86_400_000).toISOString() : null;
}

// Auswertung aus dem Spielstand: Rangliste mit Antworten je Frage, Verteilung je Frage, Auszeichnungen.
// Ohne Kennungen und Tokens der Mitspielenden.
export function resultOf(row, retentionDays) {
  const g = Game.fromJSON(row.snapshot.game, Date.now());
  const played = g.playedCount();
  const questions = g.quiz.questions.slice(0, played).map((q) => ({
    type: q.type,
    text: q.text,
    options: q.options,
    correct: q.correct,
    double: Boolean(q.double),
    timeLimit: q.timeLimit,
  }));
  const players = g.ranking().map((r) => {
    const p = g.players.get(r.id);
    return {
      rank: r.rank,
      nickname: p.nickname,
      avatar: p.avatar || null,
      score: p.score,
      correctCount: p.correctCount,
      answers: questions.map((_, i) => {
        const a = p.answers[i];
        return a ? { choice: a.choice, correct: a.correct, elapsedMs: a.elapsedMs, points: a.points } : null;
      }),
    };
  });
  const stats = questions.map((q, i) => {
    const counts = q.options.map(() => 0);
    let answered = 0;
    let correct = 0;
    let totalMs = 0;
    for (const p of players) {
      const a = p.answers[i];
      if (!a) continue;
      answered += 1;
      counts[a.choice] += 1;
      if (a.correct) correct += 1;
      totalMs += a.elapsedMs;
    }
    return { counts, answered, correct, avgMs: answered ? Math.round(totalMs / answered) : null };
  });
  const awards = g.awards().map((a) => ({ key: a.key, value: a.value, winners: a.winners.map((w) => w.nickname) }));
  return {
    id: row.id,
    title: row.title,
    complete: g.state === 'podium',
    running: !row.endedAt,
    createdAt: iso(row.createdAt),
    endedAt: iso(row.endedAt),
    deleteAt: deleteAtOf(row.endedAt, retentionDays),
    questionCount: g.questionCount,
    played,
    questions,
    players,
    stats,
    awards,
  };
}

export function registerResultRoutes(app, { db, registry, requireUser, requireSameOrigin, retentionDays }) {
  app.get('/api/results', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const me = await requireUser(request, reply);
    if (!me) return reply;
    const rows = await db
      .select({
        id: game.id,
        title: game.title,
        state: game.state,
        createdAt: game.createdAt,
        endedAt: game.endedAt,
        qIndex: qIndex.mapWith(Number),
        players: playerCount.mapWith(Number),
        questionCount: questionCount.mapWith(Number),
      })
      .from(game)
      .where(hasResult(me.id))
      .orderBy(desc(sql`coalesce(${game.endedAt}, ${game.updatedAt})`))
      .limit(MAX_RESULTS);
    return {
      retentionDays,
      results: rows.map((r) => ({
        id: r.id,
        title: r.title,
        complete: r.state === 'podium',
        running: !r.endedAt,
        createdAt: iso(r.createdAt),
        endedAt: iso(r.endedAt),
        deleteAt: deleteAtOf(r.endedAt, retentionDays),
        players: r.players,
        played: playedOf(r.state, r.qIndex),
        questionCount: r.questionCount,
      })),
    };
  });

  app.get('/api/results/:id', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const me = await requireUser(request, reply);
    if (!me) return reply;
    const { id } = request.params;
    if (!isUuid(id)) return reply.code(404).send({ error: NOT_FOUND });
    const [row] = await db.select().from(game).where(and(eq(game.id, id), hasResult(me.id)));
    if (!row) return reply.code(404).send({ error: NOT_FOUND });
    try {
      return { result: resultOf(row, retentionDays) };
    } catch (err) {
      request.log.error(`Ergebnis ${id} nicht lesbar: ${err.message}`);
      return reply.code(500).send({ error: 'Dieses Ergebnis ließ sich nicht lesen.' });
    }
  });

  // Ergebnis löschen = Spiel mit Spielnamen und Antworten löschen. Ein noch geöffnetes Spiel (Podium) wird vorher beendet.
  app.delete('/api/results/:id', async (request, reply) => {
    if (!requireSameOrigin(request, reply)) return reply;
    const me = await requireUser(request, reply);
    if (!me) return reply;
    const { id } = request.params;
    if (!isUuid(id)) return reply.code(404).send({ error: NOT_FOUND });
    const [row] = await db.select({ id: game.id }).from(game).where(and(eq(game.id, id), hasResult(me.id)));
    if (!row) return reply.code(404).send({ error: NOT_FOUND });
    await registry.endById(id, ENDED_FOR_DELETE);
    await db.delete(game).where(and(eq(game.id, id), eq(game.ownerId, me.id)));
    return reply.code(204).send();
  });
}
