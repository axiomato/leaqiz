// PayPal-Anbindung ohne Netz: Anfragen gehen an ein nachgebautes fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayPal } from '../src/billing/paypal.js';

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const { pathname } = new URL(url);
    calls.push({ url, pathname, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const hit = routes[`${init.method || 'GET'} ${pathname}`];
    if (!hit) return new Response(JSON.stringify({ name: 'NOT_FOUND' }), { status: 404 });
    const [status, body] = typeof hit === 'function' ? hit(init) : hit;
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  fn.calls = calls;
  return fn;
}

const CONF = { environment: 'sandbox', clientId: 'id', clientSecret: 'geheim', webhookId: 'WH-1', planId: 'P-1' };
const TOKEN = ['POST /v1/oauth2/token', [200, { access_token: 'tok', expires_in: 3600 }]];

test('PayPal: Abo anlegen, abfragen, kündigen; Token nur einmal; Sandbox-Adresse', async () => {
  const fetch = fakeFetch(
    Object.fromEntries([
      TOKEN,
      ['POST /v1/billing/subscriptions', [201, { id: 'I-ABC', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=X' }] }]],
      ['GET /v1/billing/subscriptions/I-ABC', [200, { id: 'I-ABC', status: 'ACTIVE', plan_id: 'P-1', start_time: '2026-11-23T10:00:00Z', billing_info: { next_billing_time: '2027-11-23T10:00:00Z' } }]],
      ['POST /v1/billing/subscriptions/I-ABC/cancel', [204, null]],
      ['POST /v1/billing/subscriptions/I-OLD/cancel', [422, { name: 'UNPROCESSABLE_ENTITY' }]],
    ]),
  );
  const pp = createPayPal(CONF, { fetch });
  const created = await pp.create({ customId: 'uuid-1', email: 'a@example.org', returnUrl: 'https://leaqizz.com/abo/zurueck/', cancelUrl: 'https://leaqizz.com/abo/abgebrochen/' });
  assert.deepEqual(created, { providerId: 'I-ABC', approveUrl: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=X' });
  const body = JSON.parse(fetch.calls[1].body);
  assert.equal(body.plan_id, 'P-1');
  assert.equal(body.application_context.locale, 'de-DE');
  assert.equal(fetch.calls[1].headers['PayPal-Request-Id'], 'uuid-1', 'doppeltes Absenden legt kein zweites Abo an');
  assert.ok(fetch.calls.every((c) => c.url.startsWith('https://api-m.sandbox.paypal.com/')));

  const sub = await pp.get('I-ABC');
  assert.equal(sub.status, 'active');
  assert.equal(sub.nextBillingAt.toISOString(), '2027-11-23T10:00:00.000Z');
  await pp.cancel('I-ABC', 'Kündigung');
  await pp.cancel('I-OLD', 'schon gekündigt');
  assert.equal(fetch.calls.filter((c) => c.pathname === '/v1/oauth2/token').length, 1);
});

test('PayPal: Benachrichtigung prüfen und übersetzen', async () => {
  let status = 'SUCCESS';
  const fetch = fakeFetch(Object.fromEntries([TOKEN, ['POST /v1/notifications/verify-webhook-signature', () => [200, { verification_status: status }]]]));
  const pp = createPayPal(CONF, { fetch });
  const headers = { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': '2026-11-23T10:00:00Z' };
  const event = { id: 'WH-EV-1', event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-1', billing_agreement_id: 'I-ABC', amount: { total: '47.88', currency: 'EUR' }, create_time: '2026-11-23T10:00:05Z' } };
  assert.equal(await pp.verifyWebhook(headers, event), true);
  assert.equal(JSON.parse(fetch.calls.at(-1).body).webhook_id, 'WH-1');
  status = 'FAILURE';
  assert.equal(await pp.verifyWebhook(headers, event), false);
  assert.equal(await pp.verifyWebhook({}, event), false, 'ohne Signatur-Köpfe gar nicht erst fragen');

  assert.deepEqual(pp.toEvent(event), { id: 'WH-EV-1', type: 'PAYMENT.SALE.COMPLETED', kind: 'payment', providerId: 'I-ABC', paymentId: 'SALE-1', grossCent: 4788, currency: 'EUR', at: new Date('2026-11-23T10:00:05Z') });
  assert.equal(pp.toEvent({ id: 'e', event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: 'I-ABC' } }).kind, 'subscription');
  assert.equal(pp.toEvent({ id: 'e', event_type: 'PAYMENT.SALE.REFUNDED', resource: { id: 'R-1', sale_id: 'SALE-1', amount: { total: '-47.75', currency: 'EUR' } } }).grossCent, 4775);
});
