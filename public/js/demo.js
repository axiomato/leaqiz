'use strict';

// Demo: simulierte Mitspielende. Sie laufen im Browser der Spielleitung, treten der
// Lobby nacheinander bei und antworten mit eigener Trefferquote und eigenem Tempo.
// Sie sprechen direkt mit der Host-Engine (wie eine Verbindung, nur ohne Netz).

window.LQDemo = (function () {
  const NAMES = ['Mila', 'Jonas', 'Aylin', 'Ben', 'Sofia', 'Luca', 'Hannah', 'Elias', 'Lea', 'Finn', 'Emma', 'Noah'];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function createBots({ engine, count = 8 }) {
    const bots = new Map(); // connId -> Bot
    const timers = new Set();
    let seq = 0;
    let stopped = false;

    const later = (ms, fn) => {
      const t = setTimeout(() => {
        timers.delete(t);
        if (!stopped) fn();
      }, ms);
      timers.add(t);
    };

    const request = (bot, ev, p) => {
      seq += 1;
      engine.handle(bot.connId, { k: 'req', id: seq, ev, p });
    };

    NAMES.slice(0, Math.min(count, NAMES.length)).forEach((name, i) => {
      const bot = {
        connId: `bot-${i}`,
        name,
        skill: 0.45 + Math.random() * 0.45, // Wahrscheinlichkeit für richtig
        speed: 0.25 + Math.random() * 0.6, // Anteil der Zeit, die sie im Schnitt brauchen
        answeredFor: -1,
      };
      bots.set(bot.connId, bot);
      later(900 + i * 650 + Math.random() * 400, () => {
        engine.attach(bot.connId);
        request(bot, 'player:join', { nickname: name });
      });
    });

    // Zustand, den die Engine an einen Bot schickt
    function receive(connId, msg) {
      const bot = bots.get(connId);
      if (!bot || !msg || msg.k !== 'state' || !msg.d) return;
      const s = msg.d;
      if (s.state !== 'question' || s.answered || bot.answeredFor === s.qIndex) return;
      bot.answeredFor = s.qIndex;
      if (Math.random() < 0.05) return; // ab und zu keine Antwort
      const limitMs = s.question.timeLimit * 1000;
      const think = (0.15 + Math.random() * 0.85) * bot.speed * limitMs + 500;
      const delay = Math.max(300, Math.min(s.remainingMs - 400, think));
      later(delay, () => {
        const g = engine.game;
        if (g.state !== 'question' || g.qIndex !== s.qIndex) return;
        // Bots „wissen“ die Lösung mit ihrer Trefferquote (sie laufen im Host)
        const q = g.question;
        const wrong = q.options.map((_, i) => i).filter((i) => !q.correct.includes(i));
        const choice = Math.random() < bot.skill || !wrong.length ? pick(q.correct) : pick(wrong);
        request(bot, 'player:answer', { choice });
      });
    }

    return {
      has: (connId) => bots.has(connId),
      receive,
      stop() {
        stopped = true;
        timers.forEach(clearTimeout);
        timers.clear();
      },
    };
  }

  return { createBots };
})();
