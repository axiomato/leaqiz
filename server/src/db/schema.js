// Datenbankschema (Drizzle). Änderungen: hier anpassen, dann `npm run db:generate`
// und die neue Datei unter drizzle/ mit einchecken. Der Server wendet Migrationen beim Start an.
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

// Ein Live-Spiel. `snapshot` ist der Zustand der HostEngine (Quiz-Kopie, Spielnamen, Antworten),
// damit Spiele einen Neustart des Servers überstehen. Das Token der Leinwand steht nur als Hash hier.
export const game = pgTable(
  'game',
  {
    id: uuid('id').primaryKey().defaultRandom(),
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
  ],
);
