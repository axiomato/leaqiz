'use strict';

// Gemeinsame Helfer für Host und Spieler. Nutzerinhalte landen nur über
// textContent im DOM (nie innerHTML) – Schutz vor eingeschleustem HTML.

window.LQ = (function () {
  const APP_NAME = 'leaqizz';
  const LETTERS = ['A', 'B', 'C', 'D'];
  const numberFormat = new Intl.NumberFormat('de-DE');

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (value === true) el.setAttribute(key, '');
        else el.setAttribute(key, String(value));
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  // Avatar als SVG (avatar.js zeichnet nur aus eigenen Bausteinen). Fehlt ein gültiger Avatar
  // (älteres gesichertes Spiel), entsteht er aus dem Namen.
  function avatar(code, name = '', cls = '') {
    const A = window.LeaqizAvatar;
    const el = document.createElement('span');
    el.className = cls ? `avatar-pic ${cls}` : 'avatar-pic';
    el.setAttribute('aria-hidden', 'true');
    if (!A) return el;
    const c = A.isAvatar(code) ? code : A.fromName(name);
    el.dataset.av = c.join('.');
    el.innerHTML = A.render(c);
    return el;
  }

  function num(n) {
    return numberFormat.format(n);
  }

  // Antwort-Kachel: Farbe + Buchstabe + Text (Farbe ist nie das einzige Merkmal).
  function optionTile(tag, text, i, attrs = {}) {
    return h(
      tag,
      { class: 'opt', dataset: { i: String(i) }, ...attrs },
      h('span', { class: 'opt__letter', 'aria-hidden': 'true', text: LETTERS[i] }),
      h('span', { class: 'opt__text' }, h('span', { class: 'visually-hidden', text: `Antwort ${LETTERS[i]}: ` }), text),
    );
  }

  // Zeitanzeige aus der Restzeit des Servers (keine Abhängigkeit von Uhren-Abweichungen).
  function startTimer({ remainingMs, totalMs, numberEl, fillEl, onSecond }) {
    const end = performance.now() + remainingMs;
    let frame = 0;
    let lastShown = null;
    function tick() {
      const left = Math.max(0, end - performance.now());
      const seconds = Math.ceil(left / 1000);
      if (seconds !== lastShown) {
        if (numberEl) numberEl.textContent = String(seconds);
        if (onSecond && lastShown !== null) onSecond(seconds);
        lastShown = seconds;
      }
      if (fillEl) fillEl.style.transform = `scaleX(${totalMs > 0 ? left / totalMs : 0})`;
      if (left > 0) frame = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(frame);
  }

  // ---------- Bewegung ----------
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Zahl zählt von „from“ auf „to“ hoch (ease-out). Bei reduzierter Bewegung sofort der Endwert.
  // Screenreader lesen über aria-label immer den Endwert.
  function countUp(el, from, to, { ms = 700, delay = 0, prefix = '' } = {}) {
    const text = (v) => `${prefix}${num(v)}`;
    el.setAttribute('aria-label', text(to));
    if (reducedMotion() || from === to) {
      el.textContent = text(to);
      return () => {};
    }
    el.textContent = text(from);
    let raf = 0;
    const timer = setTimeout(() => {
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / ms);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = text(Math.round(from + (to - from) * eased));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      el.textContent = text(to);
    };
  }

  // Einmaliger Puls (z. B. jede der letzten Sekunden): Klasse neu setzen startet die Animation neu
  function pulse(el) {
    if (!el || reducedMotion()) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  // Auszeichnungen: gleiche Namen und Texte auf Leinwand und Handy.
  const AWARD_TITLES = { fastest: 'Schnellste Antwort', streak: 'Längste Serie', jump: 'Aufholjagd', perfect: 'Fehlerfrei' };

  // Feste Farbe je Auszeichnung (Antwortfarben 0–3), gleich auf Leinwand und Handy
  const AWARD_COLOR = { fastest: 0, streak: 1, jump: 2, perfect: 3 };

  function awardColor(key) {
    return AWARD_COLOR[key] ?? 0;
  }

  function awardTitle(key) {
    return AWARD_TITLES[key] || key;
  }

  function awardDetail(a) {
    switch (a.key) {
      case 'fastest':
        return `In ${(a.value / 1000).toFixed(1).replace('.', ',')} Sekunden richtig`;
      case 'streak':
        return `${a.value} richtige Antworten in Folge`;
      case 'jump':
        return `${a.value} ${a.value === 1 ? 'Platz' : 'Plätze'} in einer Runde nach vorn`;
      case 'perfect':
        return `Alle ${a.value} Fragen richtig`;
      default:
        return '';
    }
  }

  // Hinweis „Doppelte Punkte“ (groß im Countdown, klein während der Frage)
  function doubleBadge(small) {
    return h(
      'p',
      { class: `double${small ? ' double--small' : ''}` },
      h('span', { class: 'double__x num', 'aria-hidden': 'true', text: '×2' }),
      h('span', { class: 'double__label', text: 'Doppelte Punkte' }),
    );
  }

  // Flammen-Symbol für Serien (SVG, Farbe über currentColor)
  function flameIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'flame');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M8 0c1 3.5 6 6.2 6 11.6A6 6 0 0 1 2 11.6c0-2.4 1-4 2.4-5.4.2 1.9 1 3 2.2 3.5C6 6.5 6.8 3 8 0Z');
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  }

  function store(kind) {
    const area = kind === 'local' ? window.localStorage : window.sessionStorage;
    return {
      get(key, fallback = null) {
        try {
          const raw = area.getItem(key);
          return raw === null ? fallback : JSON.parse(raw);
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          area.setItem(key, JSON.stringify(value));
          return true;
        } catch {
          return false;
        }
      },
      remove(key) {
        try {
          area.removeItem(key);
        } catch {
          /* Speicher nicht verfügbar */
        }
      },
    };
  }

  let toastTimer = 0;
  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.textContent = '';
    }, 4500);
  }

  // Kurze Ansage für Screenreader, ohne den Bildschirm zu verändern.
  function announce(message) {
    const el = document.getElementById('live');
    if (!el) return;
    el.textContent = '';
    setTimeout(() => {
      el.textContent = message;
    }, 50);
  }

  function emit(socket, event, payload) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) resolve({ ok: false, error: 'Keine Antwort vom Server. Bitte Verbindung prüfen.' });
      }, 8000);
      socket.emit(event, payload || {}, (res) => {
        done = true;
        clearTimeout(timer);
        resolve(res || { ok: false, error: 'Unbekannter Fehler.' });
      });
    });
  }

  // CSV für Excel (Semikolon, UTF-8 mit BOM). Formeln werden entschärft.
  function toCsv(rows) {
    const cell = (v) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    return String.fromCharCode(0xfeff) + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Bildschirm während des Spiels wach halten (wo der Browser es erlaubt).
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      wakeLock = null;
    }
  }

  return { APP_NAME, LETTERS, h, avatar, num, optionTile, startTimer, reducedMotion, countUp, pulse, awardTitle, awardDetail, awardColor, flameIcon, doubleBadge, store, toast, announce, emit, toCsv, download, keepAwake };
})();
