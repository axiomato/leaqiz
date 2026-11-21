'use strict';

// Gemeinsame Helfer für Host und Spieler. Nutzerinhalte landen nur über
// textContent im DOM (nie innerHTML) – Schutz vor eingeschleustem HTML.

window.QR = (function () {
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
  function startTimer({ remainingMs, totalMs, numberEl, fillEl }) {
    const end = performance.now() + remainingMs;
    let frame = 0;
    let lastShown = null;
    function tick() {
      const left = Math.max(0, end - performance.now());
      const seconds = Math.ceil(left / 1000);
      if (numberEl && seconds !== lastShown) {
        numberEl.textContent = String(seconds);
        lastShown = seconds;
      }
      if (fillEl) fillEl.style.transform = `scaleX(${totalMs > 0 ? left / totalMs : 0})`;
      if (left > 0) frame = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(frame);
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

  return { LETTERS, h, num, optionTile, startTimer, store, toast, announce, emit, toCsv, download, keepAwake };
})();
