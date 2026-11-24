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
      ['GET /v1/billing/subscriptions/I-ABC', [200, { id: 'I-ABC', status: 'ACTIVE', plan_id: 'P-1', start_time: '2026-11-23T10:00:00Z', billing_info: { next_billing_time: '2026-12-23T10:00:00Z' } }]],
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
  assert.equal(sub.nextBillingAt.toISOString(), '2026-12-23T10:00:00.000Z');
  await pp.cancel('I-ABC', 'Kündigung');
  await pp.cancel('I-OLD', 'schon gekündigt');
  assert.equal(fetch.calls.filter((c) => c.pathname === '/v1/oauth2/token').length, 1);
});

test('PayPal: Benachrichtigung prüfen und übersetzen', async () => {
  let status = 'SUCCESS';
  const fetch = fakeFetch(Object.fromEntries([TOKEN, ['POST /v1/notifications/verify-webhook-signature', () => [200, { verification_status: status }]]]));
  const pp = createPayPal(CONF, { fetch });
  const headers = { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': '2026-11-23T10:00:00Z' };
  const event = { id: 'WH-EV-1', event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-1', billing_agreement_id: 'I-ABC', amount: { total: '4.99', currency: 'EUR' }, create_time: '2026-11-23T10:00:05Z' } };
  assert.equal(await pp.verifyWebhook(headers, event), true);
  assert.equal(JSON.parse(fetch.calls.at(-1).body).webhook_id, 'WH-1');
  status = 'FAILURE';
  assert.equal(await pp.verifyWebhook(headers, event), false);
  assert.equal(await pp.verifyWebhook({}, event), false, 'ohne Signatur-Köpfe gar nicht erst fragen');

  assert.deepEqual(pp.toEvent(event), { id: 'WH-EV-1', type: 'PAYMENT.SALE.COMPLETED', kind: 'payment', providerId: 'I-ABC', paymentId: 'SALE-1', grossCent: 499, currency: 'EUR', at: new Date('2026-11-23T10:00:05Z') });
  assert.equal(pp.toEvent({ id: 'e', event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: 'I-ABC' } }).kind, 'subscription');
  assert.equal(pp.toEvent({ id: 'e', event_type: 'PAYMENT.SALE.REFUNDED', resource: { id: 'R-1', sale_id: 'SALE-1', amount: { total: '-4.32', currency: 'EUR' } } }).grossCent, 432);
});

test('PayPal: Jahrespass als Bestellung anlegen, einziehen (auch doppelt), erstatten', async () => {
  let captured = false;
  const ORDER = (status, capture) => ({
    id: 'O-1',
    status,
    purchase_units: [{ reference_id: 'uuid-2', payments: capture ? { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '47.88', currency_code: 'EUR' }, create_time: '2026-11-24T09:00:00Z' }] } : undefined }],
  });
  const fetch = fakeFetch(
    Object.fromEntries([
      TOKEN,
      ['POST /v2/checkout/orders', [201, { id: 'O-1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=O-1' }] }]],
      ['GET /v2/checkout/orders/O-1', () => [200, ORDER(captured ? 'COMPLETED' : 'APPROVED', captured)]],
      ['POST /v2/checkout/orders/O-1/capture', () => (captured ? [422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }] : ((captured = true), [201, ORDER('COMPLETED', true)]))],
      ['POST /v2/payments/captures/CAP-1/refund', [201, { id: 'REF-1', status: 'COMPLETED' }]],
      ['POST /v1/payments/sale/SALE-1/refund', [201, { id: 'REF-S', state: 'completed' }]],
    ]),
  );
  const pp = createPayPal(CONF, { fetch });
  const created = await pp.createOrder({ customId: 'uuid-2', amountCent: 4788, description: 'leaqizz Jahrespass', returnUrl: 'https://leaqizz.com/abo/zurueck/', cancelUrl: 'https://leaqizz.com/abo/abgebrochen/' });
  assert.deepEqual(created, { providerId: 'O-1', approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=O-1' });
  const body = JSON.parse(fetch.calls[1].body);
  assert.equal(body.intent, 'CAPTURE');
  assert.deepEqual(body.purchase_units[0].amount, { currency_code: 'EUR', value: '47.88' });
  assert.equal(body.payment_source.paypal.experience_context.return_url, 'https://leaqizz.com/abo/zurueck/');
  assert.equal(fetch.calls[1].headers['PayPal-Request-Id'], 'uuid-2');

  assert.equal((await pp.getOrder('O-1')).status, 'approved');
  const done = await pp.captureOrder('O-1', 'capture-uuid-2');
  assert.deepEqual(done.capture, { paymentId: 'CAP-1', status: 'completed', grossCent: 4788, currency: 'EUR', at: new Date('2026-11-24T09:00:00Z') });
  // Rückkehr und Benachrichtigung gleichzeitig: zweites Einziehen (422) liefert denselben Stand
  assert.equal((await pp.captureOrder('O-1', 'capture-uuid-2')).capture.paymentId, 'CAP-1');

  assert.deepEqual(await pp.refund('CAP-1', 4600, 'w-1', { plan: 'jahr' }), { refundId: 'REF-1' });
  assert.deepEqual(JSON.parse(fetch.calls.at(-1).body), { amount: { currency_code: 'EUR', value: '46.00' } });
  assert.deepEqual(await pp.refund('SALE-1', 432, 'w-2'), { refundId: 'REF-S' });

  const up = (id) => [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${id}` }];
  assert.deepEqual(pp.toEvent({ id: 'e1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'O-1' } }), { id: 'e1', type: 'CHECKOUT.ORDER.APPROVED', kind: 'order', providerId: 'O-1' });
  const cap = pp.toEvent({ id: 'e2', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-1', amount: { value: '47.88', currency_code: 'EUR' }, supplementary_data: { related_ids: { order_id: 'O-1' } }, create_time: '2026-11-24T09:00:00Z' } });
  assert.deepEqual([cap.kind, cap.providerId, cap.paymentId, cap.grossCent], ['payment', 'O-1', 'CAP-1', 4788]);
  const ref = pp.toEvent({ id: 'e3', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'REF-1', amount: { value: '46.00', currency_code: 'EUR' }, links: up('CAP-1') } });
  assert.deepEqual([ref.kind, ref.paymentId, ref.refundId, ref.grossCent], ['refund', 'CAP-1', 'REF-1', 4600]);
  assert.equal(pp.toEvent({ id: 'e4', event_type: 'PAYMENT.CAPTURE.REVERSED', resource: { id: 'REV-1', amount: { value: '-47.88', currency_code: 'EUR' }, links: up('CAP-1') } }).paymentId, 'CAP-1');
});
