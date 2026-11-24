// Gemeinsame Schritte der Abo-Tests (abo.test.js, jahrespass.test.js). Zwei Dateien, weil Better Auth
// je Prozess höchstens fünf Anmeldelinks in zehn Minuten verschickt.
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { subscription } from '../src/db/schema.js';
import { dbUrl, json } from './db-helpers.js';
import { QUIZ } from './helpers.js';

export const skip = !dbUrl && 'TEST_DATABASE_URL nicht gesetzt';
export const DAY = 86_400_000;
export const datum = (d) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(d));

export const startAbo = (s, cookie, tarif, body = { sofortBeginnen: true, tarif }) => fetch(`${s.base}/api/abo/start`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify(body) });

export async function subscribe(s, cookie, tarif) {
  const start = await startAbo(s, cookie, tarif);
  assert.equal(start.status, 200, await start.clone().text());
  const { approveUrl, number } = await start.json();
  assert.match(number, /^LQ-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  // Zustimmung beim „Zahlungsanbieter“, dann Rückkehr (Monatsabo: subscription_id, Jahrespass: token)
  const approve = await fetch(`${s.base}${approveUrl}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(approve.status, 302);
  const back = new URL(approve.headers.get('location'));
  assert.ok(back.searchParams.has(tarif === 'jahr' ? 'token' : 'subscription_id'));
  const ret = await fetch(`${s.base}${back.pathname}${back.search}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(ret.headers.get('location'), '/host/?abo=aktiv');
  return number;
}

export const getAbo = async (s, cookie) => (await fetch(`${s.base}/api/abo`, { headers: { Cookie: cookie } })).json();
export const liveGame = (s, cookie) => fetch(`${s.base}/api/games`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify({ quiz: QUIZ }) });
export const form = (s, kind, body) => fetch(`${s.base}/api/vertrag/${kind}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
export const rowOf = async (s, number) => (await s.db.db.select().from(subscription).where(eq(subscription.number, number)))[0];

