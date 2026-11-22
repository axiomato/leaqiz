import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRegistry, RegistryError } from '../src/games/registry.js';
import { MemoryGameStore } from '../src/games/store.js';
import { QUIZ, quietLog, sleep } from './helpers.js';

function registry(opts = {}) {
  return new GameRegistry({ store: new MemoryGameStore(), log: quietLog, engineOptions: { countdownMs: 30 }, persistMs: 10, viewMs: 5, hostGraceMs: 30, ...opts });
}

// Verbindung, die Nachrichten sammelt
const sink = () => {
  const box = [];
  return { box, send: (m) => box.push(m), close() {} };
};

test('Spiel anlegen: geprüftes Quiz, PIN, Token nur als Hash gespeichert', async () => {
  const reg = registry();
  const { id, pin, hostToken } = await reg.create(QUIZ);
  assert.match(pin, /^\d{6}$/);
  assert.ok(hostToken.length >= 30);
  const row = reg.store.rows.get(id);
  assert.equal(row.title, 'Testquiz');
  assert.notEqual(row.hostTokenHash, hostToken);
  assert.equal(row.snapshot.game.hostToken, undefined, 'das Token selbst steht nicht in der Datenbank');
  assert.ok(reg.verifyHost(reg.get(id), hostToken));
  assert.ok(!reg.verifyHost(reg.get(id), 'falsch'));
  assert.equal(reg.byPin(pin), reg.get(id));
  reg.dispose();
});

test('Spiel anlegen: ungültiges Quiz ergibt 400 mit Grund, volle Kapazität 503', async () => {
  const reg = registry({ maxGames: 1 });
  await assert.rejects(reg.create({ title: 'x', questions: [] }), (err) => err instanceof RegistryError && err.status === 400 && /mindestens eine Frage/.test(err.message));
  await reg.create(QUIZ);
  await assert.rejects(reg.create(QUIZ), (err) => err.status === 503);
  reg.dispose();
});

test('Ablauf: Spieler tritt bei, Leinwand steuert, Zustand wird gesichert', async () => {
  const reg = registry();
  const { id } = await reg.create(QUIZ);
  const entry = reg.get(id);
  const host = sink();
  const view = reg.attachHost(entry, host);
  assert.equal(view.state, 'lobby');

  const phone = sink();
  const connId = reg.attachPlayer(entry, phone);
  reg.playerMessage(entry, connId, { k: 'req', id: 1, ev: 'player:join', p: { nickname: 'Mila' } });
  const ack = phone.box.find((m) => m.k === 'ack');
  assert.ok(ack.r.ok, ack.r.error);

  assert.deepEqual(reg.hostCommand(entry, 'next'), { ok: true });
  await sleep(60); // Countdown (30 ms) → Frage
  assert.equal(entry.engine.game.state, 'question');
  const saved = reg.store.rows.get(id);
  assert.equal(saved.state, 'question', 'Phasenwechsel wird sofort gesichert');
  assert.ok(host.box.some((m) => m.k === 'view' && m.d.state === 'question'), 'Leinwand bekommt neue Ansicht');

  assert.equal(reg.hostCommand(entry, 'kick', { playerId: 42 }).ok, false);
  assert.equal(reg.hostCommand(entry, 'quatsch').ok, false);
  reg.dispose();
});

test('Neustart: Spiel wird aus dem Speicher wiederhergestellt, Spieler kehren mit Token zurück', async () => {
  const store = new MemoryGameStore();
  const first = registry({ store });
  const { id, pin, hostToken } = await first.create(QUIZ);
  const entry = first.get(id);
  const phone = sink();
  const c = first.attachPlayer(entry, phone);
  first.playerMessage(entry, c, { k: 'req', id: 1, ev: 'player:join', p: { nickname: 'Jonas' } });
  const { token } = phone.box.find((m) => m.k === 'ack').r;
  await first.flush();
  first.dispose();

  const second = registry({ store });
  assert.equal(await second.restoreAll(), 1);
  const again = second.byPin(pin);
  assert.ok(again && again.id === id);
  assert.ok(second.verifyHost(again, hostToken), 'Leinwand-Token gilt weiter');
  const phone2 = sink();
  const c2 = second.attachPlayer(again, phone2);
  second.playerMessage(again, c2, { k: 'req', id: 1, ev: 'player:resume', p: { token } });
  assert.ok(phone2.box.find((m) => m.k === 'ack').r.ok);
  second.dispose();
});

test('Beenden: Leinwand und Handys erfahren es, Spiel ist danach nicht mehr auffindbar', async () => {
  const reg = registry();
  const { id, pin } = await reg.create(QUIZ);
  const entry = reg.get(id);
  const host = sink();
  reg.attachHost(entry, host);
  const phone = sink();
  const c = reg.attachPlayer(entry, phone);
  reg.playerMessage(entry, c, { k: 'req', id: 1, ev: 'player:join', p: { nickname: 'Aylin' } });
  assert.deepEqual(reg.hostCommand(entry, 'end'), { ok: true });
  assert.ok(host.box.some((m) => m.k === 'closed'));
  assert.ok(phone.box.some((m) => m.k === 'closed'));
  assert.equal(reg.byPin(pin), null);
  await sleep(20);
  assert.ok(reg.store.rows.get(id).endedAt, 'Ende wird gespeichert');
  reg.dispose();
});

test('Aufräumen: Spiel ohne Leinwand nach Leerlauf beenden, nach Löschfrist löschen', async () => {
  let now = Date.now();
  const reg = registry({ idleMs: 1000, retentionDays: 1, now: () => now });
  const { id } = await reg.create(QUIZ);
  now += 2000;
  await reg.sweep();
  assert.equal(reg.get(id), null, 'beendet nach Leerlauf');
  await sleep(20);
  assert.ok(reg.store.rows.get(id).endedAt);
  reg.store.rows.get(id).endedAt = new Date(Date.now() - 2 * 86_400_000);
  assert.equal(await reg.sweep(), 1, 'nach der Löschfrist entfernt');
  assert.equal(reg.store.rows.has(id), false);
  reg.dispose();
});

test('Spielleitung getrennt: Handys sehen es nach kurzer Frist, nicht sofort', async () => {
  const reg = registry();
  const { id } = await reg.create(QUIZ);
  const entry = reg.get(id);
  const host = sink();
  reg.attachHost(entry, host);
  const phone = sink();
  const c = reg.attachPlayer(entry, phone);
  reg.playerMessage(entry, c, { k: 'req', id: 1, ev: 'player:join', p: { nickname: 'Ben' } });
  reg.detachHost(entry, host);
  assert.equal(entry.engine.game.hostConnected, true, 'Neuladen der Leinwand löst keinen Hinweis aus');
  await sleep(60);
  assert.equal(entry.engine.game.hostConnected, false);
  assert.equal(phone.box.filter((m) => m.k === 'state').at(-1).d.hostOnline, false);
  reg.attachHost(entry, sink());
  assert.equal(phone.box.filter((m) => m.k === 'state').at(-1).d.hostOnline, true);
  reg.dispose();
});
