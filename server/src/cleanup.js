// Abgelaufene Anmeldungen und Anmeldelinks löschen (Datensparsamkeit).
// Better Auth prüft das Ablaufdatum bei jeder Anfrage, räumt abgelaufene Einträge aber nicht
// vollständig weg. Dieser Lauf entfernt Sitzungen nach Ablauf (30 Tage ohne Nutzung) und
// Anmeldelinks, die nie benutzt wurden (15 Minuten), samt der darin stehenden E-Mail-Adresse.
import { lt } from 'drizzle-orm';
import { session, verification } from './db/schema.js';

export async function deleteExpired(db, now = new Date()) {
  const sessions = await db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id });
  const links = await db.delete(verification).where(lt(verification.expiresAt, now)).returning({ id: verification.id });
  return { sessions: sessions.length, links: links.length };
}

export function startCleanup(db, log, everyMs = 3600_000) {
  const run = async () => {
    try {
      const n = await deleteExpired(db);
      if (n.sessions || n.links) log.info(`${n.sessions} abgelaufene Anmeldungen und ${n.links} abgelaufene Anmeldelinks gelöscht.`);
    } catch (err) {
      log.error(`Aufräumen der Anmeldungen fehlgeschlagen: ${err.message}`);
    }
  };
  run();
  const timer = setInterval(run, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
