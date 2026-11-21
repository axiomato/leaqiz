'use strict';

(function () {
  const { APP_NAME, h, num, optionTile, startTimer, store, toast, announce, emit, keepAwake } = window.LQ;
  const session = store('session');
  const SESSION_KEY = 'leaqiz.player';
  const app = document.getElementById('app');

  // Direktverbindung zum Browser der Spielleitung (siehe net.js)
  const socket = new window.LQNet.PlayerLink();

  let state = null; // letzter Spielzustand von der Spielleitung
  let joinStep = { pin: '', title: '' };
  let renderedKey = '';
  let stopTimer = () => {};
  let connectionLost = false;
  let pendingChoice = null;

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

  function frame(...content) {
    stopTimer();
    stopTimer = () => {};
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
        h('h1', { class: 'display big-word', text: 'Mitspielen' }),
        h('p', { class: 'hint', text: 'Die PIN steht auf der großen Leinwand.' }),
        form,
        error,
        h('a', { class: 'btn btn--ghost', href: 'check/', text: 'Verbindung testen' }),
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
    const form = h(
      'form',
      { class: 'join-form', novalidate: true },
      h('label', { class: 'field', for: 'nickname' }, h('span', { text: 'Dein Spielname' }), input),
      h('p', { class: 'hint', id: 'name-hint', text: 'Kein echter Name nötig. Höchstens 20 Zeichen.' }),
      button,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      button.disabled = true;
      const res = await emit(socket, 'player:join', { pin: joinStep.pin, nickname: input.value });
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
        h('p', { class: 'hint' }, `PIN ${joinStep.pin}`),
        h('h1', { class: 'lead', text: joinStep.title }),
        form,
        error,
        h('button', {
          class: 'btn btn--ghost',
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
        h('h1', { class: 'display big-word', text: title }),
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
    if (key === renderedKey) return refreshBanner();
    renderedKey = key;
    if (s.state !== 'question') pendingChoice = null;

    switch (s.state) {
      case 'lobby':
        return renderLobby(s);
      case 'countdown':
        return renderCountdown(s);
      case 'question':
        return s.answered || pendingChoice !== null ? renderAnswered(s) : renderQuestion(s);
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
    frame(
      h(
        'div',
        { class: 'screen__center' },
        h('h1', { class: 'display big-word', text: 'Du bist dabei' }),
        h('p', { class: 'lead', text: `Gleich geht es los, ${s.nickname}.` }),
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
        h('p', { class: 'hint', text: progress(s) }),
        h('h1', { class: 'lead', text: s.question.text }),
        h('div', { class: 'timebar', 'aria-hidden': 'true' }, fill),
        h('p', { class: 'hint', text: 'Lies schon mal. Gleich kannst du antworten.' }),
      ),
    );
    stopTimer = startTimer({ remainingMs: s.remainingMs, totalMs: s.remainingMs, fillEl: fill });
    announce(`${progress(s)}: ${s.question.text}`);
  }

  function renderQuestion(s) {
    const q = s.question;
    const long = q.options.some((o) => o.length > 28);
    const counter = h('span', { class: 'display', 'aria-hidden': 'true' });
    const grid = h('div', { class: `player-grid${long ? ' is-long' : ''}`, role: 'group', 'aria-label': 'Antworten' });
    q.options.forEach((text, i) => {
      grid.append(optionTile('button', text, i, { type: 'button', onclick: () => answer(i) }));
    });
    frame(
      h('div', { class: 'screen__top' }, h('span', { class: 'hint', text: progress(s) }), counter),
      h('h1', { class: 'player-q', text: q.text }),
      grid,
    );
    stopTimer = startTimer({ remainingMs: s.remainingMs, totalMs: q.timeLimit * 1000, numberEl: counter });
  }

  async function answer(choice) {
    if (pendingChoice !== null || !state || state.state !== 'question') return;
    pendingChoice = choice;
    renderedKey = '';
    renderAnswered(state);
    const res = await emit(socket, 'player:answer', { choice });
    if (!res.ok) {
      toast(res.error);
      if (state && state.state === 'question' && !state.answered && !/schon geantwortet|abgelaufen/.test(res.error)) {
        pendingChoice = null;
        renderedKey = '';
        render();
      }
    }
  }

  function renderAnswered(s) {
    frame(
      h(
        'div',
        { class: 'screen__center' },
        h('h1', { class: 'display big-word', text: 'Gesendet' }),
        h('p', { class: 'lead', text: 'Warte auf die anderen.' }),
        h('p', { class: 'hint', text: progress(s) }),
      ),
    );
    announce('Antwort gesendet.');
  }

  function renderResult(s) {
    const r = s.result || { answered: false, correct: false, points: 0, streak: 0 };
    const correctTexts = s.question ? s.question.correct.map((i) => s.question.options[i]).join(' / ') : '';
    let headline;
    if (r.correct) headline = 'Richtig';
    else if (r.answered) headline = 'Leider falsch';
    else headline = 'Keine Antwort';

    const behind = s.behind
      ? h('p', { class: 'lead', text: `${num(s.behind.gap)} Punkte hinter ${s.behind.nickname}` })
      : s.rank === 1 && s.score > 0
        ? h('p', { class: 'lead', text: 'Du führst.' })
        : null;

    frame(
      h(
        'div',
        { class: 'screen__center' },
        h(
          'section',
          { class: `result${r.correct ? ' is-right' : ''}` },
          h('h1', { class: 'lead', text: headline }),
          h('p', { class: 'display result__points', text: `+${num(r.points)}` }),
          r.correct && r.streak > 1 ? h('p', { text: `${r.streak} richtige Antworten in Folge` }) : null,
          !r.correct && correctTexts ? h('p', { text: `Richtig war: ${correctTexts}` }) : null,
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
        h('h1', { class: 'display big-word', text: title }),
        h(
          'dl',
          { class: 'stats' },
          h('div', null, h('dt', { text: 'Endstand' }), h('dd', { text: num(s.score) })),
          h('div', null, h('dt', { text: 'Platz' }), h('dd', { text: `${s.rank} / ${s.playerCount}` })),
        ),
        h('p', { class: 'hint', text: 'Danke fürs Mitspielen.' }),
      ),
    );
    announce(`${title}. Platz ${s.rank} von ${s.playerCount} mit ${num(s.score)} Punkten.`);
  }

  // Fehlertexte nach Stufe: V = Vermittlung, D = Direktverbindung. Der Code hilft bei Rückfragen.
  function connectError(err) {
    const code = err && err.code;
    if (code === 'no-game') return 'Zu dieser PIN läuft kein Spiel. Bitte die PIN prüfen.';
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
