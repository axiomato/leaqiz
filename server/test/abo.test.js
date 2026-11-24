// Tarife (D-58, D-60): Monatsabo und Jahrespass. Abschluss, Live-Spiel nur mit Vertrag, Verlängern,
// Erinnerung, Kündigen und Widerrufen ohne Anmeldung, Konto löschen.
// Gegen echte PostgreSQL-Datenbank (TEST_DATABASE_URL), Zahlungsweg „simulation“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { contractEvent, payment } from '../src/db/schema.js';
import { TARIFE, addMonths, cancelEnd, refundOnWithdraw } from '../src/billing/angebot.js';
import { purchaseBlock } from '../src/billing/service.js';
import { json, setupWithAuth } from './db-helpers.js';
import { DAY, datum, form, getAbo, liveGame, rowOf, skip, startAbo, subscribe } from './abo-helpers.js';

test('Angebot: Monate addieren, Kündigungsende, Erstattung beim Widerruf, wann gekauft werden kann', () => {
  assert.equal(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(addMonths(new Date('2026-11-24T17:00:00Z'), 12).toISOString(), '2027-11-24T17:00:00.000Z');
  // Monatsabo: Ende des bezahlten Monats, höchstens ein Monat nach Eingang
  const monat = { plan: 'monat', currentPeriodEnd: new Date('2027-03-10T00:00:00Z') };
  assert.equal(cancelEnd(monat, new Date('2027-02-20T00:00:00Z')).toISOString(), '2027-03-10T00:00:00.000Z');
  // Jahrespass: endet zum vereinbarten Tag, Kündigung ändert nichts
  const pass = { plan: 'jahr', endsAt: new Date('2027-11-24T00:00:00Z') };
  assert.equal(cancelEnd(pass, new Date('2027-02-01T00:00:00Z')).toISOString(), '2027-11-24T00:00:00.000Z');

  const start = new Date('2026-11-24T00:00:00Z');
  assert.equal(refundOnWithdraw({ paidCent: 4788, startedAt: start, periodEnd: addMonths(start, 12), now: new Date(start.getTime() + DAY), immediateStart: true }), 4788 - 13);
  assert.equal(refundOnWithdraw({ paidCent: 499, startedAt: start, periodEnd: addMonths(start, 1), now: new Date(start.getTime() + DAY), immediateStart: true }), 499 - 17);
  assert.equal(refundOnWithdraw({ paidCent: 4788, startedAt: start, periodEnd: null, now: new Date(start.getTime() + DAY), immediateStart: false }), 4788);
  // Verlängerter Pass, noch nicht begonnen: alles zurück
  assert.equal(refundOnWithdraw({ paidCent: 4788, startedAt: new Date(start.getTime() + 10 * DAY), periodEnd: null, now: start, immediateStart: true }), 4788);

  const now = new Date('2027-01-01T00:00:00Z');
  assert.equal(purchaseBlock([], 'monat', now), null);
  const running = { plan: 'monat', status: 'active', startedAt: new Date('2026-12-01T00:00:00Z'), currentPeriodEnd: new Date('2027-01-10T00:00:00Z'), endsAt: null };
  assert.equal(purchaseBlock([running], 'jahr', now), 'Du hast schon ein Monatsabo.');
  const cancelled = { ...running, status: 'cancelled', endsAt: new Date('2027-01-10T00:00:00Z') };
  assert.match(purchaseBlock([cancelled], 'monat', now), /Du hast Zugang bis 10\.01\.2027/);
  assert.equal(purchaseBlock([cancelled], 'jahr', now), null, 'Jahrespass schließt an ein gekündigtes Monatsabo an');
  const yearPass = { plan: 'jahr', status: 'active', startedAt: new Date('2026-06-01T00:00:00Z'), endsAt: new Date('2027-06-01T00:00:00Z') };
  assert.match(purchaseBlock([yearPass], 'jahr', now), /Verlängern kannst du ab 02\.05\.2027/);
  assert.equal(purchaseBlock([yearPass], 'jahr', new Date('2027-05-10T00:00:00Z')), null);
  assert.match(purchaseBlock([{ ...running, status: 'suspended' }], 'jahr', now), /pausiert/);
});

test('Monatsabo: Live-Spiel erst mit Vertrag; Abschluss, Bestätigung, kein zweiter Vertrag', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    const cookie = await s.login('a@example.org');
    const blocked = await liveGame(s, cookie);
    assert.equal(blocked.status, 402);
    assert.equal((await blocked.json()).code, 'abo');

    const empty = await getAbo(s, cookie);
    assert.equal(empty.abo, null);
    assert.deepEqual(empty.gesperrt, { monat: null, jahr: null });
    assert.equal(empty.angebot.tarife.monat.preisCent, 499);
    assert.equal(empty.angebot.ersparnisProzent, 20);
    assert.equal((await startAbo(s, cookie, 'monat', { sofortBeginnen: true })).status, 400, 'ohne Tarif');
    assert.equal((await startAbo(s, cookie, 'monat', { tarif: 'monat' })).status, 400, 'ohne Zustimmung zum sofortigen Beginn');
    const foreign = await fetch(`${s.base}/api/abo/start`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://fremd.example', Cookie: cookie }, body: JSON.stringify({ sofortBeginnen: true, tarif: 'monat' }) });
    assert.equal(foreign.status, 403);

    const number = await subscribe(s, cookie, 'monat');
    const data = await getAbo(s, cookie);
    const { abo } = data;
    assert.equal(abo.number, number);
    assert.equal(abo.plan, 'monat');
    assert.equal(abo.access, true);
    assert.equal(abo.canWithdraw, true);
    assert.deepEqual(abo.payments.map((p) => [p.kind, p.grossCent, p.vatCent]), [['payment', 499, 80]]);
    assert.equal(new Date(abo.currentPeriodEnd).getTime(), addMonths(new Date(abo.startedAt), 1).getTime());
    assert.equal(data.gesperrt.monat, 'Du hast schon ein Monatsabo.');
    assert.equal(data.gesperrt.jahr, 'Du hast schon ein Monatsabo.');
    const mail = s.outbox.find((m) => m.subject.includes(number));
    assert.match(mail.subject, /Monatsabo/);
    assert.ok(mail.text.includes('/vertraege-kuendigen/') && mail.text.includes('4,99 € im Monat'));

    assert.equal((await liveGame(s, cookie)).status, 201);
    assert.equal((await startAbo(s, cookie, 'monat')).status, 409);
    assert.equal((await startAbo(s, cookie, 'jahr')).status, 409);

    // Dieselbe Benachrichtigung zweimal: nur einmal gebucht
    const sub = await rowOf(s, number);
    const ev = { id: 'EV-1', kind: 'payment', providerId: sub.providerId, paymentId: 'P-2', grossCent: 499, currency: 'EUR', at: new Date() };
    assert.equal(await s.abo.applyEvent(ev), true);
    assert.equal(await s.abo.applyEvent(ev), false);
    assert.equal((await s.db.db.select().from(payment).where(eq(payment.subscriptionId, sub.id))).length, 2);
  } finally {
    await s.stop();
  }
});

test('Kündigen ohne Anmeldung: Eingang immer, Mail nur an die Adresse des Vertrags', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    const cookie = await s.login('b@example.org');
    const number = await subscribe(s, cookie, 'monat');

    // Fremde Adresse: gleiche Antwort, keine Mail, Eingang festgehalten, Betreiber informiert
    const before = s.outbox.length;
    const miss = await form(s, 'kuendigen', { name: 'Jemand', email: 'fremd@example.org' });
    assert.equal(miss.status, 200);
    assert.ok((await miss.json()).receivedAt);
    assert.deepEqual(s.outbox.slice(before).map((m) => m.to), ['betrieb@example.org']);

    // Pflichtangaben
    assert.equal((await form(s, 'kuendigen', { email: 'b@example.org' })).status, 400);
    assert.equal((await form(s, 'kuendigen', { name: 'B', email: 'b@example.org', art: 'ausserordentlich' })).status, 400);

    const res = await form(s, 'kuendigen', { name: 'Bea Beispiel', email: 'B@example.org', number: number.toLowerCase() });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).content.art, 'ordentlich');
    const { abo, gesperrt } = await getAbo(s, cookie);
    assert.equal(abo.endsAt, abo.currentPeriodEnd, 'Monatsabo endet zum Ende des bezahlten Monats');
    assert.equal(abo.access, true, 'Zugang bis zum Ende der bezahlten Zeit');
    assert.equal(gesperrt.jahr, null, 'Jahrespass kann anschließen');
    assert.equal(s.provider.cancelled.length, 1);
    const mail = s.outbox.at(-1);
    assert.equal(mail.to, 'b@example.org');
    assert.match(mail.subject, /Eingangsbestätigung: Kündigung/);
    assert.match(mail.text, /Eingegangen am \d{2}\.\d{2}\.\d{4} um \d{2}:\d{2}:\d{2} Uhr/);
    assert.match(mail.text, /Danach buchen wir nichts mehr ab/);
    const events = await s.db.db.select().from(contractEvent);
    assert.deepEqual(events.map((e) => e.result).sort(), [`endet am ${datum(abo.endsAt)}`, 'kein Vertrag gefunden'].sort());

    // Nach dem Ende kein Live-Spiel mehr
    s.clock.now = new Date(new Date(abo.endsAt).getTime() + 1000);
    assert.equal((await liveGame(s, cookie)).status, 402);

    // Jahrespass: Kündigung ändert das Ende nicht, beim Zahlungsanbieter gibt es nichts zu kündigen
    s.clock.now = null;
    const c2 = await s.login('p@example.org');
    const pass = await subscribe(s, c2, 'jahr');
    const end = (await rowOf(s, pass)).endsAt;
    await form(s, 'kuendigen', { name: 'Paul', email: 'p@example.org', number: pass });
    const passRow = await rowOf(s, pass);
    assert.equal(passRow.endsAt.getTime(), end.getTime());
    assert.equal(passRow.status, 'cancelled');
    assert.equal(s.provider.cancelled.length, 1);
    assert.match(s.outbox.at(-1).text, /Der Jahrespass verlängert sich ohnehin nicht automatisch/);
    assert.equal((await liveGame(s, c2)).status, 201);
  } finally {
    await s.stop();
  }
});

test('Widerrufen: in der Frist sofort beendet und anteilig erstattet; danach nur festgehalten', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    // Monatsabo, einen Tag genutzt
    const cookie = await s.login('c@example.org');
    const monat = await subscribe(s, cookie, 'monat');
    const m = await rowOf(s, monat);
    s.clock.now = new Date(m.startedAt.getTime() + 2 * 3600_000);
    assert.equal((await form(s, 'widerrufen', { name: 'Carla', email: 'c@example.org', number: monat })).status, 200);
    const { abo } = await getAbo(s, cookie);
    assert.equal(abo.status, 'withdrawn');
    assert.equal(abo.access, false);
    const expected = refundOnWithdraw({ paidCent: 499, startedAt: m.startedAt, periodEnd: m.currentPeriodEnd, now: s.clock.now, immediateStart: true });
    assert.deepEqual(s.provider.refunds.map((r) => [r.grossCent, r.plan]), [[expected, 'monat']]);
    assert.deepEqual(abo.payments.map((p) => p.kind).sort(), ['payment', 'refund']);
    assert.equal((await liveGame(s, cookie)).status, 402);

    // Jahrespass, einen Tag genutzt
    s.clock.now = null;
    const pass = await subscribe(s, cookie, 'jahr');
    const p = await rowOf(s, pass);
    s.clock.now = new Date(p.startedAt.getTime() + 2 * 3600_000);
    await form(s, 'widerrufen', { name: 'Carla', email: 'c@example.org', number: pass });
    assert.deepEqual(s.provider.refunds.at(-1).plan, 'jahr');
    assert.equal(s.provider.refunds.at(-1).grossCent, refundOnWithdraw({ paidCent: 4788, startedAt: p.startedAt, periodEnd: p.endsAt, now: s.clock.now, immediateStart: true }));
    assert.match(s.outbox.at(-1).text, /über PayPal zurückgezahlt/);

    // Neuer Jahrespass, Widerruf nach 15 Tagen: bleibt aktiv, Betreiber prüft
    s.clock.now = null;
    await subscribe(s, cookie, 'jahr');
    s.clock.now = new Date(Date.now() + 15 * DAY);
    await form(s, 'widerrufen', { name: 'Carla', email: 'c@example.org' });
    const after = (await getAbo(s, cookie)).abo;
    assert.equal(after.status, 'active');
    assert.equal(after.canWithdraw, false);
    assert.ok(s.outbox.some((mail) => mail.to === 'betrieb@example.org' && mail.subject.includes('nach Ablauf der Frist')));
  } finally {
    await s.stop();
  }
});

test('Konto löschen: Vertrag endet, Vertrag und Zahlungen bleiben; Export enthält den Vertrag', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    const cookie = await s.login('d@example.org');
    const number = await subscribe(s, cookie, 'monat');
    const data = await (await fetch(`${s.base}/api/account/export`, { headers: { Cookie: cookie } })).json();
    assert.equal(data.subscriptions[0].number, number);
    assert.equal(data.subscriptions[0].plan, 'monat');
    assert.equal(data.subscriptions[0].payments[0].grossCent, TARIFE.monat.preisCent);

    const del = await fetch(`${s.base}/api/account/delete`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify({ email: 'd@example.org' }) });
    assert.equal(del.status, 200);
    const sub = await rowOf(s, number);
    assert.equal(sub.userId, null);
    assert.equal(sub.status, 'cancelled');
    assert.ok(sub.endsAt <= new Date());
    assert.equal(s.provider.cancelled.length, 1);
    assert.equal((await s.db.db.select().from(payment).where(eq(payment.subscriptionId, sub.id))).length, 1);
  } finally {
    await s.stop();
  }
});

test('Seiten: Fuß-Links auf jeder Seite außer den Apps, Formularseiten ohne Anmeldung, Grenze je IP', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    for (const url of ['/lehrkraefte/', '/preise/', '/impressum/', '/datenschutz/', '/agb/', '/widerrufsbelehrung/', '/vertraege-kuendigen/', '/vertrag-widerrufen/']) {
      const html = await (await fetch(`${s.base}${url}`)).text();
      assert.ok(html.includes('>Verträge hier kündigen</a>') && html.includes('>Vertrag widerrufen</a>'), `Fuß-Links fehlen auf ${url}`);
      assert.ok(html.includes('content="noindex, nofollow"'), `Sperre fehlt auf ${url}`);
    }
    assert.ok((await (await fetch(`${s.base}/vertraege-kuendigen/`)).text()).includes('>jetzt kündigen</button>'));
    assert.ok((await (await fetch(`${s.base}/vertrag-widerrufen/`)).text()).includes('>Widerruf bestätigen</button>'));
    for (const url of ['/', '/host/']) assert.ok(!(await (await fetch(`${s.base}${url}`)).text()).includes('vertrag-fuss'), `kein Fuß in der App ${url}`);
    const config = await (await fetch(`${s.base}/js/config.js`)).text();
    assert.match(config, /"abo":true,"aboPflicht":true/);

    let last;
    for (let i = 0; i < 6; i += 1) last = await form(s, 'widerrufen', { name: 'X', email: `x${i}@example.org` });
    assert.equal(last.status, 429);
  } finally {
    await s.stop();
  }
});
