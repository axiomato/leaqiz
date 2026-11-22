// WebSocket-Zugang unter /ws für Leinwand und Handys.
//
// Erste Nachricht entscheidet die Rolle:
//   Handy:    { k: 'player', pin }              -> { k: 'welcome' }, { k: 'no-game' } oder { k: 'busy' }
//   Leinwand: { k: 'host', game, token }        -> { k: 'view', d } oder { k: 'denied' }
// Danach:
//   Handy    -> { k: 'req', id, ev, p }  (wie bisher über die Direktverbindung, siehe host-engine.js)
//   Leinwand -> { k: 'cmd', id, ev, p }  ev: next | kick | end   <- { k: 'ack', id, r }
//   Server   -> Handy: ack | state | closed;  Leinwand: view | closed
import { WebSocketServer } from 'ws';
import { RateLimiter, clientIp } from '../limits.js';

const HELLO_TIMEOUT_MS = 10_000;
const PING_MS = 25_000;
const MAX_BUFFERED = 1024 * 1024; // langsame Gegenstelle: Verbindung lieber trennen als Speicher füllen

export function attachGateway({ server, registry, config, log = console, limits = {} }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  const connects = new RateLimiter({ limit: limits.connectsPerMinute ?? 300, windowMs: 60_000 });
  const misses = new RateLimiter({ limit: limits.pinMissesPerMinute ?? 30, windowMs: 60_000 });

  function reject(socket, status, text) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  function onUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return reject(socket, 404, 'Not Found');
    // Nur Seiten der eigenen Adresse dürfen sich verbinden (Browser senden Origin immer mit)
    if (req.headers.origin !== config.origin) return reject(socket, 403, 'Forbidden');
    const ip = clientIp(req, config.trustProxy);
    if (!connects.take(ip)) return reject(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
  }
  server.on('upgrade', onUpgrade);

  function onConnection(ws, ip) {
    let role = null; // 'player' | 'host'
    let entry = null;
    let connId = null;
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const conn = {
      send(msg) {
        if (ws.readyState !== ws.OPEN) return;
        if (ws.bufferedAmount > MAX_BUFFERED) {
          ws.terminate();
          return;
        }
        ws.send(JSON.stringify(msg));
      },
      close() {
        if (ws.readyState === ws.OPEN) ws.close(1000);
      },
    };

    const helloTimer = setTimeout(() => ws.close(4000, 'hello'), HELLO_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003);
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return ws.close(1007);
      }
      if (!msg || typeof msg !== 'object') return;

      if (!role) {
        clearTimeout(helloTimer);
        if (msg.k === 'player') {
          // Grenze für falsche PINs je IP: Schutz gegen Durchprobieren
          if (misses.blocked(ip)) {
            conn.send({ k: 'busy' });
            return ws.close(1000);
          }
          entry = registry.byPin(msg.pin);
          if (!entry) {
            misses.take(ip);
            conn.send({ k: 'no-game' });
            return ws.close(1000);
          }
          role = 'player';
          connId = registry.attachPlayer(entry, conn);
          conn.send({ k: 'welcome' });
        } else if (msg.k === 'host') {
          const candidate = typeof msg.game === 'string' ? registry.get(msg.game) : null;
          if (!registry.verifyHost(candidate, msg.token)) {
            conn.send({ k: 'denied' });
            return ws.close(1000);
          }
          role = 'host';
          entry = candidate;
          conn.send({ k: 'view', d: registry.attachHost(entry, conn) });
        } else {
          ws.close(4000, 'hello');
        }
        return;
      }

      if (role === 'player') {
        registry.playerMessage(entry, connId, msg);
      } else if (role === 'host' && msg.k === 'cmd' && typeof msg.ev === 'string') {
        const r = registry.hostCommand(entry, msg.ev, msg.p && typeof msg.p === 'object' ? msg.p : {});
        if (Number.isInteger(msg.id)) conn.send({ k: 'ack', id: msg.id, r });
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (role === 'player') registry.detachPlayer(entry, connId);
      else if (role === 'host') registry.detachHost(entry, conn);
    });
    ws.on('error', (err) => log.warn?.(`WebSocket: ${err.message}`));
  }

  // Tote Verbindungen erkennen (Handy im Funkloch, Laptop zugeklappt)
  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, PING_MS);
  pinger.unref?.();

  return {
    wss,
    close() {
      clearInterval(pinger);
      connects.stop();
      misses.stop();
      server.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
