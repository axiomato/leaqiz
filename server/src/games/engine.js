// Die Spiellogik ist dieselbe wie im Browser (public/js/engine): eine Quelle für beide Seiten.
// Die Dateien sind UMD (require in Node), deshalb hier über createRequire geladen.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Engine = require('../../../public/js/engine/host-engine.js');
const Validate = require('../../../public/js/engine/validate.js');

export const { HostEngine, randomPin, GameError } = Engine;
export const { validateQuiz, isPin, ValidationError } = Validate;
