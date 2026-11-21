'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Server } = require('socket.io');
const { Game, GameError } = require('./game');
const { validateQuiz, validateNickname, isPin, ValidationError } = require('./validate');
const { joinUrlFor } = require('./network');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const ROUTES = { '/': 'index.html', '/host': 'host.html' };

function readConfig(overrides = {}) {
  const num = (name, fallback) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    hostPassword: process.env.HOST_PASSWORD || '',
    publicUrl: process.env.PUBLIC_URL || '', // feste Spieler-Adresse, z. B. https://quiz.example.de
    countdownMs: num('COUNTDOWN_MS', 4000),
    maxGames: num('MAX_GAMES', 100),
    maxPlayers: num('MAX_PLAYERS', 200),
    trustProxy: process.env.TRUST_PROXY === '1',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    hostGraceMs: 15 * 60_000, // Host darf 15 min weg sein, bevor das Spiel schließt
    lobbyDropMs: 2 * 60_000, // getrennte Spieler verschwinden nach 2 min aus der Lobby
    podiumKeepMs: 30 * 60_000, // beendete Spiele bleiben 30 min abrufbar
    idleMaxMs: 2 * 60 * 60_000, // inaktive Spiele werden nach 2 h gelöscht
    sweepMs: 30_000,
    publicDir: path.join(__dirname, '..', 'public'),
    ...overrides,
  };
}

function createApp(overrides = {}) {
  const config = readConfig(overrides);
  const publicDir = path.resolve(config.publicDir);
  const games = new Map(); // pin -> Game
  const timers = new Map(); // pin -> Timeout
  const joinFailures = new Map(); // ip -> { count, resetAt }

  // ---------- HTTP: statische Dateien mit Sicherheits-Headern ----------

  function securityHeaders(req) {
    const host = String(req.headers.host || '');
    const wsSources = /^[a-z0-9.\-:[\]]+$/i.test(host) ? ` ws://${host} wss://${host}` : '';
    return {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
        `connect-src 'self'${wsSources}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
  }

  function send(res, req, status, body, type = 'text/plain; charset=utf-8') {
    res.writeHead(status, { ...securityHeaders(req), 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function handleHttp(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, req, 405, 'Method Not Allowed');
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, req, 400, 'Bad Request');
    }
    if (pathname === '/healthz') return send(res, req, 200, '{"ok":true}', MIME['.json']);

    const rel = ROUTES[pathname] || pathname.replace(/^\/+/, '');
    const filePath = path.resolve(publicDir, rel);
    if (!filePath.startsWith(publicDir + path.sep)) return send(res, req, 404, 'Nicht gefunden');

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) return send(res, req, 404, 'Nicht gefunden');
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        ...securityHeaders(req),
        'Content-Type': type,
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(res);
    });
  }

  const server = http.createServer(handleHttp);

  // ---------- WebSockets ----------

  const io = new Server(server, {
    maxHttpBufferSize: 256 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    // Nur die eigene Seite (und ausdrücklich erlaubte Origins) darf sich verbinden.
    allowRequest(req, callback) {
      const origin = req.headers.origin;
      if (!origin) return callback(null, true); // Nicht-Browser-Clients, z. B. Tests
      let ok = false;
      try {
        const o = new URL(origin);
        const fwdHost = config.trustProxy ? String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() : '';
        const host = fwdHost || req.headers.host;
        ok = o.host === host || config.allowedOrigins.includes(o.origin);
      } catch {
        ok = false;
      }
      callback(ok ? null : 'origin not allowed', ok);
    },
  });

  function clientIp(socket) {
    if (config.trustProxy) {
      const fwd = String(socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (fwd) return fwd;
    }
    return socket.handshake.address;
  }

  function checkPassword(candidate) {
    if (!config.hostPassword) return true;
    if (typeof candidate !== 'string') return false;
    const a = crypto.createHash('sha256').update(candidate).digest();
    const b = crypto.createHash('sha256').update(config.hostPassword).digest();
    return crypto.timingSafeEqual(a, b);
  }

  // Adresse für Spieler (Lobby-Text und QR-Code), siehe src/network.js
  function joinUrl(socket) {
    const address = server.address();
    return joinUrlFor({
      publicUrl: config.publicUrl,
      hostHeader: socket.handshake.headers.host,
      port: address && typeof address === 'object' ? address.port : 3000,
    });
  }

  function newPin() {
    for (let i = 0; i < 1000; i += 1) {
      const pin = String(crypto.randomInt(100000, 1000000));
      if (!games.has(pin)) return pin;
    }
    throw new GameError('Gerade ist keine Spiel-PIN frei. Bitte später erneut versuchen.');
  }

  // Fehlversuche bei der PIN-Eingabe pro IP begrenzen (Schutz vor PIN-Raten).
  function joinBlocked(ip, now) {
    const entry = joinFailures.get(ip);
    return Boolean(entry && entry.resetAt > now && entry.count >= 20);
  }

  function noteJoinFailure(ip, now) {
    const entry = joinFailures.get(ip);
    if (!entry || entry.resetAt <= now) joinFailures.set(ip, { count: 1, resetAt: now + 60_000 });
    else entry.count += 1;
  }

  // ---------- Senden ----------

  function emitHost(game) {
    if (game.hostSocketId) io.to(game.hostSocketId).emit('host:state', game.hostView(Date.now()));
  }

  function emitPlayer(game, player) {
    if (player.socketId && player.connected) {
      io.to(player.socketId).emit('player:state', game.playerView(player.id, Date.now()));
    }
  }

  function broadcast(game) {
    emitHost(game);
    for (const p of game.players.values()) emitPlayer(game, p);
  }

  // ---------- Timer ----------

  function clearTimer(pin) {
    const t = timers.get(pin);
    if (t) clearTimeout(t);
    timers.delete(pin);
  }

  function schedule(game) {
    clearTimer(game.pin);
    const now = Date.now();
    const qIndex = game.qIndex;
    if (game.state === 'countdown') {
      timers.set(
        game.pin,
        setTimeout(() => {
          if (game.state !== 'countdown' || game.qIndex !== qIndex || !games.has(game.pin)) return;
          game.openQuestion(Date.now());
          schedule(game);
          broadcast(game);
        }, Math.max(0, game.countdownEndsAt - now)),
      );
    } else if (game.state === 'question') {
      timers.set(
        game.pin,
        setTimeout(() => {
          if (game.state !== 'question' || game.qIndex !== qIndex || !games.has(game.pin)) return;
          game.closeQuestion(Date.now());
          broadcast(game);
        }, Math.max(0, game.round.closesAt - now) + 200),
      );
    }
  }

  function closeQuestionEarly(game) {
    if (game.state !== 'question' || !games.has(game.pin)) return;
    clearTimer(game.pin);
    game.closeQuestion(Date.now());
    broadcast(game);
  }

  // ---------- Spiel schließen ----------

  function detachSocket(socketId) {
    const s = io.sockets.sockets.get(socketId);
    if (s) s.data = {};
  }

  function closeGame(game, reason) {
    clearTimer(game.pin);
    const payload = { reason };
    if (game.hostSocketId) {
      io.to(game.hostSocketId).emit('game:closed', payload);
      detachSocket(game.hostSocketId);
    }
    for (const p of game.players.values()) {
      if (p.socketId) {
        io.to(p.socketId).emit('game:closed', payload);
        detachSocket(p.socketId);
      }
    }
    games.delete(game.pin);
  }

  // ---------- Handler-Hilfen ----------

  function on(socket, event, handler) {
    socket.on(event, (payload, ack) => {
      if (typeof payload === 'function') {
        ack = payload;
        payload = {};
      }
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const result = handler(payload && typeof payload === 'object' ? payload : {});
        reply({ ok: true, ...(result || {}) });
      } catch (err) {
        if (err instanceof GameError || err instanceof ValidationError) {
          reply({ ok: false, error: err.message, code: err.code });
        } else {
          console.error(`[${event}]`, err && err.stack ? err.stack : err);
          reply({ ok: false, error: 'Interner Fehler. Bitte erneut versuchen.' });
        }
      }
    });
  }

  function hostGame(socket) {
    const { role, pin } = socket.data;
    const game = role === 'host' ? games.get(pin) : null;
    if (!game || game.hostSocketId !== socket.id) throw new GameError('Kein aktives Spiel. Bitte neu starten.');
    return game;
  }

  function playerContext(socket) {
    const { role, pin, playerId } = socket.data;
    const game = role === 'player' ? games.get(pin) : null;
    const player = game ? game.players.get(playerId) : null;
    if (!game || !player || player.socketId !== socket.id) throw new GameError('Du bist in keinem Spiel.');
    return { game, player };
  }

  function bindHost(socket, game) {
    if (game.hostSocketId && game.hostSocketId !== socket.id) {
      io.to(game.hostSocketId).emit('game:closed', { reason: 'Das Spiel wurde in einem anderen Fenster geöffnet.' });
      detachSocket(game.hostSocketId);
    }
    game.hostSocketId = socket.id;
    game.hostConnected = true;
    game.hostLeftAt = null;
    socket.data = { role: 'host', pin: game.pin };
  }

  function bindPlayer(socket, game, player) {
    if (player.socketId && player.socketId !== socket.id) {
      io.to(player.socketId).emit('game:closed', { reason: 'Du spielst jetzt in einem anderen Fenster weiter.' });
      detachSocket(player.socketId);
    }
    player.socketId = socket.id;
    game.setConnected(player, true, Date.now());
    socket.data = { role: 'player', pin: game.pin, playerId: player.id };
  }

  // ---------- Verbindungen ----------

  io.on('connection', (socket) => {
    socket.data = {};

    // Einfacher Token-Bucket gegen Event-Fluten: 20 Events Puffer, 10 pro Sekunde.
    let tokens = 20;
    let refilledAt = Date.now();
    socket.use((packet, next) => {
      const now = Date.now();
      tokens = Math.min(20, tokens + ((now - refilledAt) / 1000) * 10);
      refilledAt = now;
      if (tokens < 1) return next(new Error('rate limit'));
      tokens -= 1;
      return next();
    });
    socket.on('error', () => {}); // Rate-Limit-Fehler still verwerfen

    on(socket, 'host:create', ({ quiz, password }) => {
      if (socket.data.role) throw new GameError('Diese Verbindung ist schon einem Spiel zugeordnet. Bitte Seite neu laden.');
      if (!checkPassword(password)) {
        const err = new GameError('Das Host-Passwort stimmt nicht.');
        err.code = 'password';
        throw err;
      }
      if (games.size >= config.maxGames) throw new GameError('Der Server ist gerade ausgelastet. Bitte später erneut versuchen.');
      const valid = validateQuiz(quiz);
      const game = new Game({ pin: newPin(), quiz: valid, now: Date.now(), maxPlayers: config.maxPlayers });
      games.set(game.pin, game);
      bindHost(socket, game);
      setImmediate(() => emitHost(game));
      return { pin: game.pin, hostToken: game.hostToken, joinUrl: joinUrl(socket) };
    });

    on(socket, 'host:resume', ({ pin, hostToken }) => {
      const game = isPin(pin) ? games.get(pin) : null;
      if (!game || !game.checkHostToken(hostToken)) throw new GameError('Dieses Spiel gibt es nicht mehr.');
      bindHost(socket, game);
      setImmediate(() => broadcast(game)); // Spieler sehen: Host ist wieder da
      return { pin: game.pin, joinUrl: joinUrl(socket) };
    });

    on(socket, 'host:next', () => {
      const game = hostGame(socket);
      const changed = game.advance(Date.now(), config.countdownMs);
      if (changed) {
        schedule(game);
        broadcast(game);
      }
    });

    on(socket, 'host:kick', ({ playerId }) => {
      const game = hostGame(socket);
      const player = typeof playerId === 'string' ? game.players.get(playerId) : null;
      if (!player) throw new GameError('Spieler nicht gefunden.');
      game.removePlayer(player.id);
      if (player.socketId) {
        io.to(player.socketId).emit('game:closed', { reason: 'Du wurdest vom Host aus dem Spiel entfernt.' });
        detachSocket(player.socketId);
      }
      if (game.allAnswered()) closeQuestionEarly(game);
      else broadcast(game);
    });

    on(socket, 'host:end', () => {
      const game = hostGame(socket);
      closeGame(game, 'Der Host hat das Spiel beendet.');
    });

    // PIN vorab prüfen, damit Spieler den Fehler sehen, bevor sie einen Namen tippen.
    on(socket, 'player:check', ({ pin }) => {
      const now = Date.now();
      const ip = clientIp(socket);
      if (joinBlocked(ip, now)) throw new GameError('Zu viele Versuche. Bitte eine Minute warten.');
      const game = isPin(pin) ? games.get(pin) : null;
      if (!game) {
        noteJoinFailure(ip, now);
        throw new GameError('Zu dieser PIN läuft kein Spiel. Bitte prüfen.');
      }
      if (game.state === 'podium') throw new GameError('Dieses Spiel ist bereits beendet.');
      return { pin: game.pin, title: game.quiz.title };
    });

    on(socket, 'player:join', ({ pin, nickname }) => {
      if (socket.data.role) throw new GameError('Diese Verbindung ist schon einem Spiel zugeordnet. Bitte Seite neu laden.');
      const now = Date.now();
      const ip = clientIp(socket);
      if (joinBlocked(ip, now)) throw new GameError('Zu viele Versuche. Bitte eine Minute warten.');
      const game = isPin(pin) ? games.get(pin) : null;
      if (!game) {
        noteJoinFailure(ip, now);
        throw new GameError('Zu dieser PIN läuft kein Spiel. Bitte prüfen.');
      }
      const player = game.addPlayer(validateNickname(nickname), now);
      bindPlayer(socket, game, player);
      setImmediate(() => {
        emitHost(game);
        emitPlayer(game, player);
      });
      return { pin: game.pin, playerId: player.id, token: player.token };
    });

    on(socket, 'player:resume', ({ pin, token }) => {
      const game = isPin(pin) ? games.get(pin) : null;
      const player = game ? game.findPlayerByToken(token) : null;
      if (!player) throw new GameError('Dieses Spiel gibt es nicht mehr.');
      bindPlayer(socket, game, player);
      setImmediate(() => {
        emitHost(game);
        emitPlayer(game, player);
      });
      return { pin: game.pin, playerId: player.id };
    });

    on(socket, 'player:answer', ({ choice }) => {
      const { game, player } = playerContext(socket);
      const all = game.submitAnswer(player.id, choice, Date.now());
      if (all) setImmediate(() => closeQuestionEarly(game));
      else
        setImmediate(() => {
          emitPlayer(game, player);
          emitHost(game);
        });
    });

    on(socket, 'player:leave', () => {
      const { game, player } = playerContext(socket);
      game.removePlayer(player.id);
      socket.data = {};
      if (game.allAnswered()) setImmediate(() => closeQuestionEarly(game));
      else setImmediate(() => emitHost(game));
    });

    socket.on('disconnect', () => {
      const { role, pin, playerId } = socket.data || {};
      const game = pin ? games.get(pin) : null;
      if (!game) return;
      const now = Date.now();
      if (role === 'host' && game.hostSocketId === socket.id) {
        game.hostSocketId = null;
        game.hostConnected = false;
        game.hostLeftAt = now;
        for (const p of game.players.values()) emitPlayer(game, p);
      } else if (role === 'player') {
        const player = game.players.get(playerId);
        if (!player || player.socketId !== socket.id) return;
        game.setConnected(player, false, now);
        player.socketId = null;
        if (game.allAnswered()) closeQuestionEarly(game);
        else emitHost(game);
      }
    });
  });

  // ---------- Aufräumen ----------

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const game of games.values()) {
      if (!game.hostConnected && now - game.hostLeftAt > config.hostGraceMs) {
        closeGame(game, 'Der Host ist nicht zurückgekehrt. Das Spiel wurde beendet.');
        continue;
      }
      if (game.state === 'podium' && now - game.lastActivity > config.podiumKeepMs) {
        closeGame(game, 'Das Spiel ist beendet.');
        continue;
      }
      if (now - game.lastActivity > config.idleMaxMs) {
        closeGame(game, 'Das Spiel war zu lange inaktiv und wurde beendet.');
        continue;
      }
      if (game.state === 'lobby') {
        let changed = false;
        for (const p of game.players.values()) {
          if (!p.connected && now - p.disconnectedAt > config.lobbyDropMs) {
            game.removePlayer(p.id);
            changed = true;
          }
        }
        if (changed) emitHost(game);
      }
    }
    for (const [ip, entry] of joinFailures) if (entry.resetAt <= now) joinFailures.delete(ip);
  }, config.sweepMs);
  sweeper.unref();

  function close() {
    clearInterval(sweeper);
    for (const pin of timers.keys()) clearTimer(pin);
    io.close();
    server.close();
  }

  return { server, io, games, config, close };
}

module.exports = { createApp, readConfig };
