'use strict';

(function () {
  const { APP_NAME, LETTERS, h, avatar, num, optionTile, startTimer, reducedMotion, countUp, pulse, awardTitle, awardDetail, awardColor, flameIcon, doubleBadge, store, toast, announce, toCsv, download, keepAwake } = window.LQ;
  const FX = window.LQFX;
  const local = store('local');
  const session = store('session');
  const LIB_KEY = 'leaqiz.quizzes';
  const GAME_KEY = 'leaqiz.hostGame';
  const TIME_LIMITS = [5, 10, 20, 30, 45, 60, 90, 120, 240];

  const root = document.getElementById('app');

  let mode = 'library'; // library | editor | game
  let draft = null; // Quiz im Editor
  let dirty = false;
  let game = null; // letzter Host-Zustand
  let renderedKey = '';
  let refs = {};
  let stopTimer = () => {};

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
        { type: 'quiz', text: 'Welches Element hat das chemische Symbol Fe?', options: ['Fluor', 'Gold', 'Blei', 'Eisen'], correct: [3], timeLimit: 20, double: true },
        { type: 'truefalse', text: 'Die Chinesische Mauer ist vom Mond aus mit bloßem Auge zu sehen.', options: ['Wahr', 'Falsch'], correct: [1], timeLimit: 10 },
        { type: 'quiz', text: 'Wer schrieb „Faust“?', options: ['Friedrich Schiller', 'Johann Wolfgang von Goethe', 'Gotthold Ephraim Lessing', 'Heinrich von Kleist'], correct: [1], timeLimit: 20 },
      ],
    };
  }

  // ---------- Bibliothek (nur im Browser des Hosts gespeichert) ----------

  function loadQuizzes() {
    // Einmalige Übernahme aus der Zeit vor der Umbenennung
    if (local.get(LIB_KEY, null) === null && Array.isArray(local.get('quizrunde.quizzes', null))) {
      local.set(LIB_KEY, local.get('quizrunde.quizzes'));
      local.remove('quizrunde.quizzes');
    }
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
      return { type: 'truefalse', text: q.text.trim(), options: ['Wahr', 'Falsch'], correct: [q.correct[0] === 1 ? 1 : 0], timeLimit: q.timeLimit, double: q.double === true };
    }
    const options = [];
    const correct = [];
    q.options.forEach((o, i) => {
      const text = String(o || '').trim();
      if (!text) return;
      if (q.correct.includes(i)) correct.push(options.length);
      options.push(text);
    });
    return { type: 'quiz', text: q.text.trim(), options, correct, timeLimit: q.timeLimit, double: q.double === true };
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
      return { type, text: String((q && q.text) || '').slice(0, 300), options, correct, timeLimit, double: Boolean(q && q.double === true) };
    });
    return { id: uid(), title: String(raw.title || 'Importiertes Quiz').slice(0, 120), updatedAt: Date.now(), questions };
  }

  // ---------- Ansicht: Bibliothek ----------

  function renderLibrary() {
    mode = 'library';
    setPhase('home', 'dark');
    window.scrollTo(0, 0);
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

    // Startseite: dunkle Bühne, jedes Quiz als farbige Kachel (Antwortfarben im Wechsel)
    const tiles = quizzes.map((quiz, i) => {
      const date = new Date(quiz.updatedAt || Date.now()).toLocaleDateString('de-DE');
      const n = quiz.questions.length;
      const doubles = quiz.questions.filter((q) => q.double === true).length;
      const titleId = `quiz-${i}-title`;
      return h(
        'li',
        { class: 'quiz-tile', dataset: { i: String(i % 4) }, 'aria-labelledby': titleId },
        h('p', { class: 'quiz-tile__count num', 'aria-hidden': 'true', text: String(n) }),
        h(
          'div',
          { class: 'quiz-tile__head' },
          h('h2', { class: 'quiz-tile__title', id: titleId, text: quiz.title || 'Ohne Titel' }),
          h('p', { class: 'quiz-tile__meta', text: `${n} ${n === 1 ? 'Frage' : 'Fragen'}${doubles ? `, ${doubles} mit doppelten Punkten` : ''}. Geändert am ${date}` }),
        ),
        h(
          'div',
          { class: 'quiz-tile__main' },
          h('button', { class: 'btn btn--primary', type: 'button', text: 'Demo starten', 'aria-describedby': titleId, onclick: () => startGame(quiz, { demo: true }) }),
          h('button', { class: 'btn btn--quiet', type: 'button', text: 'Live-Spiel', title: 'Mit echten Handys (Netz und Relais nötig)', 'aria-describedby': titleId, onclick: () => startGame(quiz) }),
        ),
        h(
          'div',
          { class: 'quiz-tile__more' },
          h('button', { class: 'btn btn--link', type: 'button', text: 'Bearbeiten', 'aria-describedby': titleId, onclick: () => openEditor(quiz) }),
          h('button', {
            class: 'btn btn--link',
            type: 'button',
            text: 'Exportieren',
            'aria-describedby': titleId,
            onclick: () => {
              const { id, ...data } = quiz;
              download(`${slug(quiz.title)}.leaqizz.json`, JSON.stringify(data, null, 2), 'application/json');
            },
          }),
          h('button', {
            class: 'btn btn--link',
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
      );
    });
    tiles.push(
      h(
        'li',
        { class: 'quiz-new' },
        h(
          'button',
          { class: 'quiz-new__btn', type: 'button', onclick: () => openEditor(null) },
          h('span', { class: 'quiz-new__plus', 'aria-hidden': 'true', text: '+' }),
          h('span', { text: quizzes.length ? 'Neues Quiz' : 'Erstes Quiz anlegen' }),
        ),
      ),
    );

    root.replaceChildren(
      h(
        'header',
        { class: 'bar' },
        h('span', { class: 'wordmark', text: APP_NAME }),
        h('span', { class: 'bar__info', text: 'Spielleitung' }),
        h('div', { class: 'bar__actions' }, h('button', { class: 'btn btn--quiet btn--small', type: 'button', text: 'Importieren', title: 'Quiz-Datei (JSON) importieren', onclick: () => fileInput.click() }), fileInput),
      ),
      h(
        'main',
        { class: 'home' },
        h(
          'div',
          { class: 'home__head' },
          h('h1', { class: 'home__title', text: 'Was spielen wir heute?' }),
          h('p', { class: 'home__lead', text: 'Wähle ein Quiz. Die Demo startet sofort mit acht simulierten Mitspielenden, ganz ohne Handys und Netz.' }),
        ),
        h('ul', { class: 'quiz-grid', 'aria-label': 'Deine Quizze' }, tiles),
        h('p', { class: 'home__note', text: 'Quizze werden nur in diesem Browser gespeichert. Exportiere sie als Datei, um sie zu sichern oder weiterzugeben.' }),
      ),
    );
  }

  // ---------- Ansicht: Editor ----------

  function blankQuestion(type) {
    return type === 'truefalse'
      ? { type: 'truefalse', text: '', options: ['Wahr', 'Falsch'], correct: [0], timeLimit: 10, double: false }
      : { type: 'quiz', text: '', options: ['', '', '', ''], correct: [], timeLimit: 20, double: false };
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

  // Kleine Symbole (SVG, Farbe über currentColor)
  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const paths = {
      up: 'M12 5l-7 7h4.5v7h5v-7H19z',
      down: 'M12 19l7-7h-4.5V5h-5v7H5z',
      remove: 'M6.4 5L5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z',
      check: 'M9.5 16.2L5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4z',
      plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
    };
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', paths[name]);
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  }

  function editorMeta() {
    const n = draft.questions.length;
    const doubles = draft.questions.filter((q) => q.double === true).length;
    return `${n} ${n === 1 ? 'Frage' : 'Fragen'}${doubles ? `, ${doubles} mit doppelten Punkten` : ''}`;
  }

  function renderEditor(focusSelector) {
    mode = 'editor';
    setPhase('work', 'light');
    const errorBox = h('div', { class: 'error editor-errors', id: 'editor-errors', role: 'alert' });
    // Titel als mitwachsendes Textfeld (lange Titel umbrechen statt abschneiden), ohne Zeilenumbrüche
    const titleInput = h('textarea', { class: 'editor__title', id: 'quiz-title', maxlength: '120', rows: '1', placeholder: 'Wie heißt dein Quiz?', autocomplete: 'off' });
    titleInput.value = draft.title;
    const fit = () => {
      titleInput.style.height = 'auto';
      titleInput.style.height = `${titleInput.scrollHeight}px`;
    };
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    titleInput.addEventListener('input', () => {
      titleInput.value = titleInput.value.replace(/[\r\n]+/g, ' ');
      draft.title = titleInput.value;
      dirty = true;
      fit();
    });

    const cards = draft.questions.map((q, index) => questionCard(q, index));

    root.replaceChildren(
      h(
        'header',
        { class: 'bar bar--ink' },
        h('span', { class: 'wordmark', text: APP_NAME }),
        h('div', { class: 'bar__actions' }, h('button', { class: 'btn btn--small btn--quiet', type: 'button', text: 'Zur Übersicht', onclick: leaveEditor })),
      ),
      h(
        'main',
        { class: 'editor' },
        h(
          'div',
          { class: 'editor__hero' },
          h(
            'div',
            { class: 'editor__inner' },
            h('h1', { class: 'visually-hidden', text: draft.title ? 'Quiz bearbeiten' : 'Neues Quiz' }),
            h('label', { class: 'editor__kicker', for: 'quiz-title', text: 'Titel des Quiz' }),
            titleInput,
            h('p', { class: 'editor__meta', id: 'editor-meta', text: editorMeta() }),
          ),
        ),
        h(
          'div',
          { class: 'editor__inner editor__body' },
          errorBox,
          ...cards,
          h(
            'div',
            { class: 'editor__add' },
            h('button', { class: 'add-tile', type: 'button', onclick: () => addQuestion('quiz') }, icon('plus'), h('span', { text: 'Multiple-Choice-Frage' })),
            h('button', { class: 'add-tile', type: 'button', onclick: () => addQuestion('truefalse') }, icon('plus'), h('span', { text: 'Wahr/Falsch-Frage' })),
          ),
        ),
      ),
      h(
        'div',
        { class: 'savebar' },
        h(
          'div',
          { class: 'savebar__inner' },
          h('button', { class: 'btn btn--quiet', type: 'button', text: 'Speichern', onclick: () => saveDraft(false) }),
          h('button', { class: 'btn', type: 'button', text: 'Speichern und Demo starten', onclick: () => saveDraft(true) }),
        ),
      ),
    );
    fit();
    if (focusSelector) {
      const el = root.querySelector(focusSelector);
      if (el) el.focus();
    } else window.scrollTo(0, 0);
  }

  function refreshMeta() {
    const el = document.getElementById('editor-meta');
    if (el) el.textContent = editorMeta();
  }

  let newCard = -1; // gerade hinzugefügte Frage (gleitet ein)

  function addQuestion(type) {
    draft.questions.push(blankQuestion(type));
    dirty = true;
    newCard = draft.questions.length - 1;
    renderEditor();
    newCard = -1;
    const card = document.getElementById(`q${draft.questions.length - 1}-card`);
    if (card) {
      card.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      document.getElementById(`q${draft.questions.length - 1}-text`).focus({ preventScroll: true });
    }
  }

  function questionCard(q, index) {
    const id = `q${index}`;
    const count = draft.questions.length;
    const num = index + 1;

    const typeSelect = h(
      'select',
      { class: 'input input--select', id: `${id}-type` },
      h('option', { value: 'quiz', text: 'Multiple Choice', selected: q.type === 'quiz' }),
      h('option', { value: 'truefalse', text: 'Wahr/Falsch', selected: q.type === 'truefalse' }),
    );
    typeSelect.addEventListener('change', () => {
      const next = blankQuestion(typeSelect.value);
      next.text = q.text;
      next.double = q.double === true;
      draft.questions[index] = next;
      dirty = true;
      renderEditor(`#${id}-type`);
    });

    const text = h('textarea', { class: 'qcard__text', id: `${id}-text`, maxlength: '300', rows: '2', placeholder: 'Wie lautet die Frage?' });
    text.value = q.text;
    text.addEventListener('input', () => {
      q.text = text.value;
      dirty = true;
    });

    const time = h(
      'select',
      { class: 'input input--select', id: `${id}-time` },
      TIME_LIMITS.map((t) => h('option', { value: String(t), text: `${t} Sekunden`, selected: q.timeLimit === t })),
    );
    time.addEventListener('change', () => {
      q.timeLimit = Number(time.value);
      dirty = true;
    });

    const doubleBox = h('input', { type: 'checkbox', class: 'switch', id: `${id}-double`, checked: q.double === true });
    doubleBox.addEventListener('change', () => {
      q.double = doubleBox.checked;
      dirty = true;
      refreshMeta();
    });

    // Antworten in ihrer Spielfarbe; „richtig“ als Haken in derselben Farbe
    const opts = h('div', { class: 'qopts', role: 'group', 'aria-label': `Antworten für Frage ${num}` });
    q.options.forEach((value, i) => {
      let field;
      if (q.type === 'truefalse') {
        field = h('span', { class: 'qopt__fixed', text: value });
      } else {
        field = h('input', { class: 'qopt__input', id: `${id}-o${i}`, maxlength: '90', value, 'aria-label': `Antwort ${LETTERS[i]}`, placeholder: i < 2 ? 'Antwort' : 'Antwort (optional)', autocomplete: 'off' });
        field.addEventListener('input', () => {
          q.options[i] = field.value;
          dirty = true;
        });
      }
      const mark = h('input', {
        type: q.type === 'truefalse' ? 'radio' : 'checkbox',
        class: 'qopt__mark',
        name: `${id}-correct`,
        checked: q.correct.includes(i),
        'aria-label': `Antwort ${LETTERS[i]} ist richtig`,
        title: 'Richtige Antwort',
      });
      mark.addEventListener('change', () => {
        if (q.type === 'truefalse') q.correct = [i];
        else q.correct = mark.checked ? [...new Set([...q.correct, i])] : q.correct.filter((c) => c !== i);
        dirty = true;
      });
      opts.append(
        h(
          'div',
          { class: 'qopt', dataset: { i: String(i) } },
          h('span', { class: 'qopt__letter', 'aria-hidden': 'true', text: LETTERS[i] }),
          field,
          h('label', { class: 'qopt__check' }, mark, icon('check')),
        ),
      );
    });

    const move = (delta) => {
      const target = index + delta;
      [draft.questions[index], draft.questions[target]] = [draft.questions[target], draft.questions[index]];
      dirty = true;
      renderEditor(`#q${target}-${delta < 0 ? 'up' : 'down'}`);
    };

    const tool = (name, label, attrs) => h('button', { class: 'tool', type: 'button', 'aria-label': label, title: label, ...attrs }, icon(name));

    return h(
      'section',
      { class: `qcard${index === newCard ? ' is-new' : ''}`, id: `${id}-card`, 'aria-labelledby': `${id}-num` },
      h(
        'div',
        { class: 'qcard__head' },
        h('h2', { class: 'qcard__num', id: `${id}-num` }, h('span', { class: 'qcard__label', text: 'Frage ' }), h('span', { class: 'num', text: String(num) })),
        h(
          'div',
          { class: 'qcard__tools' },
          tool('up', `Frage ${num} nach oben`, { id: `${id}-up`, disabled: index === 0, onclick: () => move(-1) }),
          tool('down', `Frage ${num} nach unten`, { id: `${id}-down`, disabled: index === count - 1, onclick: () => move(1) }),
          tool('remove', `Frage ${num} entfernen`, {
            class: 'tool tool--danger',
            onclick: () => {
              if ((q.text || q.options.some((o) => o && o !== 'Wahr' && o !== 'Falsch')) && !window.confirm(`Frage ${num} entfernen?`)) return;
              const remove = () => {
                draft.questions.splice(index, 1);
                dirty = true;
                renderEditor(`#q${Math.max(0, index - 1)}-text`);
              };
              const card = document.getElementById(`${id}-card`);
              if (!card || reducedMotion()) return remove();
              // Karte klappt zusammen, dann rücken die anderen nach
              const anim = card.animate(
                [
                  { opacity: 1, transform: 'none' },
                  { opacity: 0, transform: 'scale(0.96)' },
                ],
                { duration: 180, easing: 'ease-in' },
              );
              anim.finished.then(remove, remove);
            },
          }),
        ),
      ),
      h('label', { class: 'visually-hidden', for: `${id}-text`, text: `Text der Frage ${num}` }),
      text,
      h(
        'div',
        { class: 'qcard__row' },
        h('label', { class: 'field field--small', for: `${id}-type` }, h('span', { text: 'Fragetyp' }), typeSelect),
        h('label', { class: 'field field--small', for: `${id}-time` }, h('span', { text: 'Zeit' }), time),
      ),
      h('p', { class: 'qcard__hint', text: q.type === 'truefalse' ? 'Tippe auf den Haken der richtigen Aussage.' : 'Bis zu 4 Antworten. Mindestens eine mit Haken als richtig markieren.' }),
      opts,
      h('label', { class: 'qcard__double', for: `${id}-double` }, doubleBox, h('span', { text: 'Doppelte Punkte' })),
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
      box.scrollIntoView({ block: 'center' });
      if (first) document.getElementById(`q${first.index}-text`).focus({ preventScroll: true });
      return;
    }
    box.replaceChildren();
    upsertQuiz(draft);
    dirty = false;
    if (andStart) startGame(draft, { demo: true });
    else toast('Gespeichert.');
  }

  // ---------- Spiel starten und fortsetzen ----------
  // Dieser Browser ist der Spiel-Server: Host-Engine + Direktverbindung zu den Spielern.

  const { HostEngine, randomPin } = window.LeaqizEngine;
  const { validateQuiz } = window.LeaqizValidate;
  let engine = null;
  let link = null;
  let netOnline = true;
  let demo = null; // { bots } während einer Demo

  function engineHooks() {
    return {
      send: (connId, msg) => {
        if (demo && demo.bots.has(connId)) demo.bots.receive(connId, msg);
        else if (link) link.send(connId, msg);
      },
      onChange: (view) => {
        saveGame();
        if (mode === 'game') renderGame(view);
      },
    };
  }

  // Spielstand im Tab sichern, damit Neuladen das Spiel nicht beendet
  // Demos werden nicht gesichert: simulierte Mitspielende lassen sich nicht wiederherstellen
  function saveGame() {
    if (engine && !engine.closed && !demo) session.set(GAME_KEY, engine.snapshot());
  }

  function openLink(pin, isDemo = false) {
    const Link = isDemo ? window.LQNet.LocalHostLink : window.LQNet.HostLink;
    link = new Link({
      pin,
      onConnection: (id) => engine && engine.attach(id),
      onData: (id, msg) => engine && engine.handle(id, msg),
      onClose: (id) => engine && engine.detach(id),
      onStatus: (status) => {
        netOnline = status === 'online';
        updateNetStatus();
      },
    });
    return link.open();
  }

  function dropLink() {
    if (link) link.destroy();
    link = null;
  }

  function busy(text) {
    mode = 'busy';
    renderedKey = '';
    setPhase('work', 'light');
    root.replaceChildren(h('main', { class: 'work' }, h('p', { class: 'lead', role: 'status', text })));
  }

  async function startGame(quiz, { demo: isDemo = false } = {}) {
    const found = problems(quiz);
    if (found.length) {
      toast('Das Quiz ist noch nicht vollständig.');
      openEditor(quiz);
      setTimeout(() => saveDraft(false), 0);
      return;
    }
    let payload;
    try {
      payload = validateQuiz(toPayload(quiz));
    } catch (err) {
      toast(err.message);
      return;
    }
    busy(isDemo ? 'Demo wird vorbereitet …' : 'Spiel wird vorbereitet …');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pin = randomPin();
      try {
        await openLink(pin, isDemo);
      } catch (err) {
        dropLink();
        if (err.code === 'taken') continue; // PIN schon vergeben: neue würfeln
        toast('Keine Verbindung zum Vermittlungsserver. Bitte Internet prüfen und erneut versuchen.');
        renderLibrary();
        return;
      }
      engine = HostEngine.create({ quiz: payload, pin, ...engineHooks() });
      demo = isDemo ? { bots: window.LQDemo.createBots({ engine, count: 8 }) } : null;
      mode = 'game';
      keepAwake(true);
      saveGame();
      renderGame(engine.hostView());
      return;
    }
    toast('Gerade ist keine Spiel-PIN frei. Bitte erneut versuchen.');
    renderLibrary();
  }

  async function resumeGame(snapshot) {
    try {
      engine = HostEngine.restore(snapshot, engineHooks());
    } catch {
      session.remove(GAME_KEY);
      renderLibrary();
      return;
    }
    mode = 'game';
    netOnline = false;
    renderGame(engine.hostView());
    updateNetStatus();
    // Die PIN kann nach dem Neuladen noch kurz belegt sein: bis zu 1 Minute erneut versuchen
    for (let i = 0; i < 20 && engine; i += 1) {
      try {
        await openLink(engine.pin);
        keepAwake(true);
        return;
      } catch {
        dropLink();
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if (engine) toast('Das Spiel ist nicht mehr erreichbar. Bitte neu starten.');
  }

  function updateNetStatus() {
    const el = document.getElementById('net-status');
    if (!el) return;
    el.textContent = netOnline ? '' : 'Vermittlung getrennt: Neue Spieler können gerade nicht beitreten. Ich verbinde neu …';
  }

  function next() {
    if (!engine) return;
    try {
      engine.next();
    } catch (err) {
      toast(err.message);
    }
  }

  function endGame(ask) {
    if (ask && !window.confirm('Spiel wirklich beenden? Alle Spieler werden getrennt.')) return;
    if (engine) engine.end();
    if (demo) demo.bots.stop();
    demo = null;
    closeDock();
    engine = null;
    game = null;
    session.remove(GAME_KEY);
    // Kurz warten, damit die Abschiedsnachricht bei den Spielern ankommt
    const old = link;
    link = null;
    setTimeout(() => old && old.destroy(), 800);
    renderLibrary();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }

  // ---------- Ansicht: laufendes Spiel (Beamer) ----------
  // Dunkle Bühne (Lobby, Countdown, Podium), helle Lesefläche (Frage, Zwischenstand),
  // Farbflut der richtigen Antwort (Auflösung).

  const PHASE_TONE = { lobby: 'dark', countdown: 'dark', question: 'light', reveal: 'flood', leaderboard: 'light', podium: 'dark' };

  function setPhase(phase, tone, floodIndex) {
    document.documentElement.dataset.view = phase === 'work' || phase === 'home' ? 'work' : 'stage';
    document.documentElement.dataset.tone = tone;
    root.dataset.phase = phase;
    root.dataset.tone = tone;
    if (floodIndex === null || floodIndex === undefined) delete root.dataset.flood;
    else root.dataset.flood = String(floodIndex);
  }

  function renderGame(s) {
    game = s;
    const key = `${s.state}|${s.qIndex}`;
    if (key === renderedKey) return updateLive(s);
    renderedKey = key;
    followPhase(s.state);
    stopTimer();
    stopTimer = () => {};
    refs = {};
    setPhase(s.state, PHASE_TONE[s.state] || 'light', s.state === 'reveal' && s.question ? s.question.correct[0] : null);

    const inQuestion = s.qIndex >= 0 && s.state !== 'podium' && s.state !== 'lobby';
    const header = h(
      'header',
      { class: 'bar' },
      h('span', { class: 'wordmark', text: APP_NAME }),
      h('span', { class: 'bar__info' }, demo ? h('span', { class: 'tag', text: 'Demo' }) : null, inQuestion ? `Frage ${s.qIndex + 1} von ${s.qCount}` : s.title),
      h(
        'div',
        { class: 'bar__actions' },
        h('span', { class: 'bar__pin' }, 'PIN ', h('strong', { text: formatPin(s.pin) })),
        soundButton(),
        h('button', { class: 'btn btn--quiet btn--small bar__fs', type: 'button', text: 'Vollbild', onclick: toggleFullscreen }),
        h('button', { class: 'btn btn--quiet btn--small', type: 'button', text: 'Spiel beenden', onclick: () => endGame(true) }),
      ),
    );
    const netStatus = h('p', { class: 'banner', id: 'net-status', role: 'status' });
    const stage = h('main', { class: 'stage' });
    root.replaceChildren(header, netStatus, stage);
    updateNetStatus();

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

  function soundButton() {
    const btn = h('button', { class: 'btn btn--quiet btn--small', type: 'button', title: 'Töne ein- oder ausschalten' });
    const label = () => {
      btn.textContent = FX.enabled ? 'Ton: an' : 'Ton: aus';
    };
    label();
    btn.addEventListener('click', () => {
      FX.setEnabled(!FX.enabled);
      label();
    });
    return btn;
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
    const btn = h('button', { class: 'btn btn--big btn--primary', type: 'button', text: label, 'data-primary': true, ...extra });
    btn.addEventListener('click', () => next(btn));
    return btn;
  }

  function actions(...children) {
    return h('div', { class: 'stage__actions' }, ...children);
  }

  function stageLobby(stage, s) {
    // Spieler-Seite liegt eine Ebene über /host/ (funktioniert auch unter github.io/leaqiz/)
    const appUrl = new URL('../', location.href);
    const joinUrl = `${appUrl.href}?pin=${s.pin}`;
    const shownHost = (appUrl.host + appUrl.pathname).replace(/\/$/, '');
    let qrImg = null;
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(joinUrl);
      qr.make();
      qrImg = h('img', { src: qr.createDataURL(8, 0), alt: `QR-Code zum Beitreten mit PIN ${s.pin}`, width: '240', height: '240' });
    } catch {
      qrImg = null;
    }

    refs.count = h('span', { class: 'num' });
    refs.countLabel = h('span');
    refs.chips = h('ul', { class: 'chips', 'aria-label': 'Beigetretene Spieler' });
    refs.start = nextButton('Spiel starten');

    const joinSection = demo
      ? h(
          'section',
          { class: 'lobby__join', 'aria-label': 'Demo' },
          h('h1', { class: 'lobby__how', text: 'Demo mit simulierten Mitspielenden' }),
          h('p', { class: 'lobby__pin num-pin', 'aria-label': `PIN ${s.pin.split('').join(' ')}`, text: formatPin(s.pin) }),
          h('div', { class: 'lobby__self' }, selfPlayButton(s.pin), h('p', { text: 'Zeigt deine Handy-Ansicht neben der Leinwand.' })),
        )
      : h(
          'section',
          { class: 'lobby__join', 'aria-label': 'So spielst du mit' },
          h('h1', { class: 'lobby__how' }, 'Mitspielen auf ', h('span', { class: 'lobby__url', text: shownHost })),
          h('p', { class: 'lobby__pin num-pin', 'aria-label': `PIN ${s.pin.split('').join(' ')}`, text: formatPin(s.pin) }),
          qrImg ? h('div', { class: 'lobby__qr' }, qrImg, h('p', { text: 'Oder den Code mit der Handykamera scannen' })) : null,
        );
    stage.append(
      h(
        'div',
        { class: 'lobby' },
        joinSection,
        h('section', { class: 'lobby__players', 'aria-label': 'Spieler' }, h('p', { class: 'lobby__count' }, refs.count, refs.countLabel), refs.chips),
      ),
      actions(refs.start),
    );
    updatePlayers(s);
  }

  // ---------- Demo: eigene Handy-Ansicht im selben Fenster ----------
  // Die Spielerseite läuft eingebettet neben (breiter Bildschirm) oder über (Handy) der Leinwand.
  // So bleiben beide aktiv: Browser pausieren Hintergrund-Tabs, besonders auf dem Handy.

  let dock = null;
  const narrow = () => window.matchMedia('(max-width: 1099px)').matches;

  function setDockOpen(open) {
    if (!dock) return;
    // Geschlossen auf dem Handy: per CSS ausgeblendet (visibility), das iframe läuft weiter
    document.documentElement.dataset.dock = open ? 'open' : 'closed';
    if (open && narrow()) dock.back.focus({ preventScroll: true });
  }

  function openDock(pin) {
    if (dock) return setDockOpen(true);
    const src = new URL(`../?pin=${pin}&demo=1`, location.href).href;
    const back = h('button', { class: 'btn btn--quiet btn--small dock__back', type: 'button', text: 'Zur Leinwand', onclick: () => setDockOpen(false) });
    const close = h('button', { class: 'btn btn--quiet btn--small dock__close', type: 'button', text: 'Schließen', onclick: () => closeDock() });
    const el = h(
      'aside',
      { class: 'dock', 'aria-label': 'Deine Handy-Ansicht' },
      h('div', { class: 'dock__bar' }, h('span', { text: 'Dein Handy' }), back, close),
      h('iframe', { class: 'dock__frame', title: 'Deine Handy-Ansicht', src }),
    );
    const toggle = h('button', { class: 'btn btn--primary dock__toggle', type: 'button', text: 'Mein Handy', onclick: () => setDockOpen(true) });
    document.body.append(el, toggle);
    dock = { el, toggle, back };
    setDockOpen(true);
  }

  function closeDock() {
    if (!dock) return;
    dock.el.remove();
    dock.toggle.remove();
    dock = null;
    delete document.documentElement.dataset.dock;
  }

  // Auf dem Handy automatisch wechseln: Fragen beantwortest du im Handy, Ergebnisse siehst du auf der Leinwand
  function followPhase(state) {
    if (!dock || !narrow()) return;
    if (state === 'question') setDockOpen(true);
    else if (state === 'reveal' || state === 'podium') setDockOpen(false);
  }

  function selfPlayButton(pin) {
    return h('button', { class: 'btn btn--quiet', type: 'button', text: 'Selbst mitspielen', onclick: () => openDock(pin) });
  }

  function updatePlayers(s) {
    if (!refs.chips) return;
    const n = s.players.length;
    refs.count.textContent = String(n);
    refs.countLabel.textContent = n === 1 ? 'Person ist dabei' : 'Personen sind dabei';
    refs.start.disabled = n === 0;
    // Bestehende Namen bleiben im DOM (erneutes Einfügen würde ihre Animation neu starten):
    // Entfernte löschen, neue hinten anhängen. Neue Namen kommen immer zuletzt hinzu.
    const existing = new Map([...refs.chips.querySelectorAll('.chip')].map((el) => [el.dataset.id, el]));
    const wanted = new Set(s.players.map((p) => p.id));
    for (const [id, el] of existing) if (!wanted.has(id)) el.remove();
    refs.chips.querySelectorAll('.lobby__empty').forEach((el) => el.remove());
    let added = 0;
    const fresh = s.players.map((p) => {
      const old = existing.get(p.id);
      if (old) {
        old.classList.toggle('is-away', !p.connected);
        // Avatar in der Lobby geändert: nur das Bild tauschen (springt kurz)
        const pic = old.querySelector('.avatar-pic');
        const next = avatar(p.avatar, p.nickname, 'is-new', { round: true });
        if (pic && pic.dataset.av !== next.dataset.av) pic.replaceWith(next);
        return null;
      }
      added += 1;
      return h(
        'li',
        { class: `chip${p.connected ? '' : ' is-away'}`, dataset: { id: p.id } },
        avatar(p.avatar, p.nickname, '', { round: true }),
        h('span', { text: p.nickname }),
        h('button', {
          class: 'chip__kick',
          type: 'button',
          'aria-label': `${p.nickname} entfernen`,
          title: 'Entfernen',
          text: '×',
          onclick: () => {
            try {
              if (engine) engine.kick(p.id);
            } catch (err) {
              toast(err.message);
            }
          },
        }),
      );
    });
    refs.chips.append(...fresh.filter(Boolean));
    if (!n) refs.chips.append(h('li', { class: 'lobby__empty', text: 'Noch niemand da. Die Namen erscheinen hier, sobald jemand beitritt.' }));
    if (added && refs.chipsReady) FX.play('join');
    refs.chipsReady = true;
  }

  function stageCountdown(stage, s) {
    const fill = h('div', { class: 'timebar__fill' });
    stage.append(
      h(
        'div',
        { class: 'countdown' },
        s.question.double ? doubleBadge() : null,
        h('div', { class: 'q-head' }, h('p', { class: 'kicker', text: `Frage ${s.qIndex + 1} von ${s.qCount}` }), h('h1', { class: 'q-text', text: s.question.text })),
        h('div', { class: 'timebar', 'aria-hidden': 'true' }, fill),
      ),
    );
    stopTimer = startTimer({ remainingMs: s.remainingMs, totalMs: s.remainingMs, fillEl: fill });
    FX.play(s.question.double ? 'double' : 'go');
    announce(`${s.question.double ? 'Doppelte Punkte. ' : ''}Frage ${s.qIndex + 1}: ${s.question.text}`);
  }


  function stageQuestion(stage, s) {
    const timer = h('span', { class: 'q-timer__num num', 'aria-hidden': 'true' });
    const fill = h('div', { class: 'timebar__fill' });
    refs.answered = h('strong', { class: 'num' });
    refs.answeredOf = h('span');
    stage.append(
      h(
        'div',
        { class: 'question' },
        h(
          'div',
          { class: 'q-top' },
          h('div', { class: 'q-head' }, h('p', { class: 'kicker', text: `Frage ${s.qIndex + 1} von ${s.qCount}` }), h('h1', { class: 'q-text', text: s.question.text })),
          h('div', { class: 'q-timer' }, timer, h('p', { class: 'q-answered' }, refs.answered, refs.answeredOf), s.question.double ? doubleBadge(true) : null),
        ),
        h('div', { class: 'timebar', 'aria-hidden': 'true' }, fill),
        h('div', { class: 'opt-grid' }, s.question.options.map((text, i) => optionTile('div', text, i))),
      ),
      actions(nextButton('Frage beenden', { class: 'btn btn--quiet' })),
    );
    updateLive(s);
    stopTimer = startTimer({
      remainingMs: s.remainingMs,
      totalMs: s.question.timeLimit * 1000,
      numberEl: timer,
      fillEl: fill,
      onSecond: (sec) => {
        if (sec > 0 && sec <= 5) {
          FX.play('tick');
          // Zeitdruck auch ohne Ton: Zahl pulsiert, Zeitleiste wird kräftiger
          stage.querySelector('.question')?.classList.add('is-urgent');
          pulse(timer);
        }
      },
    });
  }

  function stageReveal(stage, s) {
    const q = s.question;
    const right = q.correct;
    const max = Math.max(1, ...s.counts);
    const word = (n) => (n === 1 ? 'Antwort' : 'Antworten');
    const rows = q.options.map((text, i) => {
      const fill = h('span', { class: 'dist__fill' });
      fill.style.width = `${(s.counts[i] / max) * 100}%`;
      const isRight = right.includes(i);
      const row = h(
        'li',
        { class: `dist__row${isRight ? ' is-right' : ''}` },
        h('span', { class: 'dist__letter', 'aria-hidden': 'true', text: LETTERS[i] }),
        h('span', { class: 'dist__text' }, h('span', { class: 'visually-hidden', text: `Antwort ${LETTERS[i]}: ` }), text, isRight ? h('span', { class: 'visually-hidden', text: ' (richtig)' }) : null),
        h('span', { class: 'dist__bar', 'aria-hidden': 'true' }, fill),
        h('span', { class: 'dist__count num' }, String(s.counts[i]), h('span', { class: 'visually-hidden', text: ` ${word(s.counts[i])}` })),
      );
      row.style.setProperty('--i', String(i)); // Balken wachsen nacheinander
      return row;
    });
    stage.append(
      h(
        'div',
        { class: 'reveal' },
        h(
          'div',
          { class: 'reveal__hero' },
          h('p', { class: 'reveal__letter num', 'aria-hidden': 'true', text: right.map((i) => LETTERS[i]).join('+') }),
          h('p', { class: 'kicker', text: right.length > 1 ? 'Richtig sind' : 'Richtig ist' }),
          h('h1', { class: 'reveal__answer', text: right.map((i) => q.options[i]).join(' / ') }),
        ),
        h('div', { class: 'reveal__side' }, h('p', { class: 'reveal__question', text: q.text }), h('ol', { class: 'bars dist', 'aria-label': 'Verteilung der Antworten' }, rows)),
      ),
      actions(nextButton(s.isLast ? 'Endergebnis zeigen' : 'Zwischenstand zeigen')),
    );
    FX.play('reveal');
    announce(`Richtig ist ${right.map((i) => `${LETTERS[i]}: ${q.options[i]}`).join(', ')}.`);
  }

  function stageLeaderboard(stage, s) {
    const n = s.leaderboard.length;
    const counters = [];
    stopTimer = () => counters.forEach((stop) => stop());
    const rows = s.leaderboard.map((r, i) => {
      const streak =
        r.streak >= 3
          ? h('span', { class: 'streak' }, flameIcon(), h('span', { class: 'num', text: String(r.streak) }), h('span', { class: 'visually-hidden', text: ' richtige Antworten in Folge' }))
          : null;
      const move =
        r.move > 0
          ? h('span', { class: 'board__move' }, h('span', { 'aria-hidden': 'true', text: '▲ ' }), String(r.move), h('span', { class: 'visually-hidden', text: r.move === 1 ? ' Platz nach vorn' : ' Plätze nach vorn' }))
          : null;
      const row = h(
        'li',
        { class: 'board__row' },
        h('span', { class: 'board__rank', text: `${r.rank}.` }),
        h('span', { class: 'board__name' }, avatar(r.avatar, r.nickname), h('span', { text: r.nickname }), streak),
        h('span', { class: 'board__movecell' }, move),
        h('span', { class: 'board__delta', text: r.delta > 0 ? `+${num(r.delta)}` : '' }),
        h('span', { class: 'board__score' }),
      );
      const score = row.lastChild;
      const stop = countUp(score, Math.max(0, r.score - (r.delta || 0)), r.score, { ms: 900, delay: 300 });
      counters.push(stop);
      // Zeilen starten an ihrer alten Position (FLIP); wer von außerhalb kommt, gleitet von unten herein
      const from = r.posBefore === null ? i : Math.min(r.posBefore, n);
      row.dataset.shift = String(from - i);
      if (r.posBefore !== null && r.posBefore >= n) row.classList.add('is-new');
      return row;
    });
    const list = h('ol', { class: 'board', 'aria-label': 'Die besten fünf' }, rows);
    stage.append(h('div', { class: 'board-wrap' }, h('h1', { class: 'stage-title', text: 'Zwischenstand' }), list), actions(nextButton('Nächste Frage')));

    if (rows.some((row) => row.dataset.shift !== '0') && !FX.reducedMotion()) {
      const pitch = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : rows[0].offsetHeight;
      rows.forEach((row) => {
        const shift = Number(row.dataset.shift);
        row.style.setProperty('--from', `${shift * pitch}px`);
        if (shift > 0) row.classList.add('is-rising');
      });
      list.classList.add('is-sorting');
      const t = setTimeout(() => FX.play('shuffle'), 350);
      stopTimer = () => {
        clearTimeout(t);
        counters.forEach((stop) => stop());
      };
    }
  }

  // Finale: Platz 3, dann 2, Trommelwirbel, dann 1 mit Konfetti. Danach Auszeichnungen.
  function stagePodium(stage, s) {
    const cols = [2, 1, 3].map((place) => {
      const entries = s.podium.filter((r) => r.rank === place);
      return h(
        'li',
        { class: 'podium__col', dataset: { place: String(place) } },
        entries.length ? h('div', { class: 'podium__avatars' }, entries.slice(0, 3).map((e) => avatar(e.avatar, e.nickname))) : null,
        h('p', { class: 'podium__name', text: entries.map((e) => e.nickname).join(', ') || '–' }),
        h('p', { class: 'podium__score', text: entries.length ? `${num(entries[0].score)} Punkte` : 'frei' }),
        h('div', { class: 'podium__block num', 'aria-hidden': 'true', text: String(place) }),
      );
    });
    const byPlace = (place) => cols.find((c) => c.dataset.place === String(place));
    const podiumList = h('ol', { class: 'podium is-staged', 'aria-label': 'Podium' }, cols);
    const podiumView = h('div', { class: 'podium-wrap' }, h('h1', { class: 'stage-title', text: 'Endergebnis' }), podiumList);

    const awards = Array.isArray(s.awards) ? s.awards : [];
    const tiles = awards.map((a) => {
      const shown = a.winners.slice(0, 3).map((w) => w.nickname);
      const more = a.winners.length - shown.length;
      return h(
        'li',
        { class: 'award', dataset: { i: String(awardColor(a.key)) } },
        h('p', { class: 'award__title', text: awardTitle(a.key) }),
        h('p', { class: 'award__names', text: shown.join(', ') + (more > 0 ? ` und ${more} weitere` : '') }),
        h('p', { class: 'award__detail', text: awardDetail(a) }),
      );
    });
    const awardsView = h('div', { class: 'awards-wrap', hidden: true }, h('h1', { class: 'stage-title', text: 'Auszeichnungen' }), h('ul', { class: 'awards' }, tiles));

    const timers = [];
    let stopConfetti = () => {};
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const showAll = () => {
      timers.forEach(clearTimeout);
      cols.forEach((c) => c.classList.add('is-shown'));
    };
    stopTimer = () => {
      timers.forEach(clearTimeout);
      stopConfetti();
    };

    const csvBtn = h('button', { class: 'btn btn--big btn--quiet', type: 'button', text: 'Ergebnisse als CSV', onclick: () => exportCsv(s.report) });
    const closeBtn = h('button', { class: 'btn btn--big btn--primary', type: 'button', text: 'Spiel schließen', onclick: () => endGame(false) });
    const backBtn = h('button', { class: 'btn btn--big btn--quiet', type: 'button', text: 'Zurück zum Podium', hidden: true });
    const awardsBtn = h('button', { class: 'btn btn--big btn--primary', type: 'button', text: 'Auszeichnungen zeigen' });

    const showView = (which, initial = false) => {
      const toAwards = which === 'awards';
      if (!initial) showAll();
      podiumView.hidden = toAwards;
      awardsView.hidden = !toAwards;
      awardsBtn.hidden = toAwards || !tiles.length;
      backBtn.hidden = !toAwards;
      closeBtn.hidden = !toAwards && tiles.length > 0;
      if (toAwards) {
        tiles.forEach((t, i) => {
          t.classList.remove('is-shown');
          later(150 + i * 450, () => {
            t.classList.add('is-shown');
            FX.play('award');
          });
        });
        closeBtn.focus({ preventScroll: true });
      } else if (!initial) {
        (tiles.length ? awardsBtn : closeBtn).focus({ preventScroll: true });
      }
    };
    awardsBtn.addEventListener('click', () => showView('awards'));
    backBtn.addEventListener('click', () => showView('podium'));

    stage.append(podiumView, awardsView, actions(csvBtn, backBtn, awardsBtn, closeBtn));
    showView('podium', true);
    (tiles.length ? awardsBtn : closeBtn).dataset.primary = 'true';

    if (FX.reducedMotion()) {
      showAll();
      FX.play('fanfare');
    } else {
      later(500, () => {
        byPlace(3).classList.add('is-shown');
        FX.play('place');
      });
      later(1800, () => {
        byPlace(2).classList.add('is-shown');
        FX.play('place');
      });
      later(2900, () => FX.play('drumroll', 2));
      later(5000, () => {
        byPlace(1).classList.add('is-shown');
        FX.play('fanfare');
        stopConfetti = FX.confetti(stage);
      });
    }
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
    // Neuladen setzt das Spiel fort, Schließen beendet es: deshalb nachfragen
    if ((mode === 'editor' && dirty) || (mode === 'game' && engine)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Start: laufendes Spiel fortsetzen oder Bibliothek zeigen
  const savedGame = session.get(GAME_KEY);
  if (savedGame && savedGame.v === 1) {
    resumeGame(savedGame);
  } else if (new URLSearchParams(location.search).get('start') === 'demo') {
    // Direkt aus der Landingpage: erstes Quiz als Demo starten; Parameter entfernen, damit Neuladen nicht neu startet
    history.replaceState(null, '', location.pathname);
    const list = loadQuizzes();
    renderLibrary();
    if (list.length) startGame(list[0], { demo: true });
  } else {
    renderLibrary();
  }
})();
