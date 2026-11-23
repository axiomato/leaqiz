// Mails rund um das Abo. Nur Text: Inhalt, Datum und Uhrzeit sollen auch ohne HTML lesbar bleiben.
// AGB und Widerrufsbelehrung schreibt eine Fachperson; bis dahin verweisen die Mails auf die Seiten.
import { ANGEBOT, euro } from './angebot.js';

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Berlin' });
export const datum = (d) => dateFmt.format(new Date(d));
export const zeitpunkt = (d) => `${dateFmt.format(new Date(d))} um ${timeFmt.format(new Date(d))} Uhr`;

const footer = (origin) => ['', '—', 'leaqizz · Uwe Brandt · Am Wald 17 · 01768 Glashütte', `Impressum: ${origin}/impressum/`].join('\n');

// Angaben aus dem Formular in lesbarer Form (auch für die Bestätigungsseite)
export function contentLines(kind, c) {
  const lines = [`Name: ${c.name}`, `E-Mail-Adresse: ${c.email}`];
  if (c.number) lines.push(`Vertragsnummer: ${c.number}`);
  if (kind === 'kuendigung') {
    lines.push(`Art der Kündigung: ${c.art === 'ausserordentlich' ? 'außerordentlich' : 'ordentlich'}`);
    if (c.grund) lines.push(`Grund: ${c.grund}`);
    lines.push(`Gewünschtes Ende: ${c.datum ? datum(c.datum) : 'zum nächstmöglichen Zeitpunkt'}`);
  } else {
    lines.push('Erklärung: Ich widerrufe den Vertrag über das leaqizz Abo.');
  }
  return lines;
}

export function contractConfirmationMail(sub, origin) {
  const text = [
    'Hallo,',
    '',
    'danke für dein leaqizz Abo. Hier sind deine Vertragsdaten:',
    '',
    `Vertragsnummer: ${sub.number}`,
    `Vertragsbeginn: ${zeitpunkt(sub.startedAt)}`,
    `Erstes Jahr: ${euro(ANGEBOT.ersteZahlungCent)} im Voraus (${euro(ANGEBOT.monatCent)} im Monat, inkl. ${ANGEBOT.ustSatz} % USt)`,
    `Erste Laufzeit bis: ${datum(sub.firstTermEnd)}`,
    `Danach läuft das Abo monatlich weiter (${euro(ANGEBOT.monatCent)} im Monat) und ist jederzeit mit einer Frist von einem Monat kündbar.`,
    '',
    `Kündigen: ${origin}/vertraege-kuendigen/ (ohne Anmeldung, auch unten auf jeder Seite)`,
    `Widerrufen innerhalb von ${ANGEBOT.widerrufTage} Tagen: ${origin}/vertrag-widerrufen/`,
    `AGB: ${origin}/agb/`,
    `Widerrufsbelehrung und Muster-Widerrufsformular: ${origin}/widerrufsbelehrung/`,
    '',
    sub.immediateStart
      ? 'Du hast verlangt, dass leaqizz sofort startet. Widerrufst du, erstatten wir den Betrag abzüglich der genutzten Tage.'
      : '',
    footer(origin),
  ].join('\n');
  return { subject: `Dein leaqizz Abo (${sub.number})`, text };
}

export function cancellationMail({ content, receivedAt, endsAt, sub, origin, note }) {
  const text = [
    'Hallo,',
    '',
    'wir haben deine Kündigung erhalten. Das ist die Bestätigung des Eingangs.',
    '',
    `Eingegangen am ${zeitpunkt(receivedAt)}`,
    `Vertrag: ${sub.number}`,
    ...contentLines('kuendigung', content),
    '',
    endsAt ? `Dein Abo endet am ${datum(endsAt)}. Bis dahin kannst du Live-Spiele starten. Danach buchen wir nichts mehr ab.` : '',
    note || '',
    '',
    'Warst du das nicht? Antworte auf diese Mail, dann klären wir es.',
    footer(origin),
  ].join('\n');
  return { subject: `Eingangsbestätigung: Kündigung ${sub.number}`, text };
}

export function withdrawalMail({ content, receivedAt, sub, origin, refundCent, refundDone }) {
  const text = [
    'Hallo,',
    '',
    'dein Widerruf ist bei uns eingegangen. Das ist die Bestätigung des Eingangs.',
    '',
    `Eingegangen am ${zeitpunkt(receivedAt)}`,
    `Vertrag: ${sub.number}`,
    ...contentLines('widerruf', content),
    '',
    refundCent !== null && refundCent !== undefined
      ? `${refundDone ? 'Wir haben' : 'Wir werden innerhalb von 14 Tagen'} ${euro(refundCent)} über PayPal ${refundDone ? 'zurückgezahlt' : 'zurückzahlen'}.`
      : 'Die Rückzahlung veranlassen wir innerhalb von 14 Tagen über PayPal.',
    '',
    'Warst du das nicht? Antworte auf diese Mail, dann klären wir es.',
    footer(origin),
  ].join('\n');
  return { subject: `Eingangsbestätigung: Widerruf ${sub.number}`, text };
}

export function operatorMail(subject, lines) {
  return { subject: `leaqizz Abo: ${subject}`, text: lines.join('\n') };
}
