'use strict';

(function () {
  const { LETTERS, h, num, optionTile, startTimer, store, toast, announce, emit, toCsv, download, keepAwake } = window.QR;
  const local = store('local');
  const session = store('session');
  const LIB_KEY = 'quizrunde.quizzes';
  const GAME_KEY = 'quizrunde.hostGame';
  const PW_KEY = 'quizrunde.hostPassword';
  const TIME_LIMITS = [5, 10, 20, 30, 45, 60, 90, 120, 240];

  const root = document.getElementById('app');
  const socket = io({ reconnectionDelayMax: 4000 });

  let mode = 'library'; // library | editor | game
  let draft = null; // Quiz im Editor
  let dirty = false;
  let game = null; // letzter Host-Zustand
  let renderedKey = '';
  let refs = {};
  let stopTimer = () => {};
  let endingByMe = false;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ---------- Beispiel-Quiz für den ersten Start ----------

  function sampleQuiz() {
    return {
      id: uid(),
      title: 'Allgemeinwissen zum Aufwärmen',
      updatedAt: Date.now(),
      questions: [
        { type: 'quiz', text: 'Welcher Planet ist der Sonne am nächsten?', options: ['Venus', 'Merkur', 'Mars', 'Erde'], correct: [1], timeLimit: 20 },
        { type: 'truefalse', text: 'Ein Oktopus hat drei Herzen.', options: ['Wahr', 'Falsch'], correct: [0], timeLimit: 10 },
        { type: 'quiz', text: 'Wie viele Bundesländer hat Deutschland?', options: ['14', '15', '16', '17'], correct: [2], timeLimit: 20 },
        { type: 'quiz', text: 'Welches Element hat das chemische Symbol Fe?', options: ['Fluor', 'Gold', 'Blei', 'Eisen'], correct: [3], timeLimit: 20 },
        { type: 'truefalse', text: 'Die Chinesische Mauer ist vom Mond aus mit bloßem Auge zu sehen.', options: ['Wahr', 'Falsch'], correct: [1], timeLimit: 10 },
        { type: 'quiz', text: 'Wer schrieb „Faust“?', options: ['Friedrich Schiller', 'Johann Wolfgang von Goethe', 'Gotthold Ephraim Lessing', 'Heinrich von Kleist'], correct: [1], timeLimit: 20 },
      ],
    };
  }

  // ---------- Bibliothek (nur im Browser des Hosts gespeichert) ----------

  function loadQuizzes() {
    const list = local.get(LIB_KEY, null);
    if (!Array.isArray(list)) {
      const seeded = [sampleQuiz()];
      local.set(LIB_KEY, seeded);
      return seeded;
    }
    return list;
  }

  function saveQuizzes(list) {
    if (!local.set(LIB_KEY, list)) toast('Speichern nicht möglich: Der Browser blockiert den lokalen Speicher.');
  }

  function upsertQuiz(quiz) {
    const list = loadQuizzes();
    const i = list.findIndex((q) => q.id === quiz.id);
    const copy = JSON.parse(JSON.stringify({ ...quiz, updatedAt: Date.now() }));
    if (i >= 0) list[i] = copy;
    else list.unshift(copy);
    saveQuizzes(list);
  }

  function slug(text) {
    return (
      String(text)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'quiz'
    );
  }

  // Leere Antwortfelder entfernen und richtige Antworten neu zuordnen.
  function cleanQuestion(q) {
    if (q.type === 'truefalse') {
      return { type: 'truefalse', text: q.text.trim(), options: ['Wahr', 'Falsch'], correct: [q.correct[0] === 1 ? 1 : 0], timeLimit: q.timeLimit };
    }
    const options = [];
    const correct = [];
    q.options.forEach((o, i) => {
      const text = String(o || '').trim();
      if (!text) return;
      if (q.correct.includes(i)) correct.push(options.length);
      options.push(text);
    });
    return { type: 'quiz', text: q.text.trim(), options, correct, timeLimit: q.timeLimit };
  }

  function toPayload(quiz) {
    return { title: String(quiz.title || '').trim() || 'Ohne Titel', questions: quiz.questions.map(cleanQuestion) };
  }

  // Gleiche Regeln wie auf dem Server, aber mit Hinweis auf die betroffene Frage.
  function problems(quiz) {
    const list = [];
    if (!quiz.questions.length) list.push({ index: -1, text: 'Füge mindestens eine Frage hinzu.' });
    quiz.questions.forEach((raw, index) => {
      const q = cleanQuestion(raw);
      const label = `Frage ${index + 1}`;
      if (!q.text) list.push({ index, text: `${label}: Fragetext fehlt.` });
      if (q.options.length < 2) list.push({ index, text: `${label}: mindestens 2 Antworten eintragen.` });
      if (!q.correct.length) list.push({ index, text: `${label}: eine richtige Antwort markieren.` });
    });
    return list;
  }

  function normalizeImported(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.questions)) return null;
    const questions = raw.questions.slice(0, 100).map((q) => {
      const type = q && q.type === 'truefalse' ? 'truefalse' : 'quiz';
      const options = type === 'truefalse' ? ['Wahr', 'Falsch'] : Array.from({ length: 4 }, (_, i) => String((q && q.options && q.options[i]) || '').slice(0, 90));
      const correct = (Array.isArray(q && q.correct) ? q.correct : []).filter((i) => Number.isInteger(i) && i >= 0 && i < options.length);
      const timeLimit = TIME_LIMITS.includes(q && q.timeLimit) ? q.timeLimit : 20;
      return { type, text: String((q && q.text) || '').slice(0, 300), options, correct, timeLimit };
    });
    return { id: uid(), title: String(raw.title || 'Importiertes Quiz').slice(0, 120), updatedAt: Date.now(), questions };
  }

  // ---------- Ansicht: Bibliothek ----------

  function renderLibrary() {
    mode = 'library';
    renderedKey = '';
    stopTimer();
    keepAwake(false);
    const quizzes = loadQuizzes();

    const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'import-file', tabindex: '-1', 'aria-hidden': 'true' });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > 1024 * 1024) return toast('Die Datei ist zu groß (max. 1 MB).');
      try {
        const data = JSON.parse(await file.text());
        const items = (Array.isArray(data) ? data : [data]).map(normalizeImported).filter(Boolean);
        if (!items.length) return toast('In der Datei wurde kein Quiz gefunden.');
        saveQuizzes([...items, ...loadQuizzes()]);
        toast(items.length === 1 ? `„${items[0].title}“ importiert.` : `${items.length} Quizze importiert.`);
        renderLibrary();
      } catch {
        toast('Die Datei ist kein gültiges Quiz (JSON).');
      }
    });

    const list = h('ul', { class: 'lib' });
    for (const quiz of quizzes) {
      const date = new Date(quiz.updatedAt || Date.now()).toLocaleDateString('de-DE');
      list.append(
        h(
          'li',
          { class: 'lib__item' },
          h(
            'div',
            null,
            h('p', { class: 'lib__title', text: quiz.title || 'Ohne Titel' }),
            h('p', { class: 'hint', text: `${quiz.questions.length} ${quiz.questions.length === 1 ? 'Frage' : 'Fragen'}, geändert am ${date}` }),
          ),
          h(
            'div',
            { class: 'lib__actions' },
            h('button', { class: 'btn btn--small', type: 'button', text: 'Spiel starten', onclick: () => startGame(quiz) }),
            h('button', { class: 'btn btn--small btn--ghost', type: 'button', text: 'Bearbeiten', onclick: () => openEditor(quiz) }),
            h('button', {
              class: 'btn btn--small btn--ghost',
              type: 'button',
              text: 'Exportieren',
              onclick: () => {
                const { id, ...data } = quiz;
                download(`${slug(quiz.title)}.quizrunde.json`, JSON.stringify(data, null, 2), 'application/json');
              },
            }),
            h('button', {
              class: 'btn btn--small btn--danger',
              type: 'button',
              text: 'Löschen',
              'aria-label': `„${quiz.title}“ löschen`,
              onclick: () => {
                if (!window.confirm(`„${quiz.title}“ endgültig löschen?`)) return;
                saveQuizzes(loadQuizzes().filter((q) => q.id !== quiz.id));
                toast('Quiz gelöscht.');
                renderLibrary();
              },
            }),
          ),
        ),
      );
    }

    root.replaceChildren(
      h('header', { class: 'host-bar' }, h('span', { class: 'wordmark', text: 'Quizrunde' }), h('span', { class: 'hint', text: 'Spielleitung' })),
      h(
        'main',
        { class: 'work' },
        h(
          'div',
          { class: 'work__head' },
          h('h1', { text: 'Deine Quizze' }),
          h(
            'div',
            { class: 'lib__actions' },
            h('button', { class: 'btn btn--ghost', type: 'button', text: 'Datei importieren', onclick: () => fileInput.click() }),
            fileInput,
            h('button', { class: 'btn', type: 'button', text: 'Neues Quiz', onclick: () => openEditor(null) }),
          ),
        ),
        h('p', { class: 'hint', text: 'Quizze werden nur in diesem Browser gespeichert. Exportiere sie als Datei, um sie zu sichern oder an Kolleginnen und Kollegen weiterzugeben.' }),
        quizzes.length
          ? list
          : h(
              'div',
              { class: 'empty' },
              h('p', { class: 'lead', text: 'Noch kein Quiz vorhanden.' }),
              h('button', { class: 'btn', type: 'button', text: 'Erstes Quiz anlegen', onclick: () => openEditor(null) }),
            ),
      ),
    );
  }

  // ---------- Ansicht: Editor ----------

  function blankQuestion(type) {
    return type === 'truefalse'
      ? { type: 'truefalse', text: '', options: ['Wahr', 'Falsch'], correct: [0], timeLimit: 10 }
      : { type: 'quiz', text: '', options: ['', '', '', ''], correct: [], timeLimit: 20 };
  }

  function openEditor(quiz) {
    draft = quiz
      ? JSON.parse(JSON.stringify(quiz))
      : { id: uid(), title: '', updatedAt: Date.now(), questions: [blankQuestion('quiz')] };
    // Editor arbeitet immer mit 4 Antwortfeldern
    for (const q of draft.questions) {
      if (q.type === 'quiz') while (q.options.length < 4) q.options.push('');
    }
    dirty = false;
    renderEditor();
  }

  function leaveEditor() {
    if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
    renderLibrary();
  }

  function renderEditor(focusSelector) {
    mode = 'editor';
    const errorBox = h('div', { class: 'error', id: 'editor-errors', role: 'alert' });
    const titleInput = h('input', { class: 'input', id: 'quiz-title', maxlength: '120', value: draft.title, placeholder: 'z. B. Sicherheitsunterweisung 2026' });
    titleInput.addEventListener('input', () => {
      draft.title = titleInput.value;
      dirty = true;
    });

    const cards = draft.questions.map((q, index) => questionCard(q, index));

    root.replaceChildren(
      h(
        'header',
        { class: 'host-bar' },
        h('span', { class: 'wordmark', text: 'Quizrunde' }),
        h('div', { class: 'host-bar__meta' }, h('button', { class: 'btn btn--small btn--ghost', type: 'button', text: 'Zur Übersicht', onclick: leaveEditor })),
      ),
      h(
        'main',
        { class: 'work' },
        h('h1', { text: draft.title ? 'Quiz bearbeiten' : 'Neues Quiz' }),
        h('label', { class: 'field', for: 'quiz-title' }, h('span', { text: 'Titel' }), titleInput),
        ...cards,
        h(
          'div',
          { class: 'lib__actions' },
          h('button', { class: 'btn btn--ghost', type: 'button', text: 'Frage hinzufügen', onclick: () => addQuestion('quiz') }),
          h('button', { class: 'btn btn--ghost', type: 'button', text: 'Wahr/Falsch-Frage hinzufügen', onclick: () => addQuestion('truefalse') }),
        ),
        h(
          'div',
          { class: 'toolbar' },
          errorBox,
          h('button', { class: 'btn btn--ghost', type: 'button', text: 'Speichern', onclick: () => saveDraft(false) }),
          h('button', { class: 'btn', type: 'button', text: 'Speichern und Spiel starten', onclick: () => saveDraft(true) }),
        ),
      ),
    );
    if (focusSelector) {
      const el = root.querySelector(focusSelector);
      if (el) el.focus();
    }
  }

  function addQuestion(type) {
    draft.questions.push(blankQuestion(type));
    dirty = true;
    renderEditor(`#q${draft.questions.length - 1}-text`);
  }

  function questionCard(q, index) {
    const id = `q${index}`;
    const count = draft.questions.length;

    const typeSelect = h(
      'select',
      { class: 'input', id: `${id}-type`, 'aria-label': `Fragetyp für Frage ${index + 1}` },
      h('option', { value: 'quiz', text: 'Multiple Choice', selected: q.type === 'quiz' }),
      h('option', { value: 'truefalse', text: 'Wahr/Falsch', selected: q.type === 'truefalse' }),
    );
    typeSelect.addEventListener('change', () => {
      const next = blankQuestion(typeSelect.value);
      next.text = q.text;
      draft.questions[index] = next;
      dirty = true;
      renderEditor(`#${id}-type`);
    });

    const text = h('textarea', { class: 'input', id: `${id}-text`, maxlength: '300', rows: '2', placeholder: 'Frage eingeben' });
    text.value = q.text;
    text.addEventListener('input', () => {
      q.text = text.value;
      dirty = true;
    });

    const time = h(
      'select',
      { class: 'input', id: `${id}-time` },
      TIME_LIMITS.map((t) => h('option', { value: String(t), text: `${t} Sekunden`, selected: q.timeLimit === t })),
    );
    time.addEventListener('change', () => {
      q.timeLimit = Number(time.value);
      dirty = true;
    });

    const opts = h('div', { class: 'qopts', role: 'group', 'aria-label': `Antworten für Frage ${index + 1}` });
    q.options.forEach((value, i) => {
      const letter = h('span', { class: 'opt__letter', 'aria-hidden': 'true', text: LETTERS[i] });
      let field;
      if (q.type === 'truefalse') {
        field = h('span', { class: 'lead', text: value });
      } else {
        field = h('input', { class: 'input', id: `${id}-o${i}`, maxlength: '90', value, 'aria-label': `Antwort ${LETTERS[i]}`, placeholder: i < 2 ? 'Antwort' : 'Antwort (optional)' });
        field.addEventListener('input', () => {
          q.options[i] = field.value;
          dirty = true;
        });
      }
      const mark = h('input', {
        type: q.type === 'truefalse' ? 'radio' : 'checkbox',
        name: `${id}-correct`,
        checked: q.correct.includes(i),
        'aria-label': `Antwort ${LETTERS[i]} ist richtig`,
      });
      mark.addEventListener('change', () => {
        if (q.type === 'truefalse') q.correct = [i];
        else q.correct = mark.checked ? [...new Set([...q.correct, i])] : q.correct.filter((c) => c !== i);
        dirty = true;
      });
      opts.append(h('div', { class: 'qopt', dataset: { i: String(i) } }, letter, field, h('label', { class: 'check' }, mark, h('span', { 'aria-hidden': 'true', text: 'richtig' }))));
    });

    const move = (delta) => {
      const target = index + delta;
      [draft.questions[index], draft.questions[target]] = [draft.questions[target], draft.questions[index]];
      dirty = true;
      renderEditor(`#q${target}-${delta < 0 ? 'up' : 'down'}`);
    };

    return h(
      'section',
      { class: 'qcard', id: `${id}-card`, 'aria-labelledby': `${id}-num` },
      h(
        'div',
        { class: 'qcard__head' },
        h('h2', { class: 'qcard__num', id: `${id}-num`, text: `Frage ${index + 1}` }),
        h('button', { class: 'btn btn--small btn--ghost', id: `${id}-up`, type: 'button', text: 'Nach oben', disabled: index === 0, onclick: () => move(-1) }),
        h('button', { class: 'btn btn--small btn--ghost', id: `${id}-down`, type: 'button', text: 'Nach unten', disabled: index === count - 1, onclick: () => move(1) }),
        h('button', {
          class: 'btn btn--small btn--danger',
          type: 'button',
          text: 'Entfernen',
          'aria-label': `Frage ${index + 1} entfernen`,
          onclick: () => {
            draft.questions.splice(index, 1);
            dirty = true;
            renderEditor();
          },
        }),
      ),
      h('label', { class: 'field', for: `${id}-text` }, h('span', { text: 'Frage' }), text),
      h(
        'div',
        { class: 'qcard__row' },
        h('label', { class: 'field', for: `${id}-type` }, h('span', { text: 'Fragetyp' }), typeSelect),
        h('label', { class: 'field', for: `${id}-time` }, h('span', { text: 'Zeit zum Antworten' }), time),
      ),
      h('p', { class: 'hint', text: q.type === 'truefalse' ? 'Markiere die richtige Aussage.' : 'Trage 2 bis 4 Antworten ein und markiere mindestens eine als richtig.' }),
      opts,
    );
  }

  function saveDraft(andStart) {
    const found = problems(draft);
    const box = document.getElementById('editor-errors');
    root.querySelectorAll('.qcard').forEach((c) => c.removeAttribute('aria-invalid'));
    if (found.length) {
      box.replaceChildren(h('p', { text: 'Bitte noch korrigieren:' }), h('ul', null, found.slice(0, 6).map((p) => h('li', { text: p.text }))));
      const first = found.find((p) => p.index >= 0);
      found.forEach((p) => {
        const card = document.getElementById(`q${p.index}-card`);
        if (card) card.setAttribute('aria-invalid', 'true');
      });
      if (first) document.getElementById(`q${first.index}-text`).focus();
      return;
    }
    box.replaceChildren();
    upsertQuiz(draft);
    dirty = false;
    if (andStart) startGame(draft);
    else toast('Gespeichert.');
  }

  // ---------- Spiel starten und fortsetzen ----------

  async function startGame(quiz) {
    const found = problems(quiz);
    if (found.length) {
      toast('Das Quiz ist noch nicht vollständig.');
      openEditor(quiz);
      setTimeout(() => saveDraft(false), 0);
      return;
    }
    const payload = toPayload(quiz);
    let res = await emit(socket, 'host:create', { quiz: payload, password: session.get(PW_KEY, '') });
    if (!res.ok && res.code === 'password') {
      const pw = await askPassword(session.get(PW_KEY) ? 'Das Passwort stimmt nicht.' : '');
      if (pw === null) return;
      session.set(PW_KEY, pw);
      return startGame(quiz);
    }
    if (!res.ok) return toast(res.error);
    session.set(GAME_KEY, { pin: res.pin, hostToken: res.hostToken, title: payload.title, questions: payload.questions.length });
    mode = 'game';
    keepAwake(true);
  }

  function askPassword(errorText) {
    const dialog = document.getElementById('pw-dialog');
    const input = document.getElementById('pw-input');
    document.getElementById('pw-error').textContent = errorText || '';
    input.value = '';
    return new Promise((resolve) => {
      dialog.addEventListener(
        'close',
        () => {
          resolve(dialog.returnValue === 'ok' && input.value ? input.value : null);
        },
        { once: true },
      );
      dialog.showModal();
      input.focus();
    });
  }

  socket.on('connect', async () => {
    const saved = session.get(GAME_KEY);
    if (!saved) return;
    const res = await emit(socket, 'host:resume', saved);
    if (!res.ok) {
      session.remove(GAME_KEY);
      toast(res.error);
      if (mode === 'game') renderLibrary();
    } else {
      mode = 'game';
      keepAwake(true);
    }
  });

  socket.on('disconnect', () => {
    if (mode === 'game') toast('Verbindung zum Server unterbrochen. Ich verbinde neu …');
  });

  socket.on('host:state', (s) => {
    if (mode !== 'game') mode = 'game';
    renderGame(s);
  });

  socket.on('game:closed', ({ reason }) => {
    session.remove(GAME_KEY);
    game = null;
    if (!endingByMe) toast(reason || 'Das Spiel wurde beendet.');
    endingByMe = false;
    renderLibrary();
  });

  async function next(button) {
    if (button) button.disabled = true;
    const res = await emit(socket, 'host:next');
    if (button) button.disabled = false;
    if (!res.ok) toast(res.error);
  }

  async function endGame(ask) {
    if (ask && !window.confirm('Spiel wirklich beenden? Alle Spieler werden getrennt.')) return;
    endingByMe = true;
    const res = await emit(socket, 'host:end');
    if (!res.ok) {
      endingByMe = false;
      session.remove(GAME_KEY);
      renderLibrary();
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }

  // ---------- Ansicht: laufendes Spiel (Beamer) ----------

  function renderGame(s) {
    game = s;
    const key = `${s.state}|${s.qIndex}`;
    if (key === renderedKey) return updateLive(s);
    renderedKey = key;
    stopTimer();
    stopTimer = () => {};
    refs = {};

    const progress = s.qIndex >= 0 && s.state !== 'podium' ? `Frage ${s.qIndex + 1} von ${s.qCount}` : s.title;
    const header = h(
      'header',
      { class: 'host-bar' },
      h('span', { class: 'wordmark', text: 'Quizrunde' }),
      h(
        'div',
        { class: 'host-bar__meta' },
        h('span', { text: progress }),
        h('span', null, 'PIN ', h('span', { class: 'host-bar__pin', text: formatPin(s.pin) })),
        h('button', { class: 'btn btn--small btn--ghost', type: 'button', text: 'Vollbild', onclick: toggleFullscreen }),
        h('button', { class: 'btn btn--small btn--danger', type: 'button', text: 'Spiel beenden', onclick: () => endGame(true) }),
      ),
    );
    const stage = h('main', { class: 'stage' });
    root.replaceChildren(header, stage);

    switch (s.state) {
      case 'lobby':
        stageLobby(stage, s);
        break;
      case 'countdown':
        stageCountdown(stage, s);
        break;
      case 'question':
        stageQuestion(stage, s);
        break;
      case 'reveal':
        stageReveal(stage, s);
        break;
      case 'leaderboard':
        stageLeaderboard(stage, s);
        break;
      case 'podium':
        stagePodium(stage, s);
        break;
      default:
        break;
    }
    const primary = stage.querySelector('[data-primary]');
    if (primary) primary.focus({ preventScroll: true });
  }

  function updateLive(s) {
    if (s.state === 'lobby') updatePlayers(s);
    if (s.state === 'question' && refs.answered) {
      refs.answered.textContent = String(s.answeredCount);
      refs.answeredOf.textContent = ` von ${s.activeCount} haben geantwortet`;
    }
  }

  function formatPin(pin) {
    return `${pin.slice(0, 3)} ${pin.slice(3)}`;
  }

  function nextButton(label, extra = {}) {
    const btn = h('button', { class: 'btn btn--big', type: 'button', text: label, 'data-primary': true, ...extra });
    btn.addEventListener('click', () => next(btn));
    return btn;
  }

  function stageLobby(stage, s) {
    const joinUrl = `${location.origin}/?pin=${s.pin}`;
    let qrImg = null;
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(joinUrl);
      qr.make();
      qrImg = h('img', { src: qr.createDataURL(8, 0), alt: `QR-Code zum Beitreten mit PIN ${s.pin}`, width: '240', height: '240' });
    } catch {
      qrImg = null;
    }

    refs.count = h('span', { class: 'display lobby__count' });
    refs.countLabel = h('span', { class: 'lead' });
    refs.chips = h('ul', { class: 'chips', 'aria-label': 'Beigetretene Spieler' });
    refs.start = nextButton('Spiel starten');

    stage.append(
      h(
        'div',
        { class: 'lobby' },
        h(
          'section',
          { class: 'lobby__join', 'aria-label': 'So spielst du mit' },
          h('h1', { class: 'lobby__how' }, 'Öffne ', h('span', { class: 'lobby__url', text: location.host }), ' und gib diese PIN ein:'),
          h('p', { class: 'display lobby__pin', 'aria-label': `PIN ${s.pin.split('').join(' ')}`, text: formatPin(s.pin) }),
          qrImg ? h('div', { class: 'lobby__qr' }, qrImg, h('p', { class: 'lead', text: 'Oder den Code mit der Handykamera scannen.' })) : null,
        ),
        h(
          'section',
          { class: 'lobby__players', 'aria-label': 'Spieler' },
          h('p', null, refs.count, ' ', refs.countLabel),
          refs.chips,
        ),
      ),
      h('div', { class: 'host-actions' }, refs.start),
    );
    updatePlayers(s);
  }

  function updatePlayers(s) {
    if (!refs.chips) return;
    const n = s.players.length;
    refs.count.textContent = String(n);
    refs.countLabel.textContent = n === 1 ? 'Spieler ist dabei' : 'Spieler sind dabei';
    refs.start.disabled = n === 0;
    const items = s.players.map((p) =>
      h(
        'li',
        { class: `chip${p.connected ? '' : ' is-away'}` },
        h('span', { text: p.nickname }),
        p.connected ? null : h('span', { class: 'visually-hidden', text: '(nicht verbunden)' }),
        h('button', {
          class: 'chip__kick',
          type: 'button',
          'aria-label': `${p.nickname} entfernen`,
          title: 'Entfernen',
          text: '×',
          onclick: async () => {
            const res = await emit(socket, 'host:kick', { playerId: p.id });
            if (!res.ok) toast(res.error);
          },
        }),
      ),
    );
    if (!n) items.push(h('li', { class: 'hint', text: 'Noch niemand da. Die Namen erscheinen hier, sobald jemand beitritt.' }));
    refs.chips.replaceChildren(...items);
  }

  function questionHead(s, extraClass) {
    return h(
      'div',
      { class: `q-head${extraClass ? ` ${extraClass}` : ''}` },
      h('p', { class: 'q-progress', text: `Frage ${s.qIndex + 1} von ${s.qCount}` }),
      h('h1', { class: 'q-text', text: s.question.text }),
    );
  }

  function stageCountdown(stage, s) {
    const fill = h('div', { class: 'timebar__fill' });
    stage.append(
      h(
        'div',
        { class: 'countdown' },
        h('p', { class: 'q-progress', text: `Frage ${s.qIndex + 1} von ${s.qCount}` }),
        h('h1', { class: 'q-text', text: s.question.text }),
      ),
      h('div', { class: 'timebar', 'aria-hidden': 'true' }, fill),
    );
    stopTimer = startTimer({ remainingMs: s.remainingMs, totalMs: s.remainingMs, fillEl: fill });
    announce(`Frage ${s.qIndex + 1}: ${s.question.text}`);
  }

  function stageQuestion(stage, s) {
    const timer = h('span', { class: 'display q-timer', 'aria-hidden': 'true' });
    const fill = h('div', { class: 'timebar__fill' });
    refs.answered = h('span', { class: 'display' });
    refs.answeredOf = h('span');
    const grid = h('div', { class: 'opt-grid' }, s.question.options.map((text, i) => optionTile('div', text, i)));
    stage.append(
      questionHead(s),
      h('div', { class: 'q-status' }, timer, h('p', { class: 'q-answered', 'aria-live': 'off' }, refs.answered, refs.answeredOf)),
      h('div', { class: 'timebar', 'aria-hidden': 'true' }, fill),
      grid,
      h('div', { class: 'host-actions' }, nextButton('Frage beenden', { class: 'btn btn--ghost' })),
    );
    updateLive(s);
    stopTimer = startTimer({ remainingMs: s.remainingMs, totalMs: s.question.timeLimit * 1000, numberEl: timer, fillEl: fill });
  }

  function stageReveal(stage, s) {
    const q = s.question;
    const max = Math.max(1, ...s.counts);
    const bars = h('div', { class: 'bars', 'aria-hidden': 'true' });
    bars.style.setProperty('--n', String(q.options.length));
    q.options.forEach((_, i) => {
      const fillEl = h('div', { class: 'bar__fill' });
      fillEl.style.height = `${(s.counts[i] / max) * 100}%`;
      bars.append(
        h(
          'div',
          { class: `bar${q.correct.includes(i) ? '' : ' is-dim'}`, dataset: { i: String(i) } },
          h('span', { class: 'display bar__value', text: String(s.counts[i]) }),
          h('div', { class: 'bar__track' }, fillEl),
        ),
      );
    });
    const grid = h(
      'div',
      { class: 'opt-grid' },
      q.options.map((text, i) => {
        const right = q.correct.includes(i);
        const tile = optionTile('div', text, i, { class: `opt opt--reveal${right ? '' : ' is-dim'}` });
        tile.append(h('span', { class: 'opt__mark', text: right ? `✓ Richtig, ${s.counts[i]} ${s.counts[i] === 1 ? 'Antwort' : 'Antworten'}` : `${s.counts[i]} ${s.counts[i] === 1 ? 'Antwort' : 'Antworten'}` }));
        return tile;
      }),
    );
    stage.classList.add('stage--reveal');
    stage.append(questionHead(s), bars, grid, h('div', { class: 'host-actions' }, nextButton(s.isLast ? 'Endergebnis zeigen' : 'Zwischenstand zeigen')));
    const rightTexts = q.correct.map((i) => `${LETTERS[i]}: ${q.options[i]}`).join(', ');
    announce(`Richtig ist ${rightTexts}.`);
  }

  function stageLeaderboard(stage, s) {
    const rows = s.leaderboard.map((r) =>
      h(
        'li',
        { class: 'board__row' },
        h('span', { class: 'board__rank', text: `${r.rank}.` }),
        h('span', { class: 'board__name', text: r.nickname }),
        h('span', { class: 'board__delta', text: r.delta > 0 ? `+${num(r.delta)}` : '' }),
        h('span', { class: 'board__score', text: num(r.score) }),
      ),
    );
    stage.append(
      h('h1', { class: 'display stage-title', text: 'Zwischenstand' }),
      h('ol', { class: 'board', 'aria-label': 'Die besten fünf' }, rows),
      h('div', { class: 'host-actions' }, nextButton('Nächste Frage')),
    );
  }

  function stagePodium(stage, s) {
    const cols = [2, 1, 3].map((place) => {
      const entries = s.podium.filter((r) => r.rank === place);
      return h(
        'div',
        { class: 'podium__col', dataset: { place: String(place) } },
        h('p', { class: 'podium__name', text: entries.map((e) => e.nickname).join(', ') || ' ' }),
        h('p', { class: 'podium__score', text: entries.length ? `${num(entries[0].score)} Punkte` : ' ' }),
        h('div', { class: 'podium__block display', 'aria-hidden': 'true', text: String(place) }),
      );
    });
    stage.append(
      h('h1', { class: 'display stage-title', text: 'Endergebnis' }),
      h('div', { class: 'podium', role: 'list', 'aria-label': 'Podium' }, cols.map((c) => (c.setAttribute('role', 'listitem'), c))),
      h(
        'div',
        { class: 'host-actions' },
        h('button', { class: 'btn btn--ghost btn--big', type: 'button', text: 'Ergebnisse als CSV', onclick: () => exportCsv(s.report) }),
        h('button', { class: 'btn btn--big', type: 'button', text: 'Spiel schließen', 'data-primary': true, onclick: () => endGame(false) }),
      ),
    );
    const winners = s.podium.filter((r) => r.rank === 1).map((r) => r.nickname).join(' und ');
    announce(`Endergebnis. Platz 1: ${winners}.`);
    keepAwake(false);
  }

  function exportCsv(report) {
    if (!report) return;
    const head = ['Platz', 'Spielname', 'Punkte', 'Richtige Antworten'];
    report.questions.forEach((_, i) => head.push(`F${i + 1} Antwort`, `F${i + 1} richtig`, `F${i + 1} Sekunden`, `F${i + 1} Punkte`));
    const rows = [head];
    for (const p of report.players) {
      const row = [p.rank, p.nickname, p.score, p.correctCount];
      p.answers.forEach((a, i) => {
        if (!a) row.push('–', 'nein', '', 0);
        else row.push(`${LETTERS[a.choice]}: ${report.questions[i].options[a.choice]}`, a.correct ? 'ja' : 'nein', (a.elapsedMs / 1000).toFixed(1).replace('.', ','), a.points);
      });
      rows.push(row);
    }
    const date = new Date().toISOString().slice(0, 10);
    download(`${slug(report.title)}-${date}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  }

  // Präsentations-Fernbedienungen senden Pfeil rechts / Bild runter.
  document.addEventListener('keydown', (e) => {
    if (mode !== 'game' || !game) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      if (['lobby', 'question', 'reveal', 'leaderboard'].includes(game.state) && !(game.state === 'lobby' && game.players.length === 0)) {
        e.preventDefault();
        next();
      }
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (mode === 'editor' && dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Start: laufendes Spiel fortsetzen oder Bibliothek zeigen
  if (session.get(GAME_KEY)) {
    mode = 'game';
    root.replaceChildren(h('main', { class: 'work' }, h('p', { class: 'lead', text: 'Verbinde mit deinem laufenden Spiel …' })));
  } else {
    renderLibrary();
  }
})();
