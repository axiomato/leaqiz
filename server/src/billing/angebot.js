// Das Abo-Angebot (D-56, D-58) an einer Stelle: Oberfläche, Mails und Prüfungen lesen es von hier.
// Den Preis bei PayPal legt der Plan fest (scripts/paypal-plan.js liest dieselben Zahlen).

export const ANGEBOT = Object.freeze({
  name: 'leaqizz Abo',
  // Preis je Monat, brutto mit Umsatzsteuer
  monatCent: 399,
  // Erste Laufzeit: ein Jahr, im Voraus bezahlt
  ersteLaufzeitMonate: 12,
  ersteZahlungCent: 399 * 12,
  ustSatz: 19,
  waehrung: 'EUR',
  // Liefergebiet (E3 = L1): nur Deutschland
  land: 'DE',
  // Widerrufsfrist in Tagen ab Vertragsschluss
  widerrufTage: 14,
});

const DAY = 86_400_000;

// Umsatzsteuer, die in einem Bruttobetrag steckt
export const vatOf = (grossCent) => grossCent - Math.round((grossCent * 100) / (100 + ANGEBOT.ustSatz));

export const euro = (cent) => `${(cent / 100).toFixed(2).replace('.', ',')} €`;

// Kalendermonate addieren; der 31. wird im kürzeren Monat zum letzten Tag
export function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

// Zugang zu Live-Spielen: laufendes Abo, auch gekündigt bis zum Ende der bezahlten Zeit
export function hasAccess(sub, now = new Date()) {
  if (!sub || !['active', 'cancelled'].includes(sub.status)) return false;
  const end = sub.endsAt || (sub.status === 'cancelled' ? sub.currentPeriodEnd : null);
  return !end || new Date(end) > now;
}

// Ordentliche Kündigung: zum Ende des ersten Jahres; danach zum Ende des bezahlten Monats,
// höchstens einen Monat nach Eingang (§ 309 Nr. 9 b BGB)
export function cancelEnd(sub, now = new Date()) {
  if (sub.firstTermEnd && now < new Date(sub.firstTermEnd)) return new Date(sub.firstTermEnd);
  const max = addMonths(now, 1);
  const period = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  if (period && period > now && period < max) return period;
  return period && period > now ? max : now;
}

export const withinWithdrawal = (sub, now = new Date()) => Boolean(sub.startedAt) && now - new Date(sub.startedAt) <= ANGEBOT.widerrufTage * DAY;

// Erstattung beim Widerruf: alles zurück, abzüglich der genutzten Tage, wenn der sofortige Beginn
// verlangt wurde (Wertersatz, § 357a Abs. 2 BGB; Annahme, Fachperson prüft)
export function refundOnWithdraw({ paidCent, startedAt, now = new Date(), immediateStart }) {
  if (!immediateStart || !startedAt) return paidCent;
  const days = Math.max(1, Math.ceil((now - new Date(startedAt)) / DAY));
  return Math.max(0, paidCent - Math.round((paidCent * days) / 365));
}
