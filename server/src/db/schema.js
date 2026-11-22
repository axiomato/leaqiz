// Datenbankschema (Drizzle). Änderungen: hier anpassen, dann `npm run db:generate`
// und die neue Datei unter drizzle/ mit einchecken. Der Server wendet Migrationen beim Start an.
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth-schema.js';

export * from './auth-schema.js';

// Quiz einer Lehrkraft, im Format des Editors (normalizeDraft), darf unvollständig sein.
// local_id: Kennung aus dem Browser-Speicher, damit eine Übernahme nichts doppelt anlegt.
export const quiz = pgTable(
  'quiz',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    localId: text('local_id'),
    title: text('title').notNull(),
    questions: jsonb('questions').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('quiz_owner_id').on(t.ownerId),
    uniqueIndex('quiz_owner_local_id').on(t.ownerId, t.localId).where(sql`${t.localId} is not null`),
  ],
);

// Ein Live-Spiel. `snapshot` ist der Zustand der HostEngine (Quiz-Kopie, Spielnamen, Antworten),
// damit Spiele einen Neustart des Servers überstehen. Das Token der Leinwand steht nur als Hash hier.
export const game = pgTable(
  'game',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lehrkraft, die das Spiel angelegt hat. Konto gelöscht → ihre Spiele auch.
    // Leer nur bei lokalen Spielen ohne Anmeldung (Entwicklung).
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
    // Quiz, aus dem das Spiel gestartet wurde (das Spiel behält seine eigene Kopie)
    quizId: uuid('quiz_id').references(() => quiz.id, { onDelete: 'set null' }),
    pin: text('pin').notNull(),
    hostTokenHash: text('host_token_hash').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    // Eine PIN gehört immer nur einem laufenden Spiel
    uniqueIndex('game_pin_active').on(t.pin).where(sql`${t.endedAt} is null`),
    index('game_ended_at').on(t.endedAt),
    index('game_owner_id').on(t.ownerId),
  ],
);
