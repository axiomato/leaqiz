// Legt bei PayPal das Produkt und den Plan für das Monatsabo an (einmal je Umgebung) und auf Wunsch die
// Benachrichtigung. Der Jahrespass braucht keinen Plan (einmalige Bestellung). Preise aus src/billing/angebot.js.
//
//   PAYPAL_UMGEBUNG=sandbox PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… node scripts/paypal-plan.js [--webhook https://leaqizz.com/api/abo/paypal]
//
// Ausgabe: PAYPAL_PLAN_ID (und PAYPAL_WEBHOOK_ID) für deploy/.env. Erst in der Sandbox prüfen.
import { ANGEBOT, TARIFE } from '../src/billing/angebot.js';

const env = (process.env.PAYPAL_UMGEBUNG || 'sandbox').trim().toLowerCase();
const base = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' }[env];
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!base || !id || !secret) {
  console.error('PAYPAL_UMGEBUNG (sandbox|live), PAYPAL_CLIENT_ID und PAYPAL_CLIENT_SECRET setzen.');
  process.exit(1);
}
const webhookArg = process.argv.indexOf('--webhook');
const webhookUrl = webhookArg > 0 ? process.argv[webhookArg + 1] : null;

const money = (cent) => ({ value: (cent / 100).toFixed(2), currency_code: ANGEBOT.waehrung });

async function call(method, path, body, token) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: token ? JSON.stringify(body) : body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const { access_token: token } = await call('POST', '/v1/oauth2/token', 'grant_type=client_credentials');
const product = await call('POST', '/v1/catalogs/products', { name: ANGEBOT.name, type: 'SERVICE', category: 'SOFTWARE', description: 'Live-Quiz für den Unterricht' }, token);
const plan = await call(
  'POST',
  '/v1/billing/plans',
  {
    product_id: product.id,
    name: `${ANGEBOT.name} ${TARIFE.monat.name}`,
    description: `${(TARIFE.monat.preisCent / 100).toFixed(2)} € im Monat, monatlich kündbar`,
    status: 'ACTIVE',
    billing_cycles: [
      // Monatlich im Voraus, unbefristet, kündbar zum Ende des bezahlten Monats (§ 309 Nr. 9 b BGB)
      { frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: money(TARIFE.monat.preisCent) } },
    ],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
    taxes: { percentage: String(ANGEBOT.ustSatz), inclusive: true },
  },
  token,
);
console.log(`PAYPAL_PLAN_ID=${plan.id}`);

if (webhookUrl) {
  const events = [
    'BILLING.SUBSCRIPTION.ACTIVATED',
    'BILLING.SUBSCRIPTION.UPDATED',
    'BILLING.SUBSCRIPTION.RE-ACTIVATED',
    'BILLING.SUBSCRIPTION.CANCELLED',
    'BILLING.SUBSCRIPTION.SUSPENDED',
    'BILLING.SUBSCRIPTION.EXPIRED',
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
    'PAYMENT.SALE.COMPLETED',
    'PAYMENT.SALE.REFUNDED',
    'PAYMENT.SALE.REVERSED',
    // Jahrespass (Bestellung)
    'CHECKOUT.ORDER.APPROVED',
    'PAYMENT.CAPTURE.COMPLETED',
    'PAYMENT.CAPTURE.REFUNDED',
    'PAYMENT.CAPTURE.REVERSED',
  ];
  const hook = await call('POST', '/v1/notifications/webhooks', { url: webhookUrl, event_types: events.map((name) => ({ name })) }, token);
  console.log(`PAYPAL_WEBHOOK_ID=${hook.id}`);
}
