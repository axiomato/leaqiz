// Jahrespass (D-60): zwölf Monate, Erinnerung vor dem Ende, Verlängern schließt nahtlos an.
// Gegen echte PostgreSQL-Datenbank (TEST_DATABASE_URL), Zahlungsweg „simulation“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { payment } from '../src/db/schema.js';
import { addMonths } from '../src/billing/angebot.js';
import { setupWithAuth } from './db-helpers.js';
import { DAY, datum, form, getAbo, liveGame, rowOf, skip, startAbo, subscribe } from './abo-helpers.js';

test('Jahrespass: einmal bezahlt, zwölf Monate, Erinnerung, Verlängern schließt an', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    const cookie = await s.login('j@example.org');
    const number = await subscribe(s, cookie, 'jahr');
    const data = await getAbo(s, cookie);
    const { abo } = data;
    assert.equal(abo.plan, 'jahr');
    assert.equal(abo.access, true);
    assert.equal(new Date(abo.endsAt).getTime(), addMonths(new Date(abo.startedAt), 12).getTime());
    assert.deepEqual(abo.payments.map((p) => [p.kind, p.grossCent, p.vatCent]), [['payment', 4788, 764]]);
    assert.match(data.gesperrt.monat, /Du hast Zugang bis/);
    assert.match(data.gesperrt.jahr, /Verlängern kannst du ab/);
    const mail = s.outbox.find((m) => m.subject.includes(number));
    assert.match(mail.subject, /Jahrespass/);
    assert.ok(mail.text.includes('47,88 € einmalig') && mail.text.includes('verlängert sich nicht automatisch'));
    assert.equal((await liveGame(s, cookie)).status, 201);
    assert.equal((await startAbo(s, cookie, 'jahr')).status, 409);

    // Rückkehr und Benachrichtigung gleichzeitig: eine Zahlung, eine Bestätigung
    const row = await rowOf(s, number);
    await Promise.all([s.abo.sync(row.providerId), s.abo.applyEvent({ id: 'EV-O', kind: 'order', providerId: row.providerId })]);
    assert.equal((await s.db.db.select().from(payment).where(eq(payment.subscriptionId, row.id))).length, 1);
    assert.equal(s.outbox.filter((m) => m.subject.includes(number)).length, 1);
    assert.equal(s.provider.orders.get(row.providerId).captures, 1);

    // 20 Tage vor dem Ende: Erinnerung genau einmal
    const end = new Date(abo.endsAt);
    s.clock.now = new Date(end.getTime() - 20 * DAY);
    assert.equal(await s.abo.remindExpiring(), 0, 'noch nicht in den letzten 14 Tagen');
    s.clock.now = new Date(end.getTime() - 13 * DAY);
    assert.equal(await s.abo.remindExpiring(), 1);
    assert.equal(await s.abo.remindExpiring(), 0);
    const reminder = s.outbox.at(-1);
    assert.equal(reminder.to, 'j@example.org');
    assert.equal(reminder.subject, `Dein leaqizz Jahrespass endet am ${datum(end)}`);
    assert.ok(reminder.text.includes('/host/?abo=start&tarif=jahr'));

    // Verlängern: neuer Pass beginnt am Ende des alten
    assert.equal((await getAbo(s, cookie)).gesperrt.jahr, null);
    const renewal = await subscribe(s, cookie, 'jahr');
    const after = await getAbo(s, cookie);
    assert.equal(after.abo.number, number);
    assert.equal(after.next.number, renewal);
    assert.equal(after.next.startedAt, abo.endsAt);
    assert.equal(after.next.access, false);
    assert.equal(after.next.canWithdraw, true);
    assert.match(after.gesperrt.jahr, /Verlängern kannst du ab/);

    // Nach dem Ende des alten: Zugang über den neuen
    s.clock.now = new Date(end.getTime() + DAY);
    const later = await getAbo(s, cookie);
    assert.equal(later.abo.number, renewal);
    assert.equal(later.abo.access, true);
    assert.equal((await liveGame(s, cookie)).status, 201);
  } finally {
    await s.stop();
  }
});

test('Jahrespass: keine Erinnerung, wenn der Anschluss schon gekauft ist', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    const cookie = await s.login('k@example.org');
    const number = await subscribe(s, cookie, 'jahr');
    const end = new Date((await rowOf(s, number)).endsAt);
    s.clock.now = new Date(end.getTime() - 25 * DAY);
    await subscribe(s, cookie, 'jahr');
    s.clock.now = new Date(end.getTime() - 10 * DAY);
    const before = s.outbox.length;
    assert.equal(await s.abo.remindExpiring(), 0);
    assert.equal(s.outbox.length, before);
  } finally {
    await s.stop();
  }
});

test('Widerruf eines verlängerten Passes vor Beginn: alles zurück, der laufende bleibt', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    const cookie = await s.login('v@example.org');
    const first = await subscribe(s, cookie, 'jahr');
    const end = new Date((await rowOf(s, first)).endsAt);
    s.clock.now = new Date(end.getTime() - 20 * DAY);
    const renewal = await subscribe(s, cookie, 'jahr');
    await form(s, 'widerrufen', { name: 'Vera', email: 'v@example.org', number: renewal });
    assert.equal(s.provider.refunds.at(-1).grossCent, 4788);
    assert.equal((await rowOf(s, renewal)).status, 'withdrawn');
    assert.equal((await rowOf(s, first)).status, 'active');
    assert.equal((await liveGame(s, cookie)).status, 201);
  } finally {
    await s.stop();
  }
});
