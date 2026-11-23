// PayPal Subscriptions (REST v1). Nur Server-zu-Server; Zugangsdaten aus der Konfiguration.
// Die Wege sind der PayPal-Dokumentation entnommen; gegen die Sandbox geprüft ist dieser Teil
// erst, wenn ein Entwicklerzugang eingetragen ist (deploy/README.md, Abschnitt „Abo“).

const BASE = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };

// PayPal-Status → eigener Status
const STATUS = {
  APPROVAL_PENDING: 'pending',
  APPROVED: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

const cents = (value) => Math.round(Number(value) * 100);

export class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createPayPal({ environment, clientId, clientSecret, webhookId, planId }, { fetch = globalThis.fetch } = {}) {
  const base = BASE[environment];
  let token = null;
  let tokenUntil = 0;

  async function accessToken() {
    if (token && Date.now() < tokenUntil) return token;
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new ProviderError(`PayPal-Anmeldung fehlgeschlagen (${res.status})`, res.status);
    const data = await res.json();
    token = data.access_token;
    tokenUntil = Date.now() + Math.max(60, (data.expires_in || 300) - 60) * 1000;
    return token;
  }

  async function api(method, path, body, { requestId } = {}) {
    const headers = { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' };
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ProviderError(`PayPal ${method} ${path.split('?')[0]}: ${res.status} ${(data && (data.name || data.message)) || ''}`.trim(), res.status);
    return data;
  }

  function normalize(sub) {
    const info = sub.billing_info || {};
    return {
      providerId: sub.id,
      status: STATUS[sub.status] || 'pending',
      planId: sub.plan_id,
      startedAt: sub.start_time ? new Date(sub.start_time) : null,
      nextBillingAt: info.next_billing_time ? new Date(info.next_billing_time) : null,
      customId: sub.custom_id || null,
    };
  }

  return {
    name: 'paypal',
    planId,

    // Abo bei PayPal anlegen; die Lehrkraft stimmt auf der PayPal-Seite zu (approveUrl)
    async create({ customId, email, returnUrl, cancelUrl }) {
      const sub = await api(
        'POST',
        '/v1/billing/subscriptions',
        {
          plan_id: planId,
          custom_id: customId,
          subscriber: email ? { email_address: email } : undefined,
          application_context: {
            brand_name: 'leaqizz',
            locale: 'de-DE',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'SUBSCRIBE_NOW',
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
        { requestId: customId },
      );
      const approve = (sub.links || []).find((l) => l.rel === 'approve');
      if (!approve) throw new ProviderError('PayPal hat keinen Link zur Zustimmung geliefert.');
      return { providerId: sub.id, approveUrl: approve.href };
    },

    async get(providerId) {
      return normalize(await api('GET', `/v1/billing/subscriptions/${encodeURIComponent(providerId)}`));
    },

    // Keine weiteren Abbuchungen. Schon gekündigt (422) gilt als erledigt.
    async cancel(providerId, reason) {
      try {
        await api('POST', `/v1/billing/subscriptions/${encodeURIComponent(providerId)}/cancel`, { reason: String(reason).slice(0, 128) });
      } catch (err) {
        if (err.status !== 422) throw err;
      }
    },

    // Erstattung einer Abo-Zahlung (Endpunkt laut PayPal-Doku für Sale-Transaktionen; in der Sandbox prüfen)
    async refund(paymentId, grossCent, requestId) {
      const data = await api(
        'POST',
        `/v1/payments/sale/${encodeURIComponent(paymentId)}/refund`,
        { amount: { total: (grossCent / 100).toFixed(2), currency: 'EUR' } },
        { requestId },
      );
      return { refundId: data.id };
    },

    // Echtheit einer Benachrichtigung über die Prüf-API von PayPal
    async verifyWebhook(headers, event) {
      const h = (name) => headers[name] || headers[name.toLowerCase()];
      const needed = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
      if (needed.some((name) => !h(name))) return false;
      const data = await api('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: webhookId,
        webhook_event: event,
      });
      return data && data.verification_status === 'SUCCESS';
    },

    // Benachrichtigung → einheitliches Ereignis
    toEvent(event) {
      const r = event.resource || {};
      const base = { id: event.id, type: event.event_type };
      switch (event.event_type) {
        case 'BILLING.SUBSCRIPTION.ACTIVATED':
        case 'BILLING.SUBSCRIPTION.UPDATED':
        case 'BILLING.SUBSCRIPTION.RE-ACTIVATED':
        case 'BILLING.SUBSCRIPTION.CANCELLED':
        case 'BILLING.SUBSCRIPTION.SUSPENDED':
        case 'BILLING.SUBSCRIPTION.EXPIRED':
        case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
          return { ...base, kind: event.event_type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' ? 'failed' : 'subscription', providerId: r.id };
        case 'PAYMENT.SALE.COMPLETED':
          return { ...base, kind: 'payment', providerId: r.billing_agreement_id || null, paymentId: r.id, grossCent: cents(r.amount && r.amount.total), currency: (r.amount && r.amount.currency) || 'EUR', at: new Date(r.create_time || Date.now()) };
        case 'PAYMENT.SALE.REFUNDED':
          return { ...base, kind: 'refund', paymentId: r.sale_id, refundId: r.id, grossCent: Math.abs(cents(r.amount && r.amount.total)), currency: (r.amount && r.amount.currency) || 'EUR', at: new Date(r.create_time || Date.now()) };
        case 'PAYMENT.SALE.REVERSED':
          return { ...base, kind: 'reversal', paymentId: r.id, grossCent: Math.abs(cents(r.amount && r.amount.total)), currency: (r.amount && r.amount.currency) || 'EUR', at: new Date(r.create_time || Date.now()) };
        default:
          return { ...base, kind: 'other' };
      }
    },
  };
}
