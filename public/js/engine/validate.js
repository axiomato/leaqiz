// Eingabeprüfung. Läuft im Browser (window.LeaqizValidate) und in Node (require):
// eine Quelle für Host-Engine und Tests.
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeaqizValidate = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

// Eingaben von Spielern sind nie vertrauenswürdig: alles hier normalisieren und begrenzen.

const LIMITS = Object.freeze({
  titleMax: 120,
  questionsMax: 100,
  questionTextMax: 300,
  optionTextMax: 90,
  optionsMin: 2,
  optionsMax: 4,
  nicknameMax: 20,
});

const TIME_LIMITS = Object.freeze([5, 10, 20, 30, 45, 60, 90, 120, 240]);
const TYPES = Object.freeze(['quiz', 'truefalse']);
const TRUE_FALSE_OPTIONS = Object.freeze(['Wahr', 'Falsch']);

class ValidationError extends Error {}

// Steuerzeichen, unsichtbare Zeichen und Bidi-Overrides (Schutz vor Täuschung in Namen).
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202E\\u2066-\\u2069]', 'g');


// Steuerzeichen entfernen, Leerraum zusammenfassen, trimmen.
function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fail(message) {
  throw new ValidationError(message);
}

function validateQuestion(raw, index) {
  const label = `Frage ${index + 1}`;
  if (!raw || typeof raw !== 'object') fail(`${label}: ungültiges Format.`);

  const type = TYPES.includes(raw.type) ? raw.type : 'quiz';
  const text = cleanText(raw.text);
  if (!text) fail(`${label}: Fragetext fehlt.`);
  if (text.length > LIMITS.questionTextMax) fail(`${label}: Fragetext ist länger als ${LIMITS.questionTextMax} Zeichen.`);

  let options;
  if (type === 'truefalse') {
    options = [...TRUE_FALSE_OPTIONS];
  } else {
    if (!Array.isArray(raw.options)) fail(`${label}: Antworten fehlen.`);
    options = raw.options.map(cleanText);
    // Leere Felder ablehnen statt still entfernen: sonst verschieben sich die
    // Indizes der richtigen Antworten. Der Editor sendet nur gefüllte Felder.
    if (options.some((o) => !o)) fail(`${label}: eine Antwort ist leer.`);
    if (options.length < LIMITS.optionsMin) fail(`${label}: mindestens ${LIMITS.optionsMin} Antworten nötig.`);
    if (options.length > LIMITS.optionsMax) fail(`${label}: höchstens ${LIMITS.optionsMax} Antworten erlaubt.`);
    if (options.some((o) => o.length > LIMITS.optionTextMax)) fail(`${label}: eine Antwort ist länger als ${LIMITS.optionTextMax} Zeichen.`);
  }

  const correctRaw = Array.isArray(raw.correct) ? raw.correct : [raw.correct];
  const correct = [...new Set(correctRaw.filter((i) => Number.isInteger(i) && i >= 0 && i < options.length))].sort((a, b) => a - b);
  if (correct.length === 0) fail(`${label}: mindestens eine richtige Antwort markieren.`);
  if (type === 'truefalse' && correct.length !== 1) fail(`${label}: bei Wahr/Falsch genau eine richtige Antwort markieren.`);

  const timeLimit = TIME_LIMITS.includes(raw.timeLimit) ? raw.timeLimit : 20;

  return { type, text, options, correct, timeLimit };
}

function validateQuiz(raw) {
  if (!raw || typeof raw !== 'object') fail('Quiz fehlt oder hat ein ungültiges Format.');
  const title = cleanText(raw.title) || 'Ohne Titel';
  if (title.length > LIMITS.titleMax) fail(`Titel ist länger als ${LIMITS.titleMax} Zeichen.`);
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) fail('Das Quiz braucht mindestens eine Frage.');
  if (raw.questions.length > LIMITS.questionsMax) fail(`Höchstens ${LIMITS.questionsMax} Fragen pro Quiz.`);
  return { title, questions: raw.questions.map(validateQuestion) };
}

function validateNickname(raw) {
  const nickname = cleanText(raw);
  if (!nickname) fail('Bitte einen Spielnamen eingeben.');
  if (nickname.length > LIMITS.nicknameMax) fail(`Der Spielname darf höchstens ${LIMITS.nicknameMax} Zeichen haben.`);
  return nickname;
}

function isPin(value) {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

return {
  LIMITS,
  TIME_LIMITS,
  TYPES,
  ValidationError,
  cleanText,
  validateQuiz,
  validateNickname,
  isPin,
};
});
