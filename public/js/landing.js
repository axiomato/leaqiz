'use strict';

// leaqizz – Landingpage für Lehrkräfte
// Bewegung mit Aufgabe: Hero zeigt eine Runde (Tippen → Flut → Zwischenstand), die Quizfrage
// löst auf Antippen auf, Ablauf und Podest bauen sich einmal beim Hineinscrollen auf.
// „Bewegung reduzieren“: alles steht sofort im Endzustand, die Hero-Schleife läuft nicht.

(function () {
  document.documentElement.classList.add('js');

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reduceQuery.matches;
  const fmt = (n) => Math.round(n).toLocaleString('de-DE');

  function countUp(el, from, to, { ms = 700, prefix = '' } = {}) {
    if (!el) return;
    if (reduced()) {
      el.textContent = prefix + fmt(to);
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------- Hero: eine Runde als Schleife ----------

  const demo = $('#demo');
  if (demo) {
    const scene = $('.demo__scene', demo);
    const screen = $('.phone__screen', demo);
    const tileB = $('[data-tile-b]', demo);
    const grow = $('.ph-grow', demo);
    const tap = $('.tap', demo);
    const count = $('[data-count]', demo);
    const dots = $$('[data-dots] i', demo);
    const pts = $('[data-pts]', demo);
    const rows = $$('[data-rows] li', demo);
    const pauseBtn = $('#demo-pause');

    const BEFORE = { Mila: [0, 982], Emil: [1, 968], Aylin: [2, 960], Sofia: [3, 942], Jonas: [4, 310] };
    const AFTER = { Emil: [0, 2024, 1], Sofia: [1, 1989, 2], Mila: [2, 982, 0], Jonas: [3, 970, 1], Aylin: [4, 960, 0] };

    let timers = [];
    let anims = [];
    let running = false;
    let userPaused = false;
    let inView = false;

    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const setStep = (step) => {
      demo.dataset.step = step;
    };

    function setBoard(state, animate) {
      rows.forEach((li) => {
        const name = li.dataset.name;
        const [rank, points, up] = state[name];
        li.style.setProperty('--r', String(rank));
        $('.rank', li).textContent = `${rank + 1}.`;
        const ptsEl = $('.pts', li);
        const before = Number(ptsEl.textContent.replace(/\./g, '')) || 0;
        if (animate && before !== points) countUp(ptsEl, before, points, { ms: 800 });
        else ptsEl.textContent = fmt(points);
        $('.up', li).textContent = up ? `▲ ${up}` : '';
        li.classList.toggle('has-up', false);
      });
    }

    function setDots(n) {
      dots.forEach((d, i) => d.classList.toggle('is-done', i < n));
    }

    function tileInset() {
      const s = screen.getBoundingClientRect();
      const r = tileB.getBoundingClientRect();
      return {
        from: `inset(${r.top - s.top}px ${s.right - r.right}px ${s.bottom - r.bottom}px ${r.left - s.left}px round 10px)`,
        cx: r.left + r.width / 2 - scene.getBoundingClientRect().left,
        cy: r.top + r.height / 2 - scene.getBoundingClientRect().top,
      };
    }

    function resetRound() {
      anims.forEach((a) => a.cancel());
      anims = [];
      grow.style.opacity = '0';
      count.textContent = '3';
      setDots(0);
      setBoard(BEFORE, false);
      pts.textContent = '+964';
    }

    function staticFrame() {
      clear();
      resetRound();
      count.textContent = '9';
      setDots(9);
      setStep('reveal');
    }

    function clear() {
      timers.forEach(clearTimeout);
      timers = [];
      running = false;
    }

    function round() {
      running = true;
      resetRound();
      setStep('question');
      // 1) Tippen auf B: Ring, dann wächst das Feld zum ganzen Bildschirm
      at(1100, () => {
        const { from, cx, cy } = tileInset();
        tap.style.left = `${cx}px`;
        tap.style.top = `${cy}px`;
        anims.push(
          tap.animate(
            [
              { opacity: 0.9, transform: 'scale(0.5)' },
              { opacity: 0, transform: 'scale(1.6)' },
            ],
            { duration: 520, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
          ),
        );
        grow.style.opacity = '1';
        anims.push(
          grow.animate([{ clipPath: from }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }], {
            duration: 340,
            delay: 120,
            easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
            fill: 'both',
          }),
        );
      });
      // 2) Gesendet, die anderen antworten
      at(1620, () => {
        setStep('sent');
        setDots(4);
        count.textContent = '4';
      });
      at(1760, () => {
        grow.style.opacity = '0';
      });
      [5, 6, 7, 8, 9].forEach((n, i) =>
        at(2000 + i * 300, () => {
          count.textContent = String(n);
          setDots(n);
        }),
      );
      // 3) Auflösung: Flut wischt über die Leinwand, Punkte am Handy zählen hoch
      at(3800, () => {
        setStep('reveal');
        countUp(pts, 0, 964, { ms: 700, prefix: '+' });
      });
      // 4) Zwischenstand: Zeilen gleiten an neue Plätze, Aufstiege erscheinen
      at(6500, () => setStep('board'));
      at(6900, () => setBoard(AFTER, true));
      at(7600, () => rows.forEach((li) => li.classList.toggle('has-up', Boolean(AFTER[li.dataset.name][2]))));
      // 5) kurz stehen lassen, ausblenden, von vorn
      at(9800, () => setStep('reset'));
      at(10200, () => {
        if (running) round();
      });
    }

    function update() {
      const shouldRun = !reduced() && !userPaused && inView && !document.hidden;
      if (shouldRun && !running) round();
      else if (!shouldRun && running) staticFrame();
    }

    if (reduced()) {
      staticFrame();
    } else {
      pauseBtn.hidden = false;
      pauseBtn.addEventListener('click', () => {
        userPaused = !userPaused;
        pauseBtn.textContent = userPaused ? 'Animation abspielen' : 'Animation anhalten';
        pauseBtn.setAttribute('aria-pressed', String(userPaused));
        update();
      });
      new IntersectionObserver(
        (entries) => {
          inView = entries[0].isIntersecting;
          update();
        },
        { threshold: 0.35 },
      ).observe(scene);
      document.addEventListener('visibilitychange', update);
    }
    reduceQuery.addEventListener('change', () => {
      if (reduced()) {
        pauseBtn.hidden = true;
        staticFrame();
      }
    });
  }

  // ---------- Quizfrage: Antippen flutet die Sektion ----------

  const ask = $('#frage');
  if (ask) {
    const tiles = $$('.ask__tile', ask);
    const live = document.createElement('p');
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');
    ask.append(live);
    const LETTERS = ['A', 'B', 'C', 'D'];

    const reveal = (picked) => {
      if (ask.classList.contains('is-revealed')) return;
      if (picked !== null) tiles[picked].classList.add('is-picked');
      ask.classList.add('is-revealed');
      tiles.forEach((t) => t.setAttribute('aria-disabled', 'true'));
      const right = tiles.findIndex((t) => t.classList.contains('is-right'));
      const yours = picked === null ? '' : picked === right ? 'Genau. ' : `Du hattest ${LETTERS[picked]} gewählt. `;
      live.textContent = `${yours}Richtig ist ${LETTERS[right]}: Eine PIN und ein Spielname.`;
    };

    tiles.forEach((t, i) => t.addEventListener('click', () => reveal(i)));
    $('#ask-skip').addEventListener('click', () => reveal(null));
  }

  // ---------- Einmal beim Hineinscrollen: Ablauf und Podest ----------

  function once(el, cls, threshold, before) {
    if (!el) return;
    if (reduced() || !('IntersectionObserver' in window)) {
      el.classList.add(cls);
      return;
    }
    if (before) el.classList.add(before);
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (before) el.classList.remove(before);
        el.classList.add(cls);
        io.disconnect();
      },
      { threshold },
    );
    io.observe(el);
  }

  once($('#steps'), 'is-in', 0.4);
  once($('#podium'), 'is-in', 0.5, 'is-waiting');

  // ---------- Unterstützen: Betrag → Link zur Bezahlseite ----------

  const donate = $('#donate');
  if (donate) {
    const cfg = (window.LEAQIZ_CONFIG && window.LEAQIZ_CONFIG.donate) || {};
    const safe = (u) => (typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u) ? u : '');
    const note = $('#donate-note');
    const base = 'Freiwillig und einmalig. leaqizz ist nicht gemeinnützig, es gibt keine Spendenquittung.';

    const amountsBox = $('.amounts');
    const hasFixed = Object.values(cfg.amounts || {}).some((u) => safe(u));
    const onlyCustom = !hasFixed && Boolean(safe(cfg.custom));
    // Nur ein Link mit frei wählbarem Betrag: kein Podest, sonst verspräche es einen Betrag, den die Bezahlseite nicht übernimmt
    if (onlyCustom && amountsBox) amountsBox.hidden = true;

    const updateDonate = () => {
      const value = ($('input[name="amount"]:checked') || {}).value || '10';
      if (onlyCustom) {
        donate.href = safe(cfg.custom);
        donate.rel = 'noopener';
        donate.removeAttribute('aria-disabled');
        donate.removeAttribute('role');
        donate.removeAttribute('tabindex');
        donate.textContent = `Mit ${cfg.provider || 'einem Betrag deiner Wahl'} unterstützen`;
        note.textContent = `${base} Den Betrag wählst du bei ${cfg.provider || 'der Bezahlseite'}.`;
        return;
      }
      const fixed = value === 'custom' ? '' : safe(cfg.amounts && cfg.amounts[value]);
      const url = fixed || safe(cfg.custom);
      donate.textContent = value !== 'custom' && (fixed || !url) ? `Mit ${value} € unterstützen` : 'Betrag wählen und unterstützen';
      if (url) {
        donate.href = url;
        donate.rel = 'noopener';
        donate.removeAttribute('aria-disabled');
        donate.removeAttribute('role');
        donate.removeAttribute('tabindex');
        note.textContent = `${base} Die Zahlung läuft über ${cfg.provider || 'einen externen Zahlungsanbieter'}.`;
      } else {
        donate.removeAttribute('href');
        donate.setAttribute('aria-disabled', 'true');
        donate.setAttribute('role', 'link');
        donate.setAttribute('tabindex', '0');
        note.textContent = `${base} Der Zahlungsweg wird gerade eingerichtet.`;
      }
    };
    $$('input[name="amount"]').forEach((r) => r.addEventListener('change', updateDonate));
    updateDonate();
  }

  // ---------- Fester Knopf auf dem Handy ----------

  const sticky = $('#sticky');
  const heroCta = $('#hero-cta');
  if (sticky && heroCta && 'IntersectionObserver' in window) {
    const link = $('a', sticky);
    const state = { hero: true, support: false, foot: false };
    const apply = () => {
      const on = !state.hero && !state.support && !state.foot;
      sticky.classList.toggle('is-on', on);
      link.tabIndex = on ? 0 : -1;
      sticky.setAttribute('aria-hidden', String(!on));
    };
    const watch = (el, key) =>
      el &&
      new IntersectionObserver((entries) => {
        state[key] = entries[0].isIntersecting;
        apply();
      }).observe(el);
    watch(heroCta, 'hero');
    watch($('#unterstuetzen'), 'support');
    watch($('.foot'), 'foot');
    apply();
  }
})();
