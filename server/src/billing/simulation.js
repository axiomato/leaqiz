// Zahlungsweg „simulation“: ersetzt PayPal lokal und in Tests (LEAQIZ_ZAHLUNG=simulation, nur localhost).
// Die Zustimmungsseite ist /abo/simulation/. Monatsabo: sofort aktiv, erste Zahlung gebucht.
// Jahrespass: Bestellung zugestimmt; eingezogen wird bei der Rückkehr (wie bei PayPal).
import { randomUUID } from 'node:crypto';
import { TARIFE, addMonths } from './angebot.js';

const short = (prefix) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;

export function createSimulation({ now = () => new Date() } = {}) {
  const subs = new Map();
  const orders = new Map();
  const refunds = [];
  const cancelled = [];

  return {
    name: 'simulation',
    refunds,
    cancelled,
    orders,

    async create({ customId, returnUrl, cancelUrl }) {
      const providerId = short('SIM');
      subs.set(providerId, { providerId, status: 'pending', customId, returnUrl, cancelUrl, startedAt: null, nextBillingAt: null });
      return { providerId, approveUrl: `/abo/simulation/?id=${encodeURIComponent(providerId)}` };
    },

    async get(providerId) {
      const s = subs.get(providerId);
      if (!s) throw Object.assign(new Error('Unbekanntes Abo'), { status: 404 });
      return { ...s };
    },

    async cancel(providerId) {
      const s = subs.get(providerId);
      if (s && s.status !== 'cancelled') {
        s.status = 'cancelled';
        cancelled.push(providerId);
      }
    },

    async createOrder({ customId, amountCent, returnUrl, cancelUrl }) {
      const providerId = short('SIMO');
      orders.set(providerId, { providerId, status: 'created', customId, amountCent, returnUrl, cancelUrl, capture: null, captures: 0 });
      return { providerId, approveUrl: `/abo/simulation/?id=${encodeURIComponent(providerId)}` };
    },

    async getOrder(orderId) {
      const o = orders.get(orderId);
      if (!o) throw Object.assign(new Error('Unbekannte Bestellung'), { status: 404 });
      return { providerId: o.providerId, status: o.status, capture: o.capture ? { ...o.capture } : null };
    },

    async captureOrder(orderId) {
      const o = orders.get(orderId);
      if (!o) throw Object.assign(new Error('Unbekannte Bestellung'), { status: 404 });
      if (o.status === 'approved') {
        o.status = 'completed';
        o.captures += 1;
        o.capture = { paymentId: short('SIMC'), status: 'completed', grossCent: o.amountCent, currency: 'EUR', at: now() };
      }
      return this.getOrder(orderId);
    },

    async refund(paymentId, grossCent, requestId, { plan = 'monat' } = {}) {
      const refundId = short('SIMR');
      refunds.push({ paymentId, grossCent, refundId, plan });
      return { refundId };
    },

    async verifyWebhook() {
      return false;
    },

    toEvent(event) {
      return event;
    },

    // Zustimmung auf der Simulationsseite. Rückgabe: Ziel der Rückkehr und ggf. die erste Zahlung als Ereignis.
    approve(providerId) {
      const o = orders.get(providerId);
      if (o) {
        if (o.status === 'created') o.status = 'approved';
        return { returnUrl: `${o.returnUrl}?token=${encodeURIComponent(providerId)}&PayerID=SIMPAYER`, payment: null };
      }
      const s = subs.get(providerId);
      if (!s) return null;
      const start = now();
      s.status = 'active';
      s.startedAt = start;
      s.nextBillingAt = addMonths(start, TARIFE.monat.laufzeitMonate);
      return {
        returnUrl: `${s.returnUrl}?subscription_id=${encodeURIComponent(providerId)}`,
        payment: { id: `SIME-${randomUUID()}`, kind: 'payment', providerId, paymentId: short('SIMP'), grossCent: TARIFE.monat.preisCent, currency: 'EUR', at: start },
      };
    },
  };
}
