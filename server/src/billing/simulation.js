// Zahlungsweg „simulation“: ersetzt PayPal lokal und in Tests (LEAQIZ_ZAHLUNG=simulation, nur localhost).
// Die Zustimmungsseite ist /abo/simulation/; dort wird das Abo sofort aktiv und die erste Zahlung gebucht.
import { randomUUID } from 'node:crypto';
import { ANGEBOT, addMonths } from './angebot.js';

export function createSimulation({ now = () => new Date() } = {}) {
  const subs = new Map();
  const refunds = [];
  const cancelled = [];

  return {
    name: 'simulation',
    refunds,
    cancelled,

    async create({ customId, returnUrl, cancelUrl }) {
      const providerId = `SIM-${randomUUID().slice(0, 8).toUpperCase()}`;
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

    async refund(paymentId, grossCent) {
      const refundId = `SIMR-${randomUUID().slice(0, 8).toUpperCase()}`;
      refunds.push({ paymentId, grossCent, refundId });
      return { refundId };
    },

    async verifyWebhook() {
      return false;
    },

    toEvent(event) {
      return event;
    },

    // Zustimmung auf der Simulationsseite: aktiv, erste Zahlung als Ereignis zurück
    approve(providerId) {
      const s = subs.get(providerId);
      if (!s) return null;
      const start = now();
      s.status = 'active';
      s.startedAt = start;
      s.nextBillingAt = addMonths(start, ANGEBOT.ersteLaufzeitMonate);
      return {
        returnUrl: s.returnUrl,
        payment: { id: `SIME-${randomUUID()}`, kind: 'payment', providerId, paymentId: `SIMP-${randomUUID().slice(0, 8).toUpperCase()}`, grossCent: ANGEBOT.ersteZahlungCent, currency: 'EUR', at: start },
      };
    },
  };
}
