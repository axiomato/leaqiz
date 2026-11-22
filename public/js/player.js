'use strict';

(function () {
  const { APP_NAME, LETTERS, h, avatar, num, optionTile, startTimer, reducedMotion, countUp, pulse, awardTitle, awardDetail, awardColor, flameIcon, doubleBadge, store, toast, announce, emit, keepAwake } = window.LQ;
  const session = store('session');
  const local = store('local');
  const SESSION_KEY = 'leaqiz.player';
  // Gewürfelter Avatar bleibt auf diesem Gerät für das nächste Spiel (nur sechs Zahlen, D-38)
  const AVATAR_KEY = 'leaqiz.avatar';
  const Av = window.LeaqizAvatar;
  const savedAvatar = () => {
    const a = local.get(AVATAR_KEY);
    return Av && Av.isAvatar(a) ? a : null;
  };
  const app = document.getElementById('app');

  // Direktverbindung zum Browser der Spielleitung (siehe net.js).
  // Demo (?demo=1): Verbindung zu einer Demo im selben Browser, ganz ohne Netz.
  const DEMO = new URLSearchParams(location.search).has('demo');
  // In der Spielleitung eingebettet („Selbst mitspielen“) oder eigenes Fenster/Tab?
  const EMBEDDED = window.self !== window.top;
  if (EMBEDDED) document.documentElement.classList.add('embedded');
  const DEMO_TAB_HINT = 'Die Spielleitung antwortet nicht. Handys pausieren Tabs im Hintergrund: Öffne die Demo in der Spielleitung über „Selbst mitspielen“.';
  const socket = DEMO ? new window.LQNet.LocalPlayerLink() : new window.LQNet.PlayerLink();

  let state = null; // letzter Spielzustand von der Spielleitung
  let joinStep = { pin: '', title: '' };
  let renderedKey = '';
  let stopTimer = () => {};
  let connectionLost = false;
  let pendingChoice = null;
  let growing = false; // getipptes Feld wächst gerade: Ansicht darunter erst danach wechseln
  let waitRefs = null; // Warteansicht nach dem Antworten (Punkte, Zähler)
  let resultShownFor = -1; // Frage, deren Ergebnis schon animiert gezeigt wurde

  // ---------- Verbindung ----------

  socket.on('connect', async () => {
    connectionLost = false;
    const saved = session.get(SESSION_KEY);
    if (saved && saved.pin && saved.token) {
      const res = await emit(socket, 'player:resume', saved);
      if (!res.ok) {
        session.remove(SESSION_KEY);
        state = null;
        renderJoin(res.error);
      }
      return;
    }
    refreshBanner();
  });

  socket.on('disconnect', () => {
    connectionLost = true;
    refreshBanner();
  });

  socket.on('player:state', (s) => {
    state = s;
    render();
  });

  socket.on('gave-up', () => {
    session.remove(SESSION_KEY);
    state = null;
    stopTimer();
    renderMessage('Verbindung verloren', 'Die Verbindung zum Spiel ist abgebrochen. Frag die Spielleitung, ob das Spiel noch läuft, und tritt neu bei.');
  });

  socket.on('game:closed', ({ reason }) => {
    socket.stop();
    session.remove(SESSION_KEY);
    state = null;
    stopTimer();
    keepAwake(false);
    renderMessage('Spiel beendet', reason || 'Das Spiel ist vorbei.');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state) keepAwake(true);
  });

  // ---------- Grundgerüst ----------

  // Hintergrund des ganzen Bildschirms: dunkel (Standard) oder Farbflut einer Antwort
  function setTone(tone, floodIndex) {
    if (tone === 'flood') {
      document.body.dataset.tone = 'flood';
      document.body.dataset.flood = String(floodIndex);
    } else {
      delete document.body.dataset.tone;
      delete document.body.dataset.flood;
    }
  }

  function frame(...content) {
    stopTimer();
    stopTimer = () => {};
    setTone('ink');
    app.classList.remove('screen--play', 'is-urgent', 'result-in', 'result-in--win');
    const banner = h('p', { class: 'banner', id: 'banner', role: 'status' });
    app.replaceChildren(
      h(
        'div',
        { class: 'screen__top' },
        h('span', { class: 'wordmark', text: APP_NAME }),
        state ? h('span', { text: state.nickname }) : null,
      ),
      banner,
      ...content,
    );
    refreshBanner();
  }

  function refreshBanner() {
    const el = document.getElementById('banner');
    if (!el) return;
    if (connectionLost) el.textContent = 'Verbindung unterbrochen. Ich verbinde neu …';
    else if (state && !state.hostOnline) el.textContent = 'Der Host ist gerade nicht verbunden. Es geht weiter, sobald er zurück ist.';
    else el.textContent = '';
  }

  // ---------- Beitreten ----------

  function renderJoin(errorText) {
    renderedKey = 'join';
    const params = new URLSearchParams(location.search);
    const presetPin = (params.get('pin') || '').replace(/\D/g, '').slice(0, 6);
    if (presetPin && !joinStep.pin) return checkPin(presetPin, true);
    if (joinStep.pin) return renderName(errorText);

    const error = h('p', { class: 'error', id: 'join-error', role: 'alert', text: errorText || '' });
    const input = h('input', {
      class: 'input pin-input',
      id: 'pin',
      name: 'pin',
      inputmode: 'numeric',
      autocomplete: 'off',
      pattern: '[0-9]{6}',
      maxlength: '6',
      required: true,
      'aria-describedby': 'join-error',
      value: presetPin,
    });
    const form = h(
      'form',
      { class: 'join-form', novalidate: true },
      h('label', { class: 'field', for: 'pin' }, h('span', { text: 'Spiel-PIN' }), input),
      h('button', { class: 'btn btn--big', type: 'submit', text: 'Weiter' }),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      checkPin(input.value.replace(/\D/g, ''));
    });
    frame(
      h(
        'div',
        { class: 'screen__center' },
        h('h1', { class: 'title', text: 'Mitspielen' }),
        h('p', { class: 'hint', text: 'Die PIN steht auf der großen Leinwand.' }),
        form,
        error,
        h('a', { class: 'btn btn--quiet', href: 'check/', text: 'Verbindung testen' }),
      ),
    );
    input.focus();
  }

  async function checkPin(pin, fromLink) {
    if (!/^\d{6}$/.test(pin)) {
      renderJoin('Die PIN hat 6 Ziffern.');
      return;
    }
    const busy = document.querySelector('.join-form button[type="submit"]');
    if (busy) {
      busy.disabled = true;
      busy.textContent = 'Verbinde …';
    }
    let res;
    try {
      await socket.connect(pin);
      res = await emit(socket, 'player:check', { pin });
    } catch (err) {
      res = { ok: false, error: connectError(err) };
    }
    if (!res.ok) {
      joinStep = { pin: '', title: '' };
      if (fromLink) history.replaceState(null, '', location.pathname);
      renderJoin(res.error);
      return;
    }
    joinStep = { pin: res.pin, title: res.title };
    renderName();
  }

  function renderName(errorText) {
    const error = h('p', { class: 'error', id: 'name-error', role: 'alert', text: errorText || '' });
    const input = h('input', {
      class: 'input',
      id: 'nickname',
      name: 'nickname',
      maxlength: '20',
      autocomplete: 'nickname',
      autocapitalize: 'words',
      enterkeyhint: 'go',
      required: true,
      'aria-describedby': 'name-hint name-error',
    });
    const button = h('button', { class: 'btn btn--big', type: 'submit', text: 'Beitreten' });
    // Avatar: ohne Würfeln aus dem Namen, sonst der gewürfelte (auf dem Gerät gemerkt)
    let rolled = savedAvatar();
    const current = () => rolled || (Av ? Av.fromName(input.value) : null);
    const preview = h('div', { class: 'avatar-pick__pic' });
    const showPreview = (fresh) => preview.replaceChildren(avatar(current(), input.value, fresh ? 'is-new' : ''));
    const roll = h('button', {
      class: 'btn btn--quiet',
      type: 'button',
      text: 'Würfeln',
      'aria-label': 'Avatar würfeln',
      onclick: () => {
        rolled = Av.random();
        local.set(AVATAR_KEY, rolled);
        showPreview(true);
      },
    });
    input.addEventListener('input', () => {
      if (!rolled) showPreview(false);
    });
    showPreview(false);
    const form = h(
      'form',
      { class: 'join-form', novalidate: true },
      h('label', { class: 'field', for: 'nickname' }, h('span', { text: 'Spielname' }), input),
      h('p', { class: 'hint', id: 'name-hint', text: 'Kein echter Name nötig. Höchstens 20 Zeichen.' }),
      Av ? h('div', { class: 'avatar-pick' }, preview, h('div', { class: 'avatar-pick__side' }, h('p', { class: 'hint', text: 'Dein Avatar' }), roll)) : null,
      button,
      DEMO && !EMBEDDED && window.matchMedia('(pointer: coarse)').matches
        ? h('p', { class: 'hint', text: 'Tipp: Auf dem Handy die Demo in der Spielleitung über „Selbst mitspielen“ öffnen. Ein zweiter Tab wird im Hintergrund pausiert.' })
        : null,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      button.disabled = true;
      const res = await emit(socket, 'player:join', { pin: joinStep.pin, nickname: input.value, avatar: current() });
      button.disabled = false;
      if (!res.ok) {
        error.textContent = res.error;
        input.focus();
        return;
      }
      session.set(SESSION_KEY, { pin: res.pin, token: res.token });
      history.replaceState(null, '', location.pathname);
      keepAwake(true);
    });
    frame(
      h(
        'div',
        { class: 'screen__center' },
        h('h1', { class: 'title', text: 'Wie willst du heißen?' }),
        h('p', { class: 'hint', text: `Quiz „${joinStep.title}“, PIN ${joinStep.pin}` }),
        form,
        error,
        h('button', {
          class: 'btn btn--quiet',
          type: 'button',
          text: 'Andere PIN eingeben',
          onclick: () => {
            joinStep = { pin: '', title: '' };
            history.replaceState(null, '', location.pathname);
            renderJoin();
          },
        }),
      ),
    );
    input.focus();
  }

  function renderMessage(title, text) {
    renderedKey = 'message';
    joinStep = { pin: '', title: '' };
    frame(
      h(
        'div',
        { class: 'screen__center' },
        h('h1', { class: 'title', text: title }),
        h('p', { class: 'lead', text }),
        h('button', { class: 'btn btn--big', type: 'button', text: 'Neuem Spiel beitreten', onclick: () => renderJoin() }),
      ),
    );
  }

  // ---------- Spiel ----------

  function render() {
    const s = state;
    if (!s) return;
    const key = [s.state, s.qIndex, s.answered, s.score, s.rank, s.hostOnline].join('|');
    if (key === renderedKey) {
      updateWaiting(s);
      return refreshBanner();
    }
    renderedKey = key;
    if (s.state !== 'question') pendingChoice = null;

    switch (s.state) {
      case 'lobby':
        return renderLobby(s);
      case 'countdown':
        return renderCountdown(s);
      case 'question':
        if (growing) {
          // Sonst erscheint die Warteansicht schon unter der wachsenden Fläche und flackert
          renderedKey = '';
          return undefined;
        }
        if (s.answered || pendingChoice !== null) {
          // Warteansicht steht schon: nur Fortschritt aktualisieren (kein erneutes Einblenden)
          if (waitRefs && waitRefs.qIndex === s.qIndex && app.querySelector('.wait')) {
            updateWaiting(s);
            return refreshBanner();
          }
          return renderAnswered(s);
        }
        return renderQuestion(s);
      case 'reveal':
      case 'leaderboard':
        return renderResult(s);
      case 'podium':
        return renderPodium(s);
      default:
        return undefined;
    }
  }

  function progress(s) {
    return `Frage ${s.qIndex + 1} von ${s.qCount}`;
  }

  function renderLobby(s) {
    const pic = h('div', { class: 'lobby-me__pic' }, avatar(s.avatar, s.nickname));
    const roll = Av
      ? h('button', {
          class: 'btn btn--quiet',
          type: 'button',
          text: 'Neu würfeln',
          'aria-label': 'Avatar neu würfeln',
          onclick: async () => {
            const next = Av.random();
            roll.disabled = true;
            const res = await emit(socket, 'player:avatar', { avatar: next });
            roll.disabled = false;
            if (!res.ok) return toast(res.error);
            local.set(AVATAR_KEY, next);
            pic.replaceChildren(avatar(res.avatar, s.nickname, 'is-new'));
          },
        })
      : null;
    frame(
      h(
        'div',
        { class: 'screen__center' },
        h('div', { class: 'lobby-me' }, pic, roll),
        h('h1', { class: 'title', text: 'Du bist dabei' }),
        h('p', { class: 'lead', text: `Gleich geht es los, ${s.nickname}.` }),
        h('p', { class: 'waiting', text: 'Warte auf den Start' }),
        h('p', { class: 'hint', text: 'Schau auf die Leinwand. Die Fragen erscheinen dort und hier.' }),
      ),
    );
    announce('Du bist dabei. Warte auf den Start.');
  }

  function renderCountdown(s) {
    const fill = h('div', { class: 'timebar__fill' });
    frame(
      h(
        'div',
        { class: 'screen__center' },
        s.question.double ? doubleBadge() : null,
        h('div', { class: 'q-head' }, h('p', { class: 'hint', text: progress(s) }), h('h1', { class: 'player-cd', text: s.question.text })),
        h('div', { class: 'timebar', 'aria-hidden': 'true' }, fill),
        h('p', { class: 'hint', text: 'Lies schon mal. Gleich kannst du antworten.' }),
      ),
    );
    stopTimer = startTimer({ remainingMs: s.remainingMs, totalMs: s.remainingMs, fillEl: fill });
    announce(`${s.question.double ? 'Doppelte Punkte. ' : ''}${progress(s)}: ${s.question.text}`);
  }

  // Controller: vier große Felder bis an den Rand
  function renderQuestion(s) {
    const q = s.question;
    const long = q.options.some((o) => o.length > 28);
    const counter = h('span', { class: 'num', 'aria-hidden': 'true' });
    const grid = h('div', { class: `player-grid${long ? ' is-long' : ''}`, role: 'group', 'aria-label': 'Antworten' });
    q.options.forEach((text, i) => {
      const tile = optionTile('button', text, i, { type: 'button', onclick: () => answer(i, tile) });
      grid.append(tile);
    });
    frame(
      h(
        'div',
        { class: 'play-head' },
        h('div', { class: 'play-head__meta' }, h('div', { class: 'play-head__info' }, h('p', { text: progress(s) }), q.double ? doubleBadge(true) : null), counter),
        h('h1', { class: 'player-q', text: q.text }),
      ),
      grid,
    );
    app.classList.add('screen--play');
    stopTimer = startTimer({
      remainingMs: s.remainingMs,
      totalMs: q.timeLimit * 1000,
      numberEl: counter,
      onSecond: (sec) => {
        if (sec > 0 && sec <= 5) {
          app.classList.add('is-urgent');
          pulse(counter);
        }
      },
    });
  }

  async function answer(choice, tile) {
    if (pendingChoice !== null || !state || state.state !== 'question') return;
    pendingChoice = choice;
    const sent = emit(socket, 'player:answer', { choice }); // sofort senden, nicht auf die Animation warten
    growing = true;
    try {
      await growToScreen(tile, choice);
    } finally {
      growing = false;
    }
    if (pendingChoice === choice && !app.querySelector('.wait')) {
      renderedKey = '';
      renderAnswered(state);
    }
    const res = await sent;
    if (!res.ok) {
      toast(DEMO && !EMBEDDED && /Keine Antwort/.test(res.error) ? DEMO_TAB_HINT : res.error);
      if (state && state.state === 'question' && !state.answered && !/schon geantwortet|abgelaufen/.test(res.error)) {
        pendingChoice = null;
        renderedKey = '';
        render();
      }
    }
  }

  // Das getippte Feld wächst in seiner Farbe zum ganzen Bildschirm: zeigt, dass die Wahl angekommen ist
  function growToScreen(tile, choice) {
    if (!tile || reducedMotion() || !tile.isConnected) return Promise.resolve();
    const r = tile.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const layer = h('div', { class: 'grow-layer', dataset: { i: String(choice) }, 'aria-hidden': 'true' });
    document.body.append(layer);
    const from = `inset(${r.top}px ${W - r.right}px ${H - r.bottom}px ${r.left}px round 16px)`;
    const anim = layer.animate([{ clipPath: from }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }], {
      duration: 320,
      easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      fill: 'forwards',
    });
    // Sicherheitsnetz: Läuft die Animation nicht (z. B. Seite im Hintergrund), nicht hängen bleiben
    const fallback = new Promise((resolve) => setTimeout(resolve, 700));
    return Promise.race([anim.finished.catch(() => {}), fallback])
      .then(() => {
        // Ebene erst nach dem Umschalten entfernen, damit kein Flackern entsteht
        requestAnimationFrame(() => layer.remove());
      });
  }

  // Bestätigung in der Farbe der gewählten Antwort, darunter das Warten auf die anderen:
  // ein Punkt je Person, gefüllt = hat geantwortet, offene Punkte pulsieren als Welle

  function renderAnswered(s) {
    const choice = pendingChoice !== null ? pendingChoice : Number.isInteger(s.choice) ? s.choice : null;
    const dots = h('div', { class: 'wait__dots', 'aria-hidden': 'true' });
    const count = h('p', { class: 'wait__count' });
    const fill = h('div', { class: 'timebar__fill' });
    frame(
      h(
        'div',
        { class: 'screen__center answered' },
        choice !== null ? h('p', { class: 'big-letter num', 'aria-hidden': 'true', text: LETTERS[choice] }) : null,
        h('h1', { class: 'title', text: 'Gesendet' }),
        h('div', { class: 'wait' }, h('p', { class: 'wait__label', text: 'Warte auf die anderen' }), dots, count),
        h('div', { class: 'timebar', 'aria-hidden': 'true' }, fill),
        h('p', { class: 'hint', text: progress(s) }),
      ),
    );
    if (choice !== null) setTone('flood', choice);
    waitRefs = { qIndex: s.qIndex, dots, count };
    updateWaiting(s);
    stopTimer = startTimer({ remainingMs: s.remainingMs, totalMs: s.question.timeLimit * 1000, fillEl: fill });
    announce('Antwort gesendet. Warte auf die anderen.');
  }

  function updateWaiting(s) {
    if (!waitRefs || !s || s.state !== 'question' || waitRefs.qIndex !== s.qIndex || !s.progress) return;
    const total = Math.max(s.progress.active, s.progress.answered, 1);
    // Eigene Antwort ist schon unterwegs, auch wenn die Bestätigung noch fehlt
    const done = Math.min(s.progress.answered + (s.answered ? 0 : 1), total);
    waitRefs.count.textContent = `${done} von ${total} haben geantwortet`;
    const dots = waitRefs.dots;
    dots.hidden = total > 40; // sehr große Gruppen: nur die Zahl
    if (dots.hidden) return;
    while (dots.children.length < total) dots.append(h('span', { class: 'wait__dot' }));
    while (dots.children.length > total) dots.lastChild.remove();
    [...dots.children].forEach((dot, i) => {
      dot.style.setProperty('--i', String(i));
      dot.classList.toggle('is-done', i < done);
    });
  }

  function renderResult(s) {
    const r = s.result || { answered: false, correct: false, points: 0, streak: 0 };
    const q = s.question;
    // Animation nur beim ersten Anzeigen (Auflösung), nicht erneut beim Zwischenstand
    const animate = resultShownFor !== s.qIndex;
    resultShownFor = s.qIndex;
    const points = h('p', { class: 'result__points num' });
    let headline;
    if (r.correct) headline = 'Richtig';
    else if (r.answered) headline = 'Leider falsch';
    else headline = 'Keine Antwort';

    const behind = s.behind
      ? h('p', { class: 'lead', text: `${num(s.behind.gap)} Punkte hinter ${s.behind.nickname}` })
      : s.rank === 1 && s.score > 0
        ? h('p', { class: 'lead', text: 'Du führst.' })
        : null;

    // Bei falscher Antwort: richtige Lösung mit Buchstabe und Farbe zeigen
    const answerWas =
      !r.correct && q
        ? h(
            'div',
            { class: 'answer-was' },
            ...q.correct.map((i) => h('span', { class: 'opt__letter', dataset: { i: String(i) }, 'aria-hidden': 'true', text: LETTERS[i] })),
            h('span', { text: `Richtig war: ${q.correct.map((i) => q.options[i]).join(' / ')}` }),
          )
        : null;

    frame(
      h(
        'div',
        { class: 'screen__center' },
        h(
          'section',
          { class: 'result' },
          h('h1', { class: 'title', text: headline }),
          points,
          r.correct && r.double ? doubleBadge(true) : null,
          r.correct && r.streak > 1 ? h('p', { class: 'lead streak-line' }, r.streak >= 3 ? flameIcon() : null, `${r.streak} richtige Antworten in Folge`) : null,
          r.move > 0 ? h('p', { class: 'lead move-line' }, h('span', { 'aria-hidden': 'true', text: '▲ ' }), `${r.move} ${r.move === 1 ? 'Platz' : 'Plätze'} nach vorn`) : null,
          answerWas,
        ),
        h(
          'dl',
          { class: 'stats' },
          h('div', null, h('dt', { text: 'Punkte' }), h('dd', { text: num(s.score) })),
          h('div', null, h('dt', { text: 'Platz' }), h('dd', { text: `${s.rank} / ${s.playerCount}` })),
        ),
        behind,
      ),
    );
    if (r.correct) setTone('flood', r.choice);
    if (animate && !reducedMotion()) {
      app.classList.add(r.correct ? 'result-in--win' : 'result-in');
      if (r.correct) {
        // Farbfläche wischt von links herein wie auf der Leinwand
        document.body.classList.add('is-wiping');
        setTimeout(() => document.body.classList.remove('is-wiping'), 560);
      }
    }
    const stopCount = countUp(points, animate ? 0 : r.points, r.points, { prefix: '+', ms: 700, delay: 250 });
    const prevStop = stopTimer;
    stopTimer = () => {
      prevStop();
      stopCount();
    };
    announce(`${headline}. ${num(r.points)} Punkte. Platz ${s.rank} von ${s.playerCount}.`);
  }

  function renderPodium(s) {
    keepAwake(false);
    session.remove(SESSION_KEY);
    const title = s.rank === 1 ? 'Gewonnen' : s.rank <= 3 ? 'Aufs Podium' : 'Geschafft';
    frame(
      h(
        'div',
        { class: 'screen__center' },
        h('div', { class: 'final-me' }, avatar(s.avatar, s.nickname), h('p', { class: 'final-rank num', 'aria-hidden': 'true', text: `${s.rank}.` })),
        h('h1', { class: 'title', text: title }),
        h(
          'dl',
          { class: 'stats' },
          h('div', null, h('dt', { text: 'Endstand' }), h('dd', { text: num(s.score) })),
          h('div', null, h('dt', { text: 'Platz' }), h('dd', { text: `${s.rank} / ${s.playerCount}` })),
        ),
        myAwards(s.awards),
        h('p', { class: 'hint', text: 'Danke fürs Mitspielen.' }),
      ),
    );
    const names = (s.awards || []).map((a) => awardTitle(a.key));
    announce(`${title}. Platz ${s.rank} von ${s.playerCount} mit ${num(s.score)} Punkten.${names.length ? ` Auszeichnungen: ${names.join(', ')}.` : ''}`);
  }

  // Eigene Auszeichnungen in der festen Farbe jeder Auszeichnung
  function myAwards(list) {
    if (!Array.isArray(list) || !list.length) return null;
    return h(
      'section',
      { class: 'my-awards', 'aria-labelledby': 'my-awards-title' },
      h('h2', { class: 'my-awards__title', id: 'my-awards-title', text: list.length === 1 ? 'Deine Auszeichnung' : 'Deine Auszeichnungen' }),
      h(
        'ul',
        { class: 'my-awards__list' },
        list.map((a) =>
          h(
            'li',
            { class: 'award award--mini is-shown', dataset: { i: String(awardColor(a.key)) } },
            h('p', { class: 'award__title', text: awardTitle(a.key) }),
            h('p', { class: 'award__detail', text: awardDetail(a) + (a.shared > 0 ? `, geteilt mit ${a.shared} ${a.shared === 1 ? 'anderen Person' : 'anderen'}` : '') }),
          ),
        ),
      ),
    );
  }

  // Fehlertexte nach Stufe: V = Vermittlung, D = Direktverbindung. Der Code hilft bei Rückfragen.
  function connectError(err) {
    const code = err && err.code;
    if (code === 'no-game') return DEMO ? 'Zu dieser PIN läuft in diesem Browser keine Demo. Starte die Demo in der Spielleitung.' : 'Zu dieser PIN läuft kein Spiel. Bitte die PIN prüfen.';
    if (code === 'signal') return 'Der Vermittlungsserver antwortet nicht. Bitte in einer Minute erneut versuchen. (Code V)';
    const detail = err && err.detail ? `, ${err.detail}` : '';
    return `Die Verbindung zum Spiel ließ sich nicht aufbauen. Oft sperrt das Netz Direktverbindungen: mit mobilen Daten oder einem anderen WLAN probieren. (Code D${detail})`;
  }

  // Erste Ansicht: laufendes Spiel fortsetzen oder PIN abfragen
  const saved = session.get(SESSION_KEY);
  if (saved && saved.pin && saved.token) {
    frame(h('div', { class: 'screen__center' }, h('p', { class: 'lead', text: 'Verbinde mit deinem Spiel …' })));
    socket.connect(saved.pin).catch((err) => {
      session.remove(SESSION_KEY);
      renderJoin(connectError(err));
    });
  } else {
    renderJoin();
  }

  // Tastatur: 1–4 oder A–D beantworten die Frage.
  document.addEventListener('keydown', (e) => {
    if (!state || state.state !== 'question' || e.target instanceof HTMLInputElement) return;
    const map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };
    const choice = map[e.key.toLowerCase()];
    if (choice !== undefined && choice < state.question.options.length) answer(choice);
  });
})();
