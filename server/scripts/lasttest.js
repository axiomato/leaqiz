// Lasttest: startet den Server als eigenen Prozess und spielt viele Runden gleichzeitig
// mit simulierten Handys durch. Misst Antwortzeiten der Handys sowie Speicher und CPU des Servers.
//
//   DATABASE_URL=postgres://… npm run lasttest -- --spiele 20 --spieler 30
//
// Die Datenbank bekommt dabei echte Spiel-Einträge (danach beendet).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';

const { values } = parseArgs({
  options: {
    spiele: { type: 'string', default: '20' },
    spieler: { type: 'string', default: '30' },
    port: { type: 'string', default: '3901' },
  },
});
const GAMES = Number(values.spiele);
const PLAYERS = Number(values.spieler);
const PORT = Number(values.port);
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `http://127.0.0.1:${PORT}`;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL fehlt.');
  process.exit(1);
}

const QUIZ = {
  title: 'Lasttest',
  questions: Array.from({ length: 5 }, (_, i) => ({ type: 'quiz', text: `Frage ${i + 1}`, options: ['A', 'B', 'C', 'D'], correct: [i % 4], timeLimit: 10 })),
};

const server = spawn(process.execPath, ['src/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    LEAQIZ_ORIGIN: ORIGIN,
    LEAQIZ_SPIELE_OHNE_ANMELDUNG: 'ja',
    LEAQIZ_GRENZE_VERBINDUNGEN_MINUTE: '100000',
    LEAQIZ_GRENZE_SPIELE_STUNDE: '10000',
    LOG_LEVEL: 'warn',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Speicher (RSS) und CPU-Zeit des Server-Prozesses aus /proc (Linux)
function usage() {
  try {
    const status = readFileSync(`/proc/${server.pid}/status`, 'utf8');
    const rss = Number(status.match(/VmRSS:\s+(\d+)/)[1]) / 1024;
    const stat = readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const cpu = (Number(stat[11]) + Number(stat[12])) / 100; // utime + stime in Sekunden (Takt 100 Hz)
    return { rss, cpu };
  } catch {
    return { rss: NaN, cpu: NaN };
  }
}

function connect(hello) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { origin: ORIGIN });
    const handlers = new Set();
    ws.on('open', () => ws.send(JSON.stringify(hello)));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      for (const h of handlers) h(msg);
    });
    ws.on('error', reject);
    const first = (msg) => {
      handlers.delete(first);
      resolve({ ws, handlers, first: msg });
    };
    handlers.add(first);
  });
}

const latencies = [];

async function runGame() {
  const res = await fetch(`${BASE}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ quiz: QUIZ }) });
  const game = await res.json();
  if (!res.ok) throw new Error(game.error);
  const host = await connect({ k: 'host', game: game.id, token: game.hostToken });
  let view = host.first.d;
  host.handlers.add((m) => {
    if (m.k === 'view') view = m.d;
  });
  let cmdSeq = 0;
  const command = (ev) =>
    new Promise((resolve) => {
      const id = (cmdSeq += 1);
      const h = (m) => {
        if (m.k === 'ack' && m.id === id) {
          host.handlers.delete(h);
          resolve(m.r);
        }
      };
      host.handlers.add(h);
      host.ws.send(JSON.stringify({ k: 'cmd', id, ev }));
    });

  const phones = [];
  for (let i = 0; i < PLAYERS; i += 1) {
    const p = await connect({ k: 'player', pin: game.pin });
    let seq = 0;
    const pending = new Map();
    p.handlers.add((m) => {
      if (m.k === 'ack' && pending.has(m.id)) {
        const { t, resolve } = pending.get(m.id);
        pending.delete(m.id);
        latencies.push(performance.now() - t);
        resolve(m.r);
      } else if (m.k === 'state' && m.d.state === 'question' && !m.d.answered && p.answeredFor !== m.d.qIndex) {
        p.answeredFor = m.d.qIndex;
        // Antwort nach 0,5–4 s, wie echte Klassen
        setTimeout(() => p.request('player:answer', { choice: Math.floor(Math.random() * 4) }), 500 + Math.random() * 3500);
      }
    });
    p.request = (ev, payload) =>
      new Promise((resolve) => {
        const id = (seq += 1);
        pending.set(id, { t: performance.now(), resolve });
        p.ws.send(JSON.stringify({ k: 'req', id, ev, p: payload }));
      });
    await p.request('player:join', { nickname: `Spieler ${i + 1}` });
    phones.push(p);
  }

  for (let q = 0; q < QUIZ.questions.length; q += 1) {
    await command('next'); // Countdown → Frage
    while (!(view.state === 'reveal' && view.qIndex === q)) await sleep(100);
    await command('next'); // Zwischenstand
  }
  await command('next'); // Podium
  await command('end');
  for (const p of phones) p.ws.close();
  host.ws.close();
}

try {
  for (let i = 0; i < 50; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* startet noch */
    }
    await sleep(200);
  }
  const before = usage();
  const started = performance.now();
  let peak = before.rss;
  const meter = setInterval(() => {
    peak = Math.max(peak, usage().rss);
  }, 250);
  const results = await Promise.allSettled(Array.from({ length: GAMES }, () => runGame()));
  clearInterval(meter);
  const after = usage();
  const failed = results.filter((r) => r.status === 'rejected');
  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))].toFixed(1);
  const seconds = (performance.now() - started) / 1000;
  console.log(`Spiele: ${GAMES} gleichzeitig × ${PLAYERS} Handys = ${GAMES * PLAYERS} Verbindungen, ${QUIZ.questions.length} Fragen`);
  console.log(`Fehlgeschlagen: ${failed.length}${failed.length ? ` (${failed[0].reason.message})` : ''}`);
  console.log(`Antwortzeit der Handys (Beitreten, Antworten): Median ${pct(50)} ms, 95 % ${pct(95)} ms, max ${pct(100)} ms (${latencies.length} Anfragen)`);
  console.log(`Server: Speicher ${before.rss.toFixed(0)} MB → Spitze ${peak.toFixed(0)} MB; CPU ${(after.cpu - before.cpu).toFixed(1)} s in ${seconds.toFixed(0)} s (${((100 * (after.cpu - before.cpu)) / seconds).toFixed(0)} % eines Kerns)`);
} finally {
  server.kill('SIGTERM');
}
