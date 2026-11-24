'use strict';

// Quizze und Ergebnisse im Konto der Lehrkraft (nur mit eigenem Server): /api/quizzes, /api/results.
// Ohne Server (GitHub Pages) wird nichts davon aufgerufen; die Bibliothek bleibt im Browser.

window.LQQuizApi = (function () {
  const server = () => (window.LEAQIZ_CONFIG && window.LEAQIZ_CONFIG.server) || null;
  const url = (path) => new URL(`${server().api}${path}`, location.href).href;

  const MESSAGES = {
    401: 'Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.',
    404: 'Dieses Quiz gibt es nicht mehr. Es wurde vielleicht auf einem anderen Gerät gelöscht.',
    413: 'Das ist zu viel auf einmal. Bitte weniger Quizze übernehmen.',
    429: 'Zu viele Anfragen. Bitte warte einen Moment.',
  };

  async function call(path, { method = 'GET', body, messages = {} } = {}) {
    let res;
    try {
      res = await fetch(url(path), {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        // DELETE ohne Body, also ohne Content-Type
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Keine Verbindung zum Server. Bitte Internet prüfen und erneut versuchen.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* leere Antwort (204) */
    }
    if (!res.ok) {
      const message = messages[res.status] || MESSAGES[res.status] || (data && data.error) || 'Das hat nicht geklappt. Bitte erneut versuchen.';
      throw Object.assign(new Error(message), { status: res.status });
    }
    return data;
  }

  const RESULT_GONE = 'Dieses Ergebnis gibt es nicht mehr. Es wurde gelöscht oder die Löschfrist ist abgelaufen.';

  // Nur die Felder, die der Server speichert
  const body = (quiz) => ({ title: quiz.title, questions: quiz.questions });

  return {
    async list() {
      return (await call('quizzes')).quizzes;
    },
    async create(quiz) {
      return (await call('quizzes', { method: 'POST', body: body(quiz) })).quiz;
    },
    async update(id, quiz) {
      return (await call(`quizzes/${encodeURIComponent(id)}`, { method: 'PUT', body: body(quiz) })).quiz;
    },
    async remove(id) {
      await call(`quizzes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    // items: [{ localId?, title, questions }]; Antwort { imported, skipped, invalid }
    async importMany(items) {
      return call('quizzes/import', { method: 'POST', body: { quizzes: items } });
    },
    // Abo (nur wenn der Server einen Zahlungsweg hat): Stand und Abschluss
    abo: {
      async get() {
        return call('abo');
      },
      // tarif: 'monat' | 'jahr'. Antwort { approveUrl, number }: weiter zur Zustimmung beim Zahlungsanbieter.
      // Bei 409 nennt der Server den Grund (z. B. „Verlängern kannst du ab …“).
      async start(tarif) {
        return call('abo/start', { method: 'POST', body: { sofortBeginnen: true, tarif } });
      },
    },
    // Ergebnisse vergangener Live-Spiele (gelöscht nach der Löschfrist des Servers)
    results: {
      async list() {
        return call('results');
      },
      async get(id) {
        return (await call(`results/${encodeURIComponent(id)}`, { messages: { 404: RESULT_GONE } })).result;
      },
      async remove(id) {
        await call(`results/${encodeURIComponent(id)}`, { method: 'DELETE', messages: { 404: RESULT_GONE } });
      },
    },
  };
})();
