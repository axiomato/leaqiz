// Integration: echter HTTP- und WebSocket-Server, Clients wie Leinwand und Handys
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUIZ, client, createGame, startServer } from './helpers.js';

test('Live-Spiel über den Server: Leinwand, drei Handys, eine Runde bis zum Podium', async () => {
  const srv = await startServer();
  try {
    const { status, body } = await createGame(srv.base);
    assert.equal(status, 201);

    const host = client(srv.wsUrl);
    await host.opened;
    host.send({ k: 'host', game: body.id, token: body.hostToken });
    assert.equal((await host.next('view')).d.state, 'lobby');

    const names = ['Mila', 'Jonas', 'Aylin'];
    const phones = [];
    for (const name of names) {
      const p = client(srv.wsUrl);
      await p.opened;
      p.send({ k: 'player', pin: body.pin });
      await p.next('welcome');
      const check = await p.request('player:check', { pin: body.pin });
      assert.equal(check.title, 'Testquiz');
      const joined = await p.request('player:join', { nickname: name });
      assert.ok(joined.ok, joined.error);
      phones.push(p);
    }
    const lobby = await host.next((m) => m.k === 'view' && m.d.players.length === 3);
    assert.deepEqual(lobby.d.players.map((p) => p.nickname), names);
    assert.ok(lobby.d.players.every((p) => Array.isArray(p.avatar) && p.avatar.length === 6), 'Avatare vom Server vergeben');

    for (let q = 0; q < QUIZ.questions.length; q += 1) {
      assert.deepEqual(await host.command('next'), { ok: true }); // Countdown
      for (const p of phones) await p.next((m) => m.k === 'state' && m.d.state === 'question' && m.d.qIndex === q);
      const correct = QUIZ.questions[q].correct[0];
      for (const [i, p] of phones.entries()) {
        const r = await p.request('player:answer', { choice: i === 2 ? (correct + 1) % 2 : correct });
        assert.ok(r.ok, r.error);
      }
      // Alle haben geantwortet: Frage schließt früh
      await host.next((m) => m.k === 'view' && m.d.state === 'reveal' && m.d.qIndex === q);
      assert.deepEqual(await host.command('next'), { ok: true }); // Zwischenstand
    }
    assert.deepEqual(await host.command('next'), { ok: true }); // Podium
    const podium = await host.next((m) => m.k === 'view' && m.d.state === 'podium');
    assert.equal(podium.d.podium.length, 3);
    assert.equal(podium.d.podium.find((r) => r.nickname === 'Aylin').rank, 3);

    assert.deepEqual(await host.command('end'), { ok: true });
    for (const p of phones) assert.match((await p.next('closed')).reason, /beendet/);
    for (const p of [host, ...phones]) p.close();
  } finally {
    await srv.stop();
  }
});

test('Zugang: falsches Token, falsche Herkunft, unbekannte PIN, zu viele falsche PINs', async () => {
  const srv = await startServer({ limits: { pinMissesPerMinute: 3 } });
  try {
    const { body } = await createGame(srv.base);

    const intruder = client(srv.wsUrl);
    await intruder.opened;
    intruder.send({ k: 'host', game: body.id, token: 'geraten' });
    await intruder.next('denied');

    const foreign = client(srv.wsUrl, { origin: 'https://fremde-seite.example' });
    await assert.rejects(foreign.opened, (err) => err.status === 403);

    for (let i = 0; i < 3; i += 1) {
      const p = client(srv.wsUrl);
      await p.opened;
      p.send({ k: 'player', pin: '000000' });
      await p.next('no-game');
    }
    const blocked = client(srv.wsUrl);
    await blocked.opened;
    blocked.send({ k: 'player', pin: body.pin });
    await blocked.next('busy');

    // Handy-Nachricht ohne Hallo: Verbindung wird geschlossen
    const rude = client(srv.wsUrl);
    await rude.opened;
    rude.send({ k: 'req', id: 1, ev: 'player:join', p: { nickname: 'x' } });
    await new Promise((r) => rude.ws.once('close', r));
  } finally {
    await srv.stop();
  }
});

test('Server-Neustart: Spiel läuft weiter, Leinwand und Handy melden sich zurück', async () => {
  const first = await startServer();
  const { body } = await createGame(first.base);
  const p = client(first.wsUrl);
  await p.opened;
  p.send({ k: 'player', pin: body.pin });
  await p.next('welcome');
  const { token } = await p.request('player:join', { nickname: 'Hannah' });
  await first.registry.flush();
  await first.stop();

  const second = await startServer({ store: first.store });
  try {
    const host = client(second.wsUrl);
    await host.opened;
    host.send({ k: 'host', game: body.id, token: body.hostToken });
    const view = await host.next('view');
    assert.equal(view.d.pin, body.pin);
    assert.equal(view.d.players[0].nickname, 'Hannah');
    assert.equal(view.d.players[0].connected, false);

    const back = client(second.wsUrl);
    await back.opened;
    back.send({ k: 'player', pin: body.pin });
    await back.next('welcome');
    assert.ok((await back.request('player:resume', { token })).ok);
    await host.next((m) => m.k === 'view' && m.d.players[0].connected);
    host.close();
    back.close();
  } finally {
    await second.stop();
  }
});

test('HTTP: Spiel anlegen nur mit Freigabe, Konfiguration und Robots-Header', async () => {
  const closed = await startServer({ config: { anonGames: false } });
  try {
    const { status, body } = await createGame(closed.base);
    assert.equal(status, 401);
    assert.match(body.error, /melde dich an/);

    const cfg = await fetch(`${closed.base}/js/config.js`).then((r) => r.text());
    assert.match(cfg, /window\.LEAQIZ_CONFIG\.server = \{ ws: '\/ws', api: '\/api\/' \}/);

    const page = await fetch(`${closed.base}/`);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    const html = await page.text();
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    assert.match(html, /connect-src 'self' ws:\/\/localhost:3999/);

    assert.equal((await fetch(`${closed.base}/__snap/host-lobby.html`)).status, 404);
    const health = await fetch(`${closed.base}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);
  } finally {
    await closed.stop();
  }
});

test('Suchmaschinen: erst mit LEAQIZ_INDEXIERBAR frei, Spielleitung bleibt gesperrt', async () => {
  const srv = await startServer({ config: { indexable: true } });
  try {
    const start = await fetch(`${srv.base}/lehrkraefte/`);
    assert.equal(start.headers.get('x-robots-tag'), 'index, follow');
    assert.match(await start.text(), /<meta name="robots" content="index, follow" \/>/);
    const host = await fetch(`${srv.base}/host/`);
    assert.equal(host.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(await host.text(), /content="noindex, nofollow"/);
  } finally {
    await srv.stop();
  }
});

test('Serverbetrieb: eigene Datenschutzerklärung, kein Verbindungstest mit Servern Dritter', async () => {
  const srv = await startServer();
  const open = await startServer({ config: { indexable: true } });
  try {
    for (const path of ['/datenschutz/', '/datenschutz/index.html']) {
      const res = await fetch(`${srv.base}${path}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
      const html = await res.text();
      assert.match(html, /Hetzner Online GmbH/, 'Fassung für den eigenen Server');
      assert.ok(!/GitHub Pages|PeerJS/.test(html), 'nicht die Fassung für GitHub Pages');
      assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    }
    const free = await fetch(`${open.base}/datenschutz/`);
    assert.equal(free.headers.get('x-robots-tag'), 'index, follow');
    assert.match(await free.text(), /<meta name="robots" content="index, follow" \/>/);

    const check = await fetch(`${srv.base}/check/`, { redirect: 'manual' });
    assert.equal(check.status, 302);
    assert.equal(check.headers.get('location'), '/');
  } finally {
    await srv.stop();
    await open.stop();
  }
});
