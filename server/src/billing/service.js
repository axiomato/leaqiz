// Abo-Logik: Abschluss, Abgleich mit dem Zahlungsanbieter, Kündigung, Widerruf, Erinnerung, Konto löschen.
// Maßgeblich ist immer der Zahlungsanbieter (Abfrage oder geprüfte Benachrichtigung), nie der Browser.
//
// Zwei Tarife (angebot.js): Monatsabo = Abo beim Zahlungsanbieter (wiederkehrend),
// Jahrespass = einmalige Zahlung (Bestellung), gilt zwölf Monate, endet von selbst.
import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { contractEvent, payment, providerEvent, subscription } from '../db/schema.js';
import { ANGEBOT, TARIFE, addMonths, cancelEnd, hasAccess, isTarif, refundOnWithdraw, tarifOf, vatOf, withinWithdrawal } from './angebot.js';
import { cancellationMail, contractConfirmationMail, datum, operatorMail, reminderMail, withdrawalMail } from './mails.js';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const code = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
export const newNumber = () => `LQ-${code(4)}-${code(4)}`;
export const normalizeNumber = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^LQ/, '');
const isUnique = (err) => err && (err.code === '23505' || (err.cause && err.cause.code === '23505'));

const DAY = 86_400_000;
// Verträge, die Kündigung oder Widerruf betreffen können
const OPEN = ['active', 'suspended', 'cancelled'];
const RUNNING = ['active', 'cancelled'];

// Ende des Zugangs eines Vertrags; null = läuft weiter (Monatsabo, nicht gekündigt)
const endOf = (sub) => (sub.endsAt ? new Date(sub.endsAt) : sub.status === 'cancelled' && sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null);

export class AboError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Darf diese Person jetzt einen Tarif kaufen? null = ja, sonst der Grund (für Oberfläche und Server gleich).
// Monatsabo nur ohne laufenden Zugang; Jahrespass auch zum Verlängern, frühestens 30 Tage vor dem Ende.
export function purchaseBlock(rows, plan, now = new Date()) {
  if (rows.some((r) => r.status === 'suspended')) return 'Dein Monatsabo ist pausiert, weil eine Zahlung nicht geklappt hat. Prüfe dein PayPal-Konto oder kündige es zuerst.';
  const running = rows.filter((r) => RUNNING.includes(r.status) && (hasAccess(r, now) || (r.startedAt && new Date(r.startedAt) > now)));
  if (running.some((r) => !endOf(r))) return 'Du hast schon ein Monatsabo.';
  const end = running.map(endOf).reduce((a, b) => (a && a > b ? a : b), null);
  if (!end || end <= now) return null;
  if (plan === 'monat') return `Du hast Zugang bis ${datum(end)}. Das Monatsabo kannst du danach abschließen.`;
  if (end - now > ANGEBOT.verlaengernTage * DAY) return `Verlängern kannst du ab ${datum(new Date(end - ANGEBOT.verlaengernTage * DAY))}.`;
  return null;
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

  // Abgeschlossene Verträge einer Person, neueste zuerst
  async function contracts(userId) {
    if (!userId) return [];
    return db.select().from(subscription).where(and(eq(subscription.userId, userId), sql`${subscription.status} <> 'pending'`)).orderBy(desc(subscription.createdAt)).limit(20);
  }

  async function latestFor(userId) {
    const rows = await contracts(userId);
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

  // Monatsabo: Stand beim Zahlungsanbieter übernehmen. Wird es zum ersten Mal aktiv: Vertragsbestätigung.
  async function syncSubscription(row) {
    const remote = await provider.get(row.providerId);
    if (provider.planId && remote.planId && remote.planId !== provider.planId) {
      await notifyOperator('Unbekannter Plan', [`Abo ${row.number}: Plan ${remote.planId} statt ${provider.planId}`]);
      return row;
    }
    const values = {};
    const firstActivation = remote.status === 'active' && !row.startedAt;
    if (firstActivation) {
      values.concludedAt = now();
      values.startedAt = remote.startedAt && remote.startedAt <= now() ? remote.startedAt : now();
    }
    if (remote.nextBillingAt) values.currentPeriodEnd = remote.nextBillingAt;
    else if (firstActivation) values.currentPeriodEnd = addMonths(values.startedAt, TARIFE.monat.laufzeitMonate);
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

  // Jahrespass: Bestellung abschließen (Zahlung einziehen, falls zugestimmt), dann Vertrag aktiv.
  // Rückkehr und Benachrichtigung können gleichzeitig kommen: aktiv wird der Vertrag nur einmal.
  async function settleOrder(row) {
    if (row.status !== 'pending') return row;
    let order = await provider.getOrder(row.providerId);
    if (order.status === 'approved') order = await provider.captureOrder(row.providerId, `capture-${row.id}`);
    const cap = order.capture;
    if (order.status !== 'completed' || !cap || cap.status !== 'completed') {
      if (cap && cap.status === 'pending') await notifyOperator('Zahlung des Jahrespasses noch offen', [`Vertrag ${row.number}`, `Zahlung ${cap.paymentId}`]);
      return row;
    }
    const concludedAt = now();
    // Verlängerung: der neue Pass schließt an den laufenden Zugang an
    const others = (await contracts(row.userId)).filter((r) => r.id !== row.id && RUNNING.includes(r.status));
    const prevEnd = others.map(endOf).filter((d) => d && d > concludedAt).reduce((a, b) => (a && a > b ? a : b), null);
    const startedAt = prevEnd || concludedAt;
    const [updated] = await db
      .update(subscription)
      .set({ status: 'active', concludedAt, startedAt, endsAt: addMonths(startedAt, TARIFE.jahr.laufzeitMonate), updatedAt: now() })
      .where(and(eq(subscription.id, row.id), eq(subscription.status, 'pending')))
      .returning();
    if (!updated) return (await byProviderId(row.providerId)) || row;
    await recordPayment(updated, { paymentId: cap.paymentId, grossCent: cap.grossCent, currency: cap.currency, at: cap.at || concludedAt }, 'payment');
    if (cap.grossCent !== TARIFE.jahr.preisCent) await notifyOperator('Betrag des Jahrespasses weicht ab', [`Vertrag ${row.number}`, `${cap.grossCent} Cent`]);
    await send(updated.email, contractConfirmationMail(updated, origin));
    return updated;
  }

  async function sync(providerId) {
    const row = await byProviderId(providerId);
    if (!row) return null;
    return tarifOf(row).id === 'jahr' ? settleOrder(row) : syncSubscription(row);
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
      if ((ev.kind === 'subscription' || ev.kind === 'order') && ev.providerId) await sync(ev.providerId);
      else if (ev.kind === 'failed' && ev.providerId) {
        const sub = await byProviderId(ev.providerId);
        if (sub) await notifyOperator('Zahlung fehlgeschlagen', [`Abo ${sub.number}`]);
        await sync(ev.providerId);
      } else if (ev.kind === 'payment' && ev.providerId) {
        const sub = await byProviderId(ev.providerId);
        if (!sub) await notifyOperator('Zahlung ohne Vertrag', [`Zahlung ${ev.paymentId} für ${ev.providerId}`]);
        else if (tarifOf(sub).id === 'jahr' && sub.status === 'pending') await settleOrder(sub);
        else {
          await recordPayment(sub, ev, 'payment');
          if (tarifOf(sub).id === 'monat') await syncSubscription(sub);
        }
      } else if (ev.kind === 'refund' || ev.kind === 'reversal') {
        const sub = await subscriptionForPayment(ev.paymentId);
        if (sub) await recordPayment(sub, ev, ev.kind);
        if (ev.kind === 'reversal') await notifyOperator('Zahlung zurückgebucht', [`Zahlung ${ev.paymentId}${sub ? `, Vertrag ${sub.number}` : ''}`]);
      }
    } catch (err) {
      // Nicht als verarbeitet merken: der Anbieter schickt die Benachrichtigung erneut
      await db.delete(providerEvent).where(eq(providerEvent.id, ev.id));
      throw err;
    }
    return true;
  }

  // Abschluss starten: Vertrag „pending“ anlegen, Zustimmung beim Zahlungsanbieter
  async function start(user, { immediateStart, plan }) {
    if (!isTarif(plan)) throw new AboError('Bitte wähle Monatsabo oder Jahrespass.');
    if (!immediateStart) throw new AboError('Bitte bestätige, dass leaqizz sofort starten soll.');
    const blocked = purchaseBlock(await contracts(user.id), plan, now());
    if (blocked) throw new AboError(blocked, 409);
    let row;
    for (let attempt = 0; attempt < 5 && !row; attempt += 1) {
      try {
        [row] = await db.insert(subscription).values({ number: newNumber(), userId: user.id, email: user.email, provider: provider.name, plan, status: 'pending', immediateStart: true }).returning();
      } catch (err) {
        if (!isUnique(err)) throw err;
      }
    }
    const urls = { returnUrl: `${origin}/abo/zurueck/`, cancelUrl: `${origin}/abo/abgebrochen/` };
    const created =
      plan === 'jahr'
        ? await provider.createOrder({ customId: row.id, amountCent: TARIFE.jahr.preisCent, description: `leaqizz ${TARIFE.jahr.name} (12 Monate), ${row.number}`, ...urls })
        : await provider.create({ customId: row.id, email: user.email, ...urls });
    await update(row.id, { providerId: created.providerId });
    return { approveUrl: created.approveUrl, number: row.number };
  }

  // Rückkehr von der Zustimmung: nur eigene Verträge abgleichen
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
      const pass = tarifOf(sub).id === 'jahr';
      if (sub.cancelRequestedAt && sub.endsAt) {
        await recordEvent('kuendigung', content, sub, `bereits gekündigt, endet am ${datum(sub.endsAt)}`);
        await send(sub.email, cancellationMail({ content, receivedAt, endsAt: sub.endsAt, sub, origin, note: 'Der Vertrag war bereits gekündigt.' }));
        continue;
      }
      const endsAt = cancelEnd(sub, receivedAt);
      const wish = content.datum ? new Date(content.datum) : null;
      let note = '';
      if (content.art === 'ausserordentlich') note = 'Den Grund für die außerordentliche Kündigung prüfen wir und melden uns, falls der Vertrag früher endet.';
      else if (wish && wish > endsAt) note = `Dein Wunschtermin (${datum(wish)}) liegt nach dem nächstmöglichen Ende. Wir melden uns dazu.`;
      else if (pass && wish && wish < endsAt) note = 'Der Jahrespass ist für zwölf Monate bezahlt und endet zum vereinbarten Tag. Ein früheres Ende gibt es nur bei einer außerordentlichen Kündigung.';
      if (!pass && sub.providerId) {
        try {
          await provider.cancel(sub.providerId, `Kündigung ${sub.number}`);
        } catch (err) {
          await notifyOperator('Kündigung beim Zahlungsanbieter fehlgeschlagen', [`Abo ${sub.number}`, err.message]);
        }
      }
      const updated = await update(sub.id, { status: 'cancelled', cancelRequestedAt: receivedAt, endsAt });
      await recordEvent('kuendigung', content, sub, `endet am ${datum(endsAt)}`);
      if (note) await notifyOperator('Kündigung mit Hinweis', [`Vertrag ${sub.number}`, note]);
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
      const plan = tarifOf(sub).id;
      if (!withinWithdrawal(sub, receivedAt)) {
        await recordEvent('widerruf', content, sub, 'nach Ablauf der Widerrufsfrist eingegangen, wird geprüft');
        await notifyOperator('Widerruf nach Ablauf der Frist', [`Vertrag ${sub.number}`, `Vertragsschluss ${sub.concludedAt ? new Date(sub.concludedAt).toISOString() : '–'}`]);
        await send(sub.email, withdrawalMail({ content, receivedAt, sub, origin, refundCent: null, refundDone: false }));
        continue;
      }
      if (plan === 'monat' && sub.providerId) {
        try {
          await provider.cancel(sub.providerId, `Widerruf ${sub.number}`);
        } catch (err) {
          await notifyOperator('Widerruf: Kündigung beim Zahlungsanbieter fehlgeschlagen', [`Abo ${sub.number}`, err.message]);
        }
      }
      // Bezahlte Zeit vor dem Beenden merken: Jahrespass bis zu seinem Ende, Monatsabo bis zur nächsten Abbuchung
      const periodEnd = plan === 'jahr' ? sub.endsAt : sub.currentPeriodEnd;
      const updated = await update(sub.id, { status: 'withdrawn', withdrawnAt: receivedAt, endsAt: receivedAt });
      const [paid] = await db.select().from(payment).where(and(eq(payment.subscriptionId, sub.id), eq(payment.kind, 'payment'))).orderBy(desc(payment.paidAt)).limit(1);
      let refundCent = null;
      let refundDone = false;
      if (paid) {
        refundCent = refundOnWithdraw({ paidCent: paid.grossCent, startedAt: sub.startedAt, periodEnd, now: receivedAt, immediateStart: sub.immediateStart });
        try {
          const { refundId } = await provider.refund(paid.providerPaymentId, refundCent, `widerruf-${sub.id}`, { plan });
          await recordPayment(sub, { paymentId: paid.providerPaymentId, refundId, grossCent: refundCent, currency: paid.currency, at: receivedAt }, 'refund');
          refundDone = true;
        } catch (err) {
          await notifyOperator('Erstattung fehlgeschlagen', [`Vertrag ${sub.number}`, `Betrag ${refundCent} Cent`, err.message]);
        }
      } else await notifyOperator('Widerruf ohne gebuchte Zahlung', [`Vertrag ${sub.number}`, 'Erstattung von Hand prüfen']);
      await recordEvent('widerruf', content, sub, refundDone ? `widerrufen, ${refundCent} Cent erstattet` : 'widerrufen, Erstattung offen');
      await send(updated.email, withdrawalMail({ content, receivedAt, sub: updated, origin, refundCent, refundDone }));
    }
    return { receivedAt };
  }

  // Jahrespass: Erinnerung vor dem Ende, einmal je Pass. Ist schon ein Anschluss gekauft, keine Mail.
  async function remindExpiring() {
    const at = now();
    const due = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.plan, 'jahr'),
          inArray(subscription.status, RUNNING),
          isNull(subscription.reminderSentAt),
          isNotNull(subscription.userId),
          gt(subscription.endsAt, at),
          lte(subscription.endsAt, new Date(at.getTime() + ANGEBOT.erinnerungTage * DAY)),
        ),
      );
    let sent = 0;
    for (const sub of due) {
      const [claimed] = await db.update(subscription).set({ reminderSentAt: at, updatedAt: at }).where(and(eq(subscription.id, sub.id), isNull(subscription.reminderSentAt))).returning();
      if (!claimed) continue;
      const followUp = (await contracts(sub.userId)).some((r) => r.id !== sub.id && RUNNING.includes(r.status) && r.startedAt && new Date(r.startedAt) >= new Date(sub.endsAt) - 60_000);
      if (followUp) continue;
      await send(sub.email, reminderMail(sub, origin));
      sent += 1;
    }
    return sent;
  }

  // Konto gelöscht: Abbuchungen beenden, Zugang endet sofort. Vertrag und Zahlungen bleiben (Aufbewahrung).
  async function onAccountDeleted(userId) {
    const rows = await db.select().from(subscription).where(and(eq(subscription.userId, userId), inArray(subscription.status, ['pending', ...OPEN])));
    for (const sub of rows) {
      if (tarifOf(sub).id === 'monat' && sub.providerId && sub.status !== 'cancelled') {
        try {
          await provider.cancel(sub.providerId, `Konto gelöscht ${sub.number}`);
        } catch (err) {
          await notifyOperator('Konto gelöscht: Kündigung beim Zahlungsanbieter fehlgeschlagen', [`Abo ${sub.number}`, err.message]);
        }
      }
      if (sub.status !== 'pending' && sub.startedAt && new Date(sub.startedAt) > now()) {
        await notifyOperator('Konto gelöscht mit noch nicht begonnenem Jahrespass', [`Vertrag ${sub.number}`, 'Erstattung von Hand prüfen']);
      }
      await update(sub.id, { status: sub.status === 'pending' ? 'expired' : 'cancelled', cancelRequestedAt: sub.cancelRequestedAt || now(), endsAt: now() });
    }
    return rows.length;
  }

  async function entitled(userId) {
    return (await contracts(userId)).some((r) => hasAccess(r, now()));
  }

  // Für die Kontoansicht: laufender Vertrag, ein schon gekaufter Anschluss, Zahlungen, was gekauft werden kann
  async function overview(userId) {
    const rows = await contracts(userId);
    const at = now();
    const sub = rows.find((r) => hasAccess(r, at)) || rows.find((r) => r.status === 'suspended') || rows[0] || null;
    const next = rows.find((r) => r !== sub && RUNNING.includes(r.status) && r.startedAt && new Date(r.startedAt) > at) || null;
    const ids = [sub, next].filter(Boolean).map((r) => r.id);
    const payments = ids.length ? await db.select().from(payment).where(inArray(payment.subscriptionId, ids)).orderBy(desc(payment.paidAt)) : [];
    const blocked = Object.fromEntries(Object.keys(TARIFE).map((plan) => [plan, purchaseBlock(rows, plan, at)]));
    return { sub, next, payments, blocked };
  }

  async function exportFor(userId) {
    const subs = await db.select().from(subscription).where(eq(subscription.userId, userId)).orderBy(desc(subscription.createdAt));
    const ids = subs.map((s) => s.id);
    const payments = ids.length ? await db.select().from(payment).where(inArray(payment.subscriptionId, ids)).orderBy(desc(payment.paidAt)) : [];
    return { subs, payments };
  }

  return { provider, now, start, confirmReturn, sync, applyEvent, requestCancel, requestWithdraw, remindExpiring, onAccountDeleted, entitled, overview, exportFor, latestFor };
}
