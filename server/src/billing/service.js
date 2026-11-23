// Abo-Logik: Abschluss, Abgleich mit dem Zahlungsanbieter, Kündigung, Widerruf, Konto löschen.
// Maßgeblich ist immer der Zahlungsanbieter (Abfrage oder geprüfte Benachrichtigung), nie der Browser.
import { randomInt } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { contractEvent, payment, providerEvent, subscription } from '../db/schema.js';
import { ANGEBOT, addMonths, cancelEnd, hasAccess, refundOnWithdraw, vatOf, withinWithdrawal } from './angebot.js';
import { cancellationMail, contractConfirmationMail, datum, operatorMail, withdrawalMail } from './mails.js';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const code = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
export const newNumber = () => `LQ-${code(4)}-${code(4)}`;
export const normalizeNumber = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^LQ/, '');
const isUnique = (err) => err && (err.code === '23505' || (err.cause && err.cause.code === '23505'));

// Verträge, die Kündigung oder Widerruf betreffen können
const OPEN = ['active', 'suspended', 'cancelled'];

export class AboError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createAboService({ db, provider, mailer, origin, operator = null, log = console, now = () => new Date() }) {
  async function notifyOperator(subject, lines) {
    log.warn(`Abo: ${subject} – ${lines.join(' | ')}`);
    if (operator) await mailer.send({ to: operator, ...operatorMail(subject, lines) }).catch((err) => log.error(`Betreiber-Mail fehlgeschlagen: ${err.message}`));
  }

  async function send(to, mail) {
    try {
      await mailer.send({ to, ...mail });
    } catch (err) {
      log.error(`Abo-Mail an Kundin/Kunden fehlgeschlagen: ${err.message}`);
    }
  }

  async function latestFor(userId) {
    const rows = await db.select().from(subscription).where(and(eq(subscription.userId, userId), sql`${subscription.status} <> 'pending'`)).orderBy(desc(subscription.createdAt)).limit(5);
    return rows.find((r) => hasAccess(r, now())) || rows[0] || null;
  }

  async function byProviderId(providerId) {
    const [row] = await db.select().from(subscription).where(and(eq(subscription.provider, provider.name), eq(subscription.providerId, providerId)));
    return row || null;
  }

  async function update(id, values) {
    const [row] = await db.update(subscription).set({ ...values, updatedAt: now() }).where(eq(subscription.id, id)).returning();
    return row;
  }

  // Stand beim Zahlungsanbieter übernehmen. Wird ein Abo zum ersten Mal aktiv: Vertragsbestätigung.
  async function sync(providerId) {
    const row = await byProviderId(providerId);
    if (!row) return null;
    const remote = await provider.get(providerId);
    if (provider.planId && remote.planId && remote.planId !== provider.planId) {
      await notifyOperator('Unbekannter Plan', [`Abo ${row.number}: Plan ${remote.planId} statt ${provider.planId}`]);
      return row;
    }
    const values = {};
    const firstActivation = remote.status === 'active' && !row.startedAt;
    if (firstActivation) {
      const startedAt = remote.startedAt && remote.startedAt <= now() ? remote.startedAt : now();
      values.startedAt = startedAt;
      values.firstTermEnd = addMonths(startedAt, ANGEBOT.ersteLaufzeitMonate);
    }
    if (remote.nextBillingAt) values.currentPeriodEnd = remote.nextBillingAt;
    else if (firstActivation) values.currentPeriodEnd = values.firstTermEnd;
    // Widerrufen bleibt widerrufen; ein gekündigtes Abo läuft bis zum Ende der bezahlten Zeit
    if (row.status !== 'withdrawn') {
      if (remote.status === 'cancelled') {
        values.status = 'cancelled';
        if (!row.endsAt) values.endsAt = cancelEnd({ ...row, ...values }, now());
      } else values.status = remote.status;
    }
    const updated = await update(row.id, values);
    if (firstActivation) await send(updated.email, contractConfirmationMail(updated, origin));
    return updated;
  }

  async function recordPayment(sub, ev, kind) {
    try {
      await db.insert(payment).values({
        subscriptionId: sub.id,
        kind,
        providerPaymentId: kind === 'refund' && ev.refundId ? ev.refundId : ev.paymentId,
        grossCent: ev.grossCent,
        vatCent: vatOf(ev.grossCent),
        currency: ev.currency || 'EUR',
        paidAt: ev.at || now(),
      });
    } catch (err) {
      if (!isUnique(err)) throw err;
    }
  }

  async function subscriptionForPayment(paymentId) {
    const [row] = await db.select({ sub: subscription }).from(payment).innerJoin(subscription, eq(payment.subscriptionId, subscription.id)).where(and(eq(payment.kind, 'payment'), eq(payment.providerPaymentId, paymentId)));
    return row ? row.sub : null;
  }

  // Ein Ereignis des Zahlungsanbieters genau einmal verarbeiten
  async function applyEvent(ev) {
    if (!ev || !ev.id) return false;
    const inserted = await db.insert(providerEvent).values({ id: ev.id, provider: provider.name, type: ev.type || ev.kind }).onConflictDoNothing().returning();
    if (!inserted.length) return false;
    try {
      if (ev.kind === 'subscription' && ev.providerId) await sync(ev.providerId);
      else if (ev.kind === 'failed' && ev.providerId) {
        const sub = await byProviderId(ev.providerId);
        if (sub) await notifyOperator('Zahlung fehlgeschlagen', [`Abo ${sub.number}`]);
        await sync(ev.providerId);
      } else if (ev.kind === 'payment' && ev.providerId) {
        const sub = await byProviderId(ev.providerId);
        if (!sub) await notifyOperator('Zahlung ohne Abo', [`Zahlung ${ev.paymentId} für ${ev.providerId}`]);
        else {
          await recordPayment(sub, ev, 'payment');
          await sync(ev.providerId);
        }
      } else if (ev.kind === 'refund' || ev.kind === 'reversal') {
        const sub = await subscriptionForPayment(ev.paymentId);
        if (sub) await recordPayment(sub, ev, ev.kind);
        if (ev.kind === 'reversal') await notifyOperator('Zahlung zurückgebucht', [`Zahlung ${ev.paymentId}${sub ? `, Abo ${sub.number}` : ''}`]);
      }
    } catch (err) {
      // Nicht als verarbeitet merken: der Anbieter schickt die Benachrichtigung erneut
      await db.delete(providerEvent).where(eq(providerEvent.id, ev.id));
      throw err;
    }
    return true;
  }

  // Abschluss starten: Vertrag „pending“ anlegen, Zustimmung beim Zahlungsanbieter
  async function start(user, { immediateStart }) {
    if (!immediateStart) throw new AboError('Bitte bestätige, dass leaqizz sofort starten soll.');
    const current = await latestFor(user.id);
    if (current && hasAccess(current, now())) throw new AboError('Du hast schon ein Abo.', 409);
    let row;
    for (let attempt = 0; attempt < 5 && !row; attempt += 1) {
      try {
        [row] = await db.insert(subscription).values({ number: newNumber(), userId: user.id, email: user.email, provider: provider.name, status: 'pending', immediateStart: true }).returning();
      } catch (err) {
        if (!isUnique(err)) throw err;
      }
    }
    const created = await provider.create({
      customId: row.id,
      email: user.email,
      returnUrl: `${origin}/abo/zurueck/`,
      cancelUrl: `${origin}/abo/abgebrochen/`,
    });
    await update(row.id, { providerId: created.providerId });
    return { approveUrl: created.approveUrl, number: row.number };
  }

  // Rückkehr von der Zustimmung: nur eigene Abos abgleichen
  async function confirmReturn(user, providerId) {
    const row = providerId ? await byProviderId(providerId) : null;
    if (!row || row.userId !== user.id) return null;
    return sync(providerId);
  }

  // Passende Verträge zu Formularangaben: E-Mail muss stimmen, Vertragsnummer (falls angegeben) auch
  async function match(content) {
    const rows = await db.select().from(subscription).where(and(sql`lower(${subscription.email}) = ${content.email.toLowerCase()}`, inArray(subscription.status, OPEN))).orderBy(desc(subscription.createdAt));
    const wanted = normalizeNumber(content.number);
    return rows.filter((r) => (!wanted || normalizeNumber(r.number) === wanted) && !(r.endsAt && new Date(r.endsAt) <= now()));
  }

  async function recordEvent(kind, content, sub, result) {
    const [ev] = await db.insert(contractEvent).values({ kind, content, subscriptionId: sub ? sub.id : null, receivedAt: now(), result }).returning();
    return ev;
  }

  // Kündigung (§ 312k BGB): Eingang immer festhalten; Bestätigung per Mail nur an die Adresse des Vertrags
  async function requestCancel(content) {
    const receivedAt = now();
    const subs = await match(content);
    if (!subs.length) {
      await recordEvent('kuendigung', content, null, 'kein Vertrag gefunden');
      await notifyOperator('Kündigung ohne passenden Vertrag', [`Eingang ${receivedAt.toISOString()}`, `Vertragsnummer: ${content.number || '–'}`]);
      return { receivedAt };
    }
    for (const sub of subs) {
      if (sub.cancelRequestedAt && sub.endsAt) {
        await recordEvent('kuendigung', content, sub, `bereits gekündigt, endet am ${datum(sub.endsAt)}`);
        await send(sub.email, cancellationMail({ content, receivedAt, endsAt: sub.endsAt, sub, origin, note: 'Das Abo war bereits gekündigt.' }));
        continue;
      }
      const endsAt = cancelEnd(sub, receivedAt);
      const wish = content.datum ? new Date(content.datum) : null;
      let note = '';
      if (content.art === 'ausserordentlich') note = 'Den Grund für die außerordentliche Kündigung prüfen wir und melden uns, falls das Abo früher endet.';
      if (wish && wish > endsAt) note = `Dein Wunschtermin (${datum(wish)}) liegt nach dem nächstmöglichen Ende. Wir melden uns dazu.`;
      if (sub.providerId) {
        try {
          await provider.cancel(sub.providerId, `Kündigung ${sub.number}`);
        } catch (err) {
          await notifyOperator('Kündigung beim Zahlungsanbieter fehlgeschlagen', [`Abo ${sub.number}`, err.message]);
        }
      }
      const updated = await update(sub.id, { cancelRequestedAt: receivedAt, endsAt });
      await recordEvent('kuendigung', content, sub, `endet am ${datum(endsAt)}`);
      if (note) await notifyOperator('Kündigung mit Hinweis', [`Abo ${sub.number}`, note]);
      await send(updated.email, cancellationMail({ content, receivedAt, endsAt, sub: updated, origin, note }));
    }
    return { receivedAt };
  }

  // Widerruf (§ 356a BGB): sofort beenden, erstatten (abzüglich genutzter Tage bei sofortigem Beginn)
  async function requestWithdraw(content) {
    const receivedAt = now();
    const subs = await match(content);
    if (!subs.length) {
      await recordEvent('widerruf', content, null, 'kein Vertrag gefunden');
      await notifyOperator('Widerruf ohne passenden Vertrag', [`Eingang ${receivedAt.toISOString()}`, `Vertragsnummer: ${content.number || '–'}`]);
      return { receivedAt };
    }
    for (const sub of subs) {
      if (!withinWithdrawal(sub, receivedAt)) {
        await recordEvent('widerruf', content, sub, 'nach Ablauf der Widerrufsfrist eingegangen, wird geprüft');
        await notifyOperator('Widerruf nach Ablauf der Frist', [`Abo ${sub.number}`, `Beginn ${sub.startedAt ? new Date(sub.startedAt).toISOString() : '–'}`]);
        await send(sub.email, withdrawalMail({ content, receivedAt, sub, origin, refundCent: null, refundDone: false }));
        continue;
      }
      if (sub.providerId) {
        try {
          await provider.cancel(sub.providerId, `Widerruf ${sub.number}`);
        } catch (err) {
          await notifyOperator('Widerruf: Kündigung beim Zahlungsanbieter fehlgeschlagen', [`Abo ${sub.number}`, err.message]);
        }
      }
      const updated = await update(sub.id, { status: 'withdrawn', withdrawnAt: receivedAt, endsAt: receivedAt });
      const [paid] = await db.select().from(payment).where(and(eq(payment.subscriptionId, sub.id), eq(payment.kind, 'payment'))).orderBy(desc(payment.paidAt)).limit(1);
      let refundCent = null;
      let refundDone = false;
      if (paid) {
        refundCent = refundOnWithdraw({ paidCent: paid.grossCent, startedAt: sub.startedAt, now: receivedAt, immediateStart: sub.immediateStart });
        try {
          const { refundId } = await provider.refund(paid.providerPaymentId, refundCent, `widerruf-${sub.id}`);
          await recordPayment(sub, { paymentId: paid.providerPaymentId, refundId, grossCent: refundCent, currency: paid.currency, at: receivedAt }, 'refund');
          refundDone = true;
        } catch (err) {
          await notifyOperator('Erstattung fehlgeschlagen', [`Abo ${sub.number}`, `Betrag ${refundCent} Cent`, err.message]);
        }
      } else await notifyOperator('Widerruf ohne gebuchte Zahlung', [`Abo ${sub.number}`, 'Erstattung von Hand prüfen']);
      await recordEvent('widerruf', content, sub, refundDone ? `widerrufen, ${refundCent} Cent erstattet` : 'widerrufen, Erstattung offen');
      await send(updated.email, withdrawalMail({ content, receivedAt, sub: updated, origin, refundCent, refundDone }));
    }
    return { receivedAt };
  }

  // Konto gelöscht: Abbuchungen beenden, Zugang endet sofort. Vertrag und Zahlungen bleiben (Aufbewahrung).
  async function onAccountDeleted(userId) {
    const rows = await db.select().from(subscription).where(and(eq(subscription.userId, userId), inArray(subscription.status, ['pending', ...OPEN])));
    for (const sub of rows) {
      if (sub.providerId && sub.status !== 'cancelled') {
        try {
          await provider.cancel(sub.providerId, `Konto gelöscht ${sub.number}`);
        } catch (err) {
          await notifyOperator('Konto gelöscht: Kündigung beim Zahlungsanbieter fehlgeschlagen', [`Abo ${sub.number}`, err.message]);
        }
      }
      await update(sub.id, { status: sub.status === 'pending' ? 'expired' : 'cancelled', cancelRequestedAt: sub.cancelRequestedAt || now(), endsAt: now() });
    }
    return rows.length;
  }

  async function entitled(userId) {
    return hasAccess(await latestFor(userId), now());
  }

  async function overview(userId) {
    const sub = await latestFor(userId);
    const payments = sub ? await db.select().from(payment).where(eq(payment.subscriptionId, sub.id)).orderBy(desc(payment.paidAt)) : [];
    return { sub, payments };
  }

  async function exportFor(userId) {
    const subs = await db.select().from(subscription).where(eq(subscription.userId, userId)).orderBy(desc(subscription.createdAt));
    const ids = subs.map((s) => s.id);
    const payments = ids.length ? await db.select().from(payment).where(inArray(payment.subscriptionId, ids)).orderBy(desc(payment.paidAt)) : [];
    return { subs, payments };
  }

  return { provider, now, start, confirmReturn, sync, applyEvent, requestCancel, requestWithdraw, onAccountDeleted, entitled, overview, exportFor, latestFor };
}
