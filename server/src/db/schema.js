// Datenbankschema (Drizzle). Änderungen: hier anpassen, dann `npm run db:generate`
// und die neue Datei unter drizzle/ mit einchecken. Der Server wendet Migrationen beim Start an.
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

// ---------- Abo (D-57, D-58) ----------
// Verträge und Zahlungen bleiben erhalten, wenn das Konto gelöscht wird (user_id wird leer):
// Buchungsbelege sind 8 Jahre aufzubewahren (§ 147 AO). Die E-Mail-Adresse bleibt, damit
// Kündigung und Widerruf ohne Anmeldung zugeordnet werden können.
export const subscription = pgTable(
  'subscription',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Vertragsnummer für Kundinnen und Kunden, z. B. LQ-7K2M-9XQP
    number: text('number').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    provider: text('provider').notNull(),
    providerId: text('provider_id'),
    // Tarif (src/billing/angebot.js): monat = Monatsabo, jahr = Jahrespass
    plan: text('plan').notNull().default('monat'),
    // pending, active, cancelled, suspended, expired, withdrawn
    status: text('status').notNull(),
    // Zustimmung zum sofortigen Beginn vor Ablauf der Widerrufsfrist (Wertersatz bei Widerruf)
    immediateStart: boolean('immediate_start').notNull().default(false),
    // Vertragsschluss (bezahlt bzw. beim Zahlungsanbieter aktiv); Widerrufsfrist läuft ab hier
    concludedAt: timestamp('concluded_at', { withTimezone: true }),
    // Beginn des Zugangs; beim verlängerten Jahrespass erst am Ende des vorigen
    startedAt: timestamp('started_at', { withTimezone: true }),
    // Monatsabo: bezahlt bis (nächste Abbuchung)
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    // Zugang endet zu diesem Zeitpunkt (Ende des Jahrespasses, Kündigung, Widerruf, Konto gelöscht)
    endsAt: timestamp('ends_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    // Jahrespass: Erinnerung vor dem Ende verschickt
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('subscription_number').on(t.number),
    uniqueIndex('subscription_provider_id').on(t.provider, t.providerId).where(sql`${t.providerId} is not null`),
    index('subscription_user_id').on(t.userId),
    index('subscription_email').on(sql`lower(${t.email})`),
  ],
);

// Zahlungen und Erstattungen (Beträge in Cent, brutto mit 19 % USt)
export const payment = pgTable(
  'payment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscription.id),
    // payment, refund, reversal
    kind: text('kind').notNull(),
    providerPaymentId: text('provider_payment_id').notNull(),
    grossCent: integer('gross_cent').notNull(),
    vatCent: integer('vat_cent').notNull(),
    currency: text('currency').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_provider').on(t.kind, t.providerPaymentId), index('payment_subscription').on(t.subscriptionId)],
);

// Eingang von Kündigung und Widerruf, mit Inhalt, Datum und Uhrzeit (Nachweis, § 312k, § 356a BGB)
export const contractEvent = pgTable(
  'contract_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // kuendigung, widerruf
    kind: text('kind').notNull(),
    subscriptionId: uuid('subscription_id').references(() => subscription.id),
    // Angaben aus dem Formular, wie abgeschickt
    content: jsonb('content').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    // Ergebnis der Zuordnung, z. B. „endet am …“ oder „kein Vertrag gefunden“
    result: text('result').notNull(),
  },
  (t) => [index('contract_event_subscription').on(t.subscriptionId)],
);

// Bereits verarbeitete Benachrichtigungen des Zahlungsanbieters (jede nur einmal)
export const providerEvent = pgTable('provider_event', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});
