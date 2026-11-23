// Protokoll ohne IP-Adressen: Anfragen erscheinen nur mit Methode, Pfad und Status
import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { GameRegistry } from '../src/games/registry.js';
import { MemoryGameStore } from '../src/games/store.js';
import { quietLog, testConfig } from './helpers.js';

test('Server-Protokoll enthält keine IP-Adressen und keine Abfrageteile', async () => {
  const lines = [];
  const stream = new Writable({
    write(chunk, enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const registry = new GameRegistry({ store: new MemoryGameStore(), log: quietLog });
  const app = await buildApp({ config: testConfig(), registry, log: { level: 'info', stream } });
  await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const base = `http://127.0.0.1:${app.server.address().port}`;
    await fetch(`${base}/host/?pin=123456&geheim=ja`);
    await fetch(`${base}/api/health`);
    // Nur Zeilen zu Anfragen (die Startzeile nennt die eigene Adresse des Servers)
    const log = lines.filter((l) => l.includes('"reqId"')).join('');
    assert.ok(log.length > 0);
    assert.match(log, /"url":"\/host\/"/, 'Pfad steht im Protokoll');
    assert.match(log, /"statusCode":200/);
    assert.ok(!log.includes('127.0.0.1'), 'keine IP-Adresse');
    assert.ok(!log.includes('remoteAddress') && !log.includes('remotePort'));
    assert.ok(!log.includes('geheim') && !log.includes('123456'), 'kein Abfrageteil');
  } finally {
    registry.dispose();
    await app.close();
  }
});
