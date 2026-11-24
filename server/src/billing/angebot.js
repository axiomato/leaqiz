// Die Tarife (D-56 bis D-60) an einer Stelle: Oberfläche, Mails, Preisseite und Prüfungen lesen sie von hier.
// Den Preis des Monatsabos bei PayPal legt der Plan fest (scripts/paypal-plan.js liest dieselben Zahlen).
//
// Monatsabo: monatlich im Voraus, läuft weiter, bis es gekündigt wird; endet zum Ende des bezahlten Monats.
// Jahrespass: einmal bezahlt, gilt zwölf Monate und endet dann von selbst. Eine stillschweigende
// Verlängerung um ein weiteres Jahr wäre bei Verbrauchern unwirksam (§ 309 Nr. 9 b BGB); verlängert wird
// durch einen neuen Kauf. Vor dem Ende erinnert eine Mail.

export const TARIFE = Object.freeze({
  monat: Object.freeze({ id: 'monat', name: 'Monatsabo', preisCent: 499, laufzeitMonate: 1, verlaengertSich: true }),
  jahr: Object.freeze({ id: 'jahr', name: 'Jahrespass', preisCent: 4788, laufzeitMonate: 12, verlaengertSich: false }),
});

export const ANGEBOT = Object.freeze({
  name: 'leaqizz',
  tarife: TARIFE,
  ustSatz: 19,
  waehrung: 'EUR',
  // Liefergebiet (L1): nur Deutschland
  land: 'DE',
  // Widerrufsfrist in Tagen ab Vertragsschluss
  widerrufTage: 14,
  // Jahrespass: Erinnerung vor dem Ende; neuer Pass frühestens so viele Tage vor dem Ende (schließt nahtlos an)
  erinnerungTage: 14,
  verlaengernTage: 30,
});

export const isTarif = (id) => Object.hasOwn(TARIFE, id);
export const tarifOf = (sub) => TARIFE[(sub && sub.plan) || 'monat'];

// Jahrespass umgerechnet auf den Monat und die Ersparnis gegenüber zwölf Monatsabos (abgerundet)
export const jahrProMonatCent = Math.round(TARIFE.jahr.preisCent / 12);
export const ersparnisProzent = Math.floor((1 - TARIFE.jahr.preisCent / (TARIFE.monat.preisCent * 12)) * 100);

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

// Zugang zu Live-Spielen: Vertrag läuft (auch gekündigt bis zum Ende), hat begonnen und ist nicht zu Ende.
// Ein verlängerter Jahrespass beginnt erst, wenn der vorige endet.
export function hasAccess(sub, now = new Date()) {
  if (!sub || !['active', 'cancelled'].includes(sub.status)) return false;
  if (sub.startedAt && new Date(sub.startedAt) > now) return false;
  const end = sub.endsAt || (sub.status === 'cancelled' ? sub.currentPeriodEnd : null);
  return !end || new Date(end) > now;
}

// Ordentliche Kündigung. Monatsabo: zum Ende des bezahlten Monats, höchstens einen Monat nach Eingang
// (§ 309 Nr. 9 b BGB). Jahrespass: endet ohnehin zum vereinbarten Tag, eine Kündigung ändert daran nichts.
export function cancelEnd(sub, now = new Date()) {
  if (tarifOf(sub).id === 'jahr') return sub.endsAt ? new Date(sub.endsAt) : now;
  const max = addMonths(now, 1);
  const period = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  if (period && period > now && period < max) return period;
  return period && period > now ? max : now;
}

// Widerrufsfrist ab Vertragsschluss (bei einem verlängerten Jahrespass liegt der Beginn später)
export function withinWithdrawal(sub, now = new Date()) {
  const from = sub.concludedAt || sub.startedAt;
  return Boolean(from) && now - new Date(from) <= ANGEBOT.widerrufTage * DAY;
}

// Erstattung beim Widerruf: alles zurück, abzüglich der genutzten Tage der bezahlten Zeit, wenn der
// sofortige Beginn verlangt wurde (Wertersatz, § 357a Abs. 2 BGB; Annahme, Fachperson prüft).
// Noch nicht begonnen (verlängerter Pass): alles zurück.
export function refundOnWithdraw({ paidCent, startedAt, periodEnd, now = new Date(), immediateStart }) {
  if (!immediateStart || !startedAt || new Date(startedAt) > now) return paidCent;
  const start = new Date(startedAt);
  const periodDays = periodEnd ? Math.max(1, Math.round((new Date(periodEnd) - start) / DAY)) : 365;
  const used = Math.min(periodDays, Math.max(1, Math.ceil((now - start) / DAY)));
  return Math.max(0, paidCent - Math.round((paidCent * used) / periodDays));
}
