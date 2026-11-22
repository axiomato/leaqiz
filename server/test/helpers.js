// Gemeinsame Hilfen für die Server-Tests
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import { attachGateway } from '../src/games/gateway.js';
import { GameRegistry } from '../src/games/registry.js';
import { MemoryGameStore } from '../src/games/store.js';

export const QUIZ = {
  title: 'Testquiz',
  questions: [
    { type: 'quiz', text: 'Wie viel ist 2 + 2?', options: ['3', '4', '5'], correct: [1], timeLimit: 5 },
    { type: 'truefalse', text: 'Die Erde ist rund.', correct: [0], timeLimit: 5 },
  ],
};

export const quietLog = { info() {}, warn() {}, error() {} };

export const ORIGIN = 'http://localhost:3999';

export function testConfig(overrides = {}) {
  return {
    port: 0,
    host: '127.0.0.1',
    databaseUrl: '',
    origin: ORIGIN,
    local: true,
    anonGames: true,
    indexable: false,
    trustProxy: false,
    publicDir: new URL('../../public', import.meta.url).pathname,
    gameIdleMs: 3600_000,
    retentionDays: 30,
    ...overrides,
  };
}

// Kompletter Server (HTTP + WebSocket) auf einem freien Port, ohne Datenbank
export async function startServer({ config: overrides = {}, store = new MemoryGameStore(), limits = {}, engineOptions = { countdownMs: 50 } } = {}) {
  const config = testConfig(overrides);
  const registry = new GameRegistry({ store, log: quietLog, engineOptions, persistMs: 20, viewMs: 10 });
  await registry.restoreAll();
  const app = await buildApp({ config, registry, limits });
  const gateway = attachGateway({ server: app.server, registry, config, log: quietLog, limits });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    app,
    registry,
    store,
    base,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    async stop() {
      gateway.close();
      registry.dispose();
      await app.close();
    },
  };
}

export async function createGame(base, quiz = QUIZ) {
  const res = await fetch(`${base}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ quiz }),
  });
  return { status: res.status, body: await res.json() };
}

// WebSocket-Client mit Nachrichtenpuffer: next(k) wartet auf die nächste Nachricht der Art k
export function client(url, { origin = ORIGIN } = {}) {
  const ws = new WebSocket(url, { origin });
  const inbox = [];
  const waiters = [];
  let closed = false;
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) {
      const [w] = waiters.splice(i, 1);
      clearTimeout(w.timer);
      w.resolve(msg);
    } else inbox.push(msg);
  });
  ws.on('close', () => {
    closed = true;
  });
  let seq = 0;
  const api = {
    ws,
    get closed() {
      return closed;
    },
    opened: new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
      ws.once('unexpected-response', (req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    }),
    send(msg) {
      ws.send(JSON.stringify(msg));
    },
    next(match, ms = 3000) {
      const fn = typeof match === 'function' ? match : (m) => m.k === match;
      const i = inbox.findIndex(fn);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Keine Nachricht (${typeof match === 'string' ? match : 'Bedingung'}) in ${ms} ms`)), ms);
        waiters.push({ match: fn, resolve, timer });
      });
    },
    async request(ev, p) {
      seq += 1;
      const id = seq;
      api.send({ k: 'req', id, ev, p });
      return (await api.next((m) => m.k === 'ack' && m.id === id)).r;
    },
    async command(ev, p) {
      seq += 1;
      const id = seq;
      api.send({ k: 'cmd', id, ev, p });
      return (await api.next((m) => m.k === 'ack' && m.id === id)).r;
    },
    close() {
      ws.close();
    },
  };
  return api;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
