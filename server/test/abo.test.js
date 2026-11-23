// Abo (D-58): Abschluss, Live-Spiel nur mit Abo, Kündigen und Widerrufen ohne Anmeldung, Konto löschen.
// Gegen echte PostgreSQL-Datenbank (TEST_DATABASE_URL), Zahlungsweg „simulation“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { contractEvent, payment, subscription } from '../src/db/schema.js';
import { ANGEBOT, addMonths, cancelEnd, refundOnWithdraw } from '../src/billing/angebot.js';
import { dbUrl, json, setupWithAuth } from './db-helpers.js';
import { QUIZ } from './helpers.js';

const skip = !dbUrl && 'TEST_DATABASE_URL nicht gesetzt';
const DAY = 86_400_000;

async function subscribe(s, cookie) {
  const start = await fetch(`${s.base}/api/abo/start`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify({ sofortBeginnen: true }) });
  assert.equal(start.status, 200);
  const { approveUrl, number } = await start.json();
  assert.match(number, /^LQ-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  // Zustimmung beim „Zahlungsanbieter“, dann Rückkehr
  const approve = await fetch(`${s.base}${approveUrl}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(approve.status, 302);
  const back = new URL(approve.headers.get('location'));
  const ret = await fetch(`${s.base}${back.pathname}${back.search}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(ret.headers.get('location'), '/host/?abo=aktiv');
  return number;
}

const getAbo = async (s, cookie) => (await fetch(`${s.base}/api/abo`, { headers: { Cookie: cookie } })).json();
const liveGame = (s, cookie) => fetch(`${s.base}/api/games`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify({ quiz: QUIZ }) });
const form = (s, kind, body) => fetch(`${s.base}/api/vertrag/${kind}`, { method: 'POST', headers: json, body: JSON.stringify(body) });

test('Angebot: Monate addieren, Kündigungsende, Erstattung beim Widerruf', () => {
  assert.equal(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(addMonths(new Date('2026-11-23T17:00:00Z'), 12).toISOString(), '2027-11-23T17:00:00.000Z');
  const sub = { firstTermEnd: new Date('2027-11-23T00:00:00Z'), currentPeriodEnd: new Date('2027-11-23T00:00:00Z') };
  // im ersten Jahr: Ende der ersten Laufzeit
  assert.equal(cancelEnd(sub, new Date('2027-02-01T00:00:00Z')).toISOString(), '2027-11-23T00:00:00.000Z');
  // danach: Ende des bezahlten Monats, höchstens ein Monat
  const later = { ...sub, currentPeriodEnd: new Date('2028-03-10T00:00:00Z') };
  assert.equal(cancelEnd(later, new Date('2028-02-20T00:00:00Z')).toISOString(), '2028-03-10T00:00:00.000Z');
  assert.equal(refundOnWithdraw({ paidCent: 4788, startedAt: new Date(0), now: new Date(DAY), immediateStart: true }), 4788 - 13);
  assert.equal(refundOnWithdraw({ paidCent: 4788, startedAt: new Date(0), now: new Date(DAY), immediateStart: false }), 4788);
});

test('Abo: Live-Spiel erst mit Abo; Abschluss, Vertragsbestätigung, kein zweites Abo', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    const cookie = await s.login('a@example.org');
    const blocked = await liveGame(s, cookie);
    assert.equal(blocked.status, 402);
    assert.equal((await blocked.json()).code, 'abo');

    assert.equal((await getAbo(s, cookie)).abo, null);
    const noConsent = await fetch(`${s.base}/api/abo/start`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: '{}' });
    assert.equal(noConsent.status, 400);
    const foreign = await fetch(`${s.base}/api/abo/start`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://fremd.example', Cookie: cookie }, body: JSON.stringify({ sofortBeginnen: true }) });
    assert.equal(foreign.status, 403);

    const number = await subscribe(s, cookie);
    const { abo } = await getAbo(s, cookie);
    assert.equal(abo.number, number);
    assert.equal(abo.access, true);
    assert.equal(abo.canWithdraw, true);
    assert.deepEqual(abo.payments.map((p) => [p.kind, p.grossCent, p.vatCent]), [['payment', ANGEBOT.ersteZahlungCent, 764]]);
    assert.equal(new Date(abo.firstTermEnd).getTime(), addMonths(new Date(abo.startedAt), 12).getTime());
    const mail = s.outbox.find((m) => m.subject.includes(number));
    assert.ok(mail && mail.text.includes('/vertraege-kuendigen/') && mail.text.includes('47,88 €'));

    assert.equal((await liveGame(s, cookie)).status, 201);
    const again = await fetch(`${s.base}/api/abo/start`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify({ sofortBeginnen: true }) });
    assert.equal(again.status, 409);

    // Dieselbe Benachrichtigung zweimal: nur einmal gebucht
    const [sub] = await s.db.db.select().from(subscription).where(eq(subscription.number, number));
    const ev = { id: 'EV-1', kind: 'payment', providerId: sub.providerId, paymentId: 'P-2', grossCent: 399, currency: 'EUR', at: new Date() };
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
    const number = await subscribe(s, cookie);

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
    const body = await res.json();
    assert.equal(body.content.art, 'ordentlich');
    const { abo } = await getAbo(s, cookie);
    assert.equal(abo.endsAt, abo.firstTermEnd);
    assert.equal(abo.access, true, 'Zugang bis zum Ende der bezahlten Zeit');
    assert.equal(s.provider.cancelled.length, 1);
    const mail = s.outbox.at(-1);
    assert.equal(mail.to, 'b@example.org');
    assert.match(mail.subject, /Eingangsbestätigung: Kündigung/);
    assert.match(mail.text, /Eingegangen am \d{2}\.\d{2}\.\d{4} um \d{2}:\d{2}:\d{2} Uhr/);
    const events = await s.db.db.select().from(contractEvent);
    assert.deepEqual(events.map((e) => e.result).sort(), ['endet am ' + new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(abo.endsAt)), 'kein Vertrag gefunden'].sort());

    // Nach dem Ende kein Live-Spiel mehr
    s.clock.now = new Date(new Date(abo.endsAt).getTime() + 1000);
    assert.equal((await liveGame(s, cookie)).status, 402);
  } finally {
    await s.stop();
  }
});

test('Widerrufen: in der Frist sofort beendet und anteilig erstattet; danach nur festgehalten', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    const cookie = await s.login('c@example.org');
    await subscribe(s, cookie);
    const res = await form(s, 'widerrufen', { name: 'Carla', email: 'c@example.org' });
    assert.equal(res.status, 200);
    const { abo } = await getAbo(s, cookie);
    assert.equal(abo.status, 'withdrawn');
    assert.equal(abo.access, false);
    assert.equal(s.provider.refunds.length, 1);
    assert.equal(s.provider.refunds[0].grossCent, ANGEBOT.ersteZahlungCent - 13);
    assert.deepEqual(abo.payments.map((p) => p.kind).sort(), ['payment', 'refund']);
    assert.match(s.outbox.at(-1).text, /47,75 € über PayPal zurückgezahlt/);
    assert.equal((await liveGame(s, cookie)).status, 402);

    // Neues Abo, Widerruf nach 15 Tagen: bleibt aktiv, Betreiber prüft
    await subscribe(s, cookie);
    s.clock.now = new Date(Date.now() + 15 * DAY);
    await form(s, 'widerrufen', { name: 'Carla', email: 'c@example.org' });
    const after = (await getAbo(s, cookie)).abo;
    assert.equal(after.status, 'active');
    assert.equal(after.canWithdraw, false);
    assert.ok(s.outbox.some((m) => m.to === 'betrieb@example.org' && m.subject.includes('nach Ablauf der Frist')));
  } finally {
    await s.stop();
  }
});

test('Konto löschen: Abo endet, Vertrag und Zahlungen bleiben; Export enthält das Abo', { skip }, async () => {
  const s = await setupWithAuth({ billing: { required: true } });
  try {
    const cookie = await s.login('d@example.org');
    const number = await subscribe(s, cookie);
    const data = await (await fetch(`${s.base}/api/account/export`, { headers: { Cookie: cookie } })).json();
    assert.equal(data.subscriptions[0].number, number);
    assert.equal(data.subscriptions[0].payments[0].grossCent, ANGEBOT.ersteZahlungCent);

    const del = await fetch(`${s.base}/api/account/delete`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify({ email: 'd@example.org' }) });
    assert.equal(del.status, 200);
    const [sub] = await s.db.db.select().from(subscription).where(eq(subscription.number, number));
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
    for (const url of ['/lehrkraefte/', '/impressum/', '/datenschutz/', '/agb/', '/widerrufsbelehrung/', '/vertraege-kuendigen/', '/vertrag-widerrufen/']) {
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
