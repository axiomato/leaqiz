'use strict';

// Direktverbindung über WebRTC (PeerJS). Der Browser der Spielleitung meldet sich
// unter "leaqiz-<PIN>" beim Vermittlungsserver an; Spieler verbinden sich dorthin.
// Danach laufen alle Spieldaten direkt (oder über TURN) zwischen den Browsern.

window.LQNet = (function () {
  const PREFIX = 'leaqiz-';
  // STUN/TURN-Server kommen aus ice.js (Konfiguration in config.js)
  const peerOptions = () => window.LQIce.peerOptions();

  // ---------- Spielleitung ----------

  class HostLink {
    constructor({ pin, onConnection, onData, onClose, onStatus }) {
      this.pin = pin;
      this.handlers = { onConnection, onData, onClose, onStatus: onStatus || (() => {}) };
      this.conns = new Map();
      this.peer = null;
      this.destroyed = false;
    }

    // Meldet die PIN beim Vermittlungsserver an. Fehler-Code 'taken': PIN schon vergeben.
    async open() {
      const options = await peerOptions();
      return new Promise((resolve, reject) => {
        const peer = new window.Peer(PREFIX + this.pin, options);
        this.peer = peer;
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          peer.destroy();
          reject(Object.assign(new Error('Zeitüberschreitung'), { code: 'network' }));
        }, 15000);
        peer.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.handlers.onStatus('online');
          resolve();
        });
        peer.on('error', (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            peer.destroy();
            reject(Object.assign(new Error(err.message), { code: err.type === 'unavailable-id' ? 'taken' : 'network' }));
            return;
          }
          if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') this.handlers.onStatus('offline');
        });
        // Verbindung zum Vermittlungsserver verloren: neu anmelden (bestehende Spieler bleiben verbunden)
        peer.on('disconnected', () => {
          if (this.destroyed) return;
          this.handlers.onStatus('offline');
          setTimeout(() => {
            if (!this.destroyed && peer.disconnected && !peer.destroyed) peer.reconnect();
          }, 2000);
        });
        peer.on('connection', (conn) => this.accept(conn));
      });
    }

    accept(conn) {
      const id = conn.connectionId;
      conn.on('open', () => {
        this.conns.set(id, conn);
        this.handlers.onConnection(id);
      });
      conn.on('data', (data) => this.handlers.onData(id, data));
      const closed = () => {
        if (!this.conns.has(id)) return;
        this.conns.delete(id);
        this.handlers.onClose(id);
      };
      conn.on('close', closed);
      conn.on('error', closed);
    }

    send(connId, msg) {
      const conn = this.conns.get(connId);
      if (conn && conn.open) {
        try {
          conn.send(msg);
        } catch {
          /* Verbindung bricht gerade ab */
        }
      }
    }

    destroy() {
      this.destroyed = true;
      if (this.peer) this.peer.destroy();
      this.conns.clear();
    }
  }

  // ---------- Spieler ----------

  // Verhält sich wie ein Socket: on(event), emit(event, payload, ack).
  // Ereignisse: 'connect', 'disconnect', 'player:state', 'game:closed'.
  class PlayerLink {
    constructor() {
      this.handlers = new Map();
      this.pending = new Map();
      this.seq = 0;
      this.peer = null;
      this.conn = null;
      this.pin = null;
      this.stopped = false;
      this.retryTimer = 0;
      this.lostSince = null;
    }

    on(event, fn) {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event).push(fn);
    }

    fire(event, data) {
      for (const fn of this.handlers.get(event) || []) fn(data);
    }

    get connected() {
      return Boolean(this.conn && this.conn.open);
    }

    async ensurePeer() {
      if (this.peer && !this.peer.destroyed) return this.peer;
      const options = await peerOptions();
      return new Promise((resolve, reject) => {
        const peer = new window.Peer(options);
        // Der kostenlose Vermittlungsserver ist manchmal langsam: großzügig warten
        const timer = setTimeout(() => {
          peer.destroy();
          reject(Object.assign(new Error('timeout'), { code: 'signal' }));
        }, 30000);
        peer.on('open', () => {
          clearTimeout(timer);
          this.peer = peer;
          resolve(peer);
        });
        peer.on('error', (err) => {
          if (err.type === 'peer-unavailable') {
            if (this.onUnavailable) this.onUnavailable();
            return;
          }
          if (!this.peer) {
            clearTimeout(timer);
            reject(Object.assign(new Error(err.message), { code: 'signal' }));
          }
        });
        peer.on('disconnected', () => {
          setTimeout(() => {
            if (!peer.destroyed && peer.disconnected) peer.reconnect();
          }, 2000);
        });
      });
    }

    // Verbindet mit dem Spiel zur PIN. Fehler-Code 'no-game' oder 'network'.
    async connect(pin) {
      this.stopped = false;
      clearTimeout(this.retryTimer);
      if (this.conn && this.pin === pin && this.conn.open) return;
      this.closeConn();
      this.pin = pin;
      const peer = await this.ensurePeer();
      await new Promise((resolve, reject) => {
        let settled = false;
        const done = (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.onUnavailable = null;
          if (err) reject(err);
          else resolve();
        };
        // Kein Aufbau in 25 s: meist sperrt das Netz Direktverbindungen und das Relais ist nicht erreichbar
        const timer = setTimeout(() => {
          const pc = this.conn && this.conn.peerConnection;
          done(Object.assign(new Error('timeout'), { code: 'ice', detail: pc ? pc.iceConnectionState : 'kein Angebot' }));
        }, 25000);
        this.onUnavailable = () => done(Object.assign(new Error('Kein Spiel'), { code: 'no-game' }));
        const conn = peer.connect(PREFIX + pin, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => {
          this.lostSince = null;
          done();
          this.fire('connect');
        });
        conn.on('data', (msg) => this.receive(msg));
        const lost = () => {
          if (this.conn !== conn) return;
          if (!settled) done(Object.assign(new Error('Verbindung fehlgeschlagen'), { code: 'ice', detail: 'abgebrochen' }));
          this.conn = null;
          this.failPending();
          this.fire('disconnect');
          this.scheduleRetry();
        };
        conn.on('close', lost);
        conn.on('error', lost);
      });
    }

    // Nach Verbindungsabbruch bis zu 3 Minuten lang alle 3 Sekunden neu verbinden
    scheduleRetry() {
      if (this.stopped || !this.pin) return;
      if (this.lostSince === null) this.lostSince = Date.now();
      if (Date.now() - this.lostSince > 3 * 60_000) {
        this.fire('gave-up');
        return;
      }
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.connect(this.pin).catch((err) => {
          if (err.code === 'no-game') {
            this.stopped = true;
            this.fire('game:closed', { reason: 'Das Spiel ist nicht mehr erreichbar.' });
          } else this.scheduleRetry();
        });
      }, 3000);
    }

    receive(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.k === 'ack') {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.cb(msg.r || { ok: false, error: 'Unbekannter Fehler.' });
        }
      } else if (msg.k === 'state') this.fire('player:state', msg.d);
      else if (msg.k === 'closed') {
        this.stop();
        this.fire('game:closed', { reason: msg.reason });
      }
    }

    emit(ev, payload, cb) {
      const reply = typeof cb === 'function' ? cb : () => {};
      if (!this.connected) return reply({ ok: false, error: 'Keine Verbindung zum Spiel.' });
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reply({ ok: false, error: 'Keine Antwort vom Spiel. Bitte Verbindung prüfen.' });
      }, 8000);
      this.pending.set(id, { cb: reply, timer });
      try {
        this.conn.send({ k: 'req', id, ev, p: payload || {} });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reply({ ok: false, error: 'Senden fehlgeschlagen.' });
      }
    }

    failPending() {
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.cb({ ok: false, error: 'Verbindung unterbrochen.' });
        this.pending.delete(id);
      }
    }

    closeConn() {
      if (this.conn) {
        const c = this.conn;
        this.conn = null;
        try {
          c.close();
        } catch {
          /* egal */
        }
      }
    }

    // Kein automatisches Neuverbinden mehr (Spiel beendet oder Spieler gegangen)
    stop() {
      this.stopped = true;
      clearTimeout(this.retryTimer);
      this.closeConn();
    }
  }

  // ---------- Demo: Verbindung innerhalb eines Browsers (ohne Netz) ----------
  // Spielleitung und Spielerfenster sprechen über einen BroadcastChannel.
  // Nachrichten: hello/welcome (Aufbau), data (Spieldaten), bye/host-gone (Ende).

  const LOCAL = 'leaqiz-demo-';

  class LocalHostLink {
    constructor({ pin, onConnection, onData, onClose, onStatus }) {
      this.pin = pin;
      this.handlers = { onConnection, onData, onClose, onStatus: onStatus || (() => {}) };
      this.conns = new Set();
      this.channel = null;
    }

    async open() {
      this.channel = new BroadcastChannel(LOCAL + this.pin);
      this.channel.onmessage = (e) => {
        const m = e.data || {};
        if (m.t === 'hello' && typeof m.c === 'string') {
          this.conns.add(m.c);
          this.handlers.onConnection(m.c);
          this.channel.postMessage({ t: 'welcome', c: m.c });
        } else if (m.t === 'data' && m.to === 'host' && this.conns.has(m.c)) {
          this.handlers.onData(m.c, m.d);
        } else if (m.t === 'bye' && this.conns.has(m.c)) {
          this.conns.delete(m.c);
          this.handlers.onClose(m.c);
        }
      };
      this.handlers.onStatus('online');
    }

    send(connId, msg) {
      if (this.channel && this.conns.has(connId)) this.channel.postMessage({ t: 'data', c: connId, to: 'player', d: msg });
    }

    destroy() {
      if (this.channel) {
        this.channel.postMessage({ t: 'host-gone' });
        this.channel.close();
        this.channel = null;
      }
      this.conns.clear();
    }
  }

  // Verhält sich wie eine PeerJS-Datenverbindung (open, send, close, on)
  class LocalConn {
    constructor(pin, link) {
      this.connectionId = `local-${Math.random().toString(36).slice(2, 10)}`;
      this.open = false;
      this.closed = false;
      this.handlers = {};
      this.channel = new BroadcastChannel(LOCAL + pin);
      this.channel.onmessage = (e) => {
        const m = e.data || {};
        if (m.t === 'host-gone') return this.shut();
        if (m.c !== this.connectionId) return;
        if (m.t === 'welcome' && !this.open) {
          this.open = true;
          clearTimeout(this.timer);
          this.fire('open');
        } else if (m.t === 'data' && m.to === 'player') this.fire('data', m.d);
      };
      // Keine Spielleitung in diesem Browser: wie „Spiel nicht gefunden“ behandeln
      this.timer = setTimeout(() => {
        if (!this.open && link.onUnavailable) link.onUnavailable();
      }, 1500);
      this.onHide = () => this.close();
      window.addEventListener('pagehide', this.onHide);
      this.channel.postMessage({ t: 'hello', c: this.connectionId });
    }

    on(ev, fn) {
      (this.handlers[ev] = this.handlers[ev] || []).push(fn);
    }

    fire(ev, data) {
      for (const fn of this.handlers[ev] || []) fn(data);
    }

    send(d) {
      if (!this.open) throw new Error('nicht verbunden');
      this.channel.postMessage({ t: 'data', c: this.connectionId, to: 'host', d });
    }

    close() {
      if (this.closed) return;
      try {
        this.channel.postMessage({ t: 'bye', c: this.connectionId });
      } catch {
        /* Kanal schon zu */
      }
      this.shut();
    }

    shut() {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      clearTimeout(this.timer);
      window.removeEventListener('pagehide', this.onHide);
      this.channel.close();
      this.fire('close');
    }
  }

  class LocalPlayerLink extends PlayerLink {
    async ensurePeer() {
      return { destroyed: false, connect: (id) => new LocalConn(id.slice(PREFIX.length), this) };
    }
  }

  // ---------- Spielserver (WebSocket) ----------
  // Läuft leaqizz auf dem eigenen Server, ergänzt dieser window.LEAQIZ_CONFIG.server.
  // Dann führt der Server die Spiele; Leinwand und Handys verbinden sich per WebSocket dorthin.
  // Ohne diesen Eintrag (GitHub Pages) bleibt alles bei der Direktverbindung.

  const serverConfig = () => (window.LEAQIZ_CONFIG && window.LEAQIZ_CONFIG.server) || null;
  const serverMode = () => Boolean(serverConfig());

  function wsUrl() {
    const url = new URL(serverConfig().ws, location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  }

  const apiUrl = (path) => new URL(serverConfig().api + path, location.href).href;

  // Verhält sich wie eine PeerJS-Datenverbindung (open, send, close, on), damit PlayerLink unverändert bleibt
  class WsConn {
    constructor(pin, link) {
      this.open = false;
      this.closed = false;
      this.handlers = {};
      this.peerConnection = null;
      this.ws = new WebSocket(wsUrl());
      this.ws.onopen = () => this.ws.send(JSON.stringify({ k: 'player', pin }));
      this.ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (!m || typeof m !== 'object') return;
        if (m.k === 'welcome' && !this.open) {
          this.open = true;
          this.fire('open');
        } else if (m.k === 'no-game') {
          this.refused = true;
          if (link.onUnavailable) link.onUnavailable();
        } else if (m.k === 'busy') {
          this.refused = true;
          if (link.onBusy) link.onBusy();
        } else if (this.open) this.fire('data', m);
      };
      this.ws.onclose = () => this.shut();
      this.ws.onerror = () => {};
    }

    on(ev, fn) {
      (this.handlers[ev] = this.handlers[ev] || []).push(fn);
    }

    fire(ev, data) {
      for (const fn of this.handlers[ev] || []) fn(data);
    }

    send(d) {
      if (!this.open) throw new Error('nicht verbunden');
      this.ws.send(JSON.stringify(d));
    }

    close() {
      try {
        this.ws.close();
      } catch {
        /* schon zu */
      }
      this.shut();
    }

    // Abgewiesen (keine PIN, zu viele Versuche): kein „Verbindung verloren“ und kein Neuverbinden
    shut() {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      if (!this.refused) this.fire('close');
    }
  }

  class WsPlayerLink extends PlayerLink {
    async ensurePeer() {
      return { destroyed: false, connect: (id) => new WsConn(id.slice(PREFIX.length), this) };
    }

    // Fehler wie bei der Direktverbindung, nur mit eigenem Code für den Server
    async connect(pin) {
      this.onBusy = null;
      const busy = new Promise((_, reject) => {
        this.onBusy = () => reject(Object.assign(new Error('busy'), { code: 'busy' }));
      });
      try {
        await Promise.race([super.connect(pin), busy]);
      } catch (err) {
        if (err.code === 'busy') this.closeConn();
        if (err.code === 'ice') err.code = 'server';
        throw err;
      } finally {
        this.onBusy = null;
      }
    }
  }

  // Leinwand eines Spiels auf dem Server. Gleiche Oberfläche wie die HostEngine im Browser
  // (next, kick, end, hostView, snapshot, pin, closed), damit host.js beide gleich behandelt.
  class RemoteGame {
    static async create(quiz, hooks) {
      let res;
      let data = {};
      try {
        res = await fetch(apiUrl('games'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ quiz }),
        });
        data = await res.json().catch(() => ({}));
      } catch {
        throw new Error('Der Spielserver ist nicht erreichbar. Bitte Internet prüfen und erneut versuchen.');
      }
      if (!res.ok) throw Object.assign(new Error(data.error || 'Das Spiel ließ sich nicht anlegen. Bitte erneut versuchen.'), { status: res.status });
      const game = new RemoteGame({ id: data.id, token: data.hostToken, pin: data.pin }, hooks);
      await game.connect();
      return game;
    }

    static async resume(saved, hooks) {
      const game = new RemoteGame(saved, hooks);
      await game.connect();
      return game;
    }

    constructor({ id, token, pin }, { onChange, onClosed, onStatus }) {
      this.id = id;
      this.token = token;
      this.pin = pin;
      this.hooks = { onChange: onChange || (() => {}), onClosed: onClosed || (() => {}), onStatus: onStatus || (() => {}) };
      this.view = null;
      this.ws = null;
      this.seq = 0;
      this.pending = new Map();
      this.closed = false;
      this.retryTimer = 0;
      this.retries = 0;
    }

    // Erste Verbindung: erst fertig, wenn die erste Ansicht da ist
    connect() {
      return new Promise((resolve, reject) => {
        let first = true;
        const ws = new WebSocket(wsUrl());
        this.ws = ws;
        const timer = setTimeout(() => {
          if (!first) return;
          first = false;
          ws.close();
          reject(new Error('Der Spielserver antwortet nicht. Bitte erneut versuchen.'));
        }, 10000);
        ws.onopen = () => ws.send(JSON.stringify({ k: 'host', game: this.id, token: this.token }));
        ws.onmessage = (e) => {
          let m;
          try {
            m = JSON.parse(e.data);
          } catch {
            return;
          }
          if (!m || typeof m !== 'object') return;
          if (m.k === 'view') {
            this.view = m.d;
            this.retries = 0;
            if (first) {
              first = false;
              clearTimeout(timer);
              this.hooks.onStatus('online');
              resolve();
            } else this.hooks.onChange(m.d);
          } else if (m.k === 'ack') {
            const p = this.pending.get(m.id);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(m.id);
              if (m.r && m.r.ok) p.resolve();
              else p.reject(new Error((m.r && m.r.error) || 'Unbekannter Fehler.'));
            }
          } else if (m.k === 'denied') {
            this.finish('Dieses Spiel gibt es nicht mehr.');
            if (first) {
              first = false;
              clearTimeout(timer);
              reject(new Error('Dieses Spiel gibt es nicht mehr.'));
            }
          } else if (m.k === 'closed') {
            this.finish(m.reason || 'Das Spiel ist beendet.');
          }
        };
        ws.onclose = () => {
          if (this.ws !== ws) return;
          this.ws = null;
          this.failPending('Verbindung zum Spielserver unterbrochen.');
          if (first) {
            first = false;
            clearTimeout(timer);
            reject(new Error('Der Spielserver ist nicht erreichbar. Bitte Internet prüfen und erneut versuchen.'));
            return;
          }
          if (this.closed) return;
          this.hooks.onStatus('offline');
          this.scheduleReconnect();
        };
        ws.onerror = () => {};
      });
    }

    // Neu verbinden mit wachsender Pause (1 s bis 10 s); das Spiel läuft auf dem Server weiter
    scheduleReconnect() {
      clearTimeout(this.retryTimer);
      const delay = Math.min(10000, 1000 * 2 ** Math.min(this.retries, 4));
      this.retries += 1;
      this.retryTimer = setTimeout(() => {
        if (this.closed) return;
        this.connect().then(
          () => this.hooks.onChange(this.view),
          () => !this.closed && this.scheduleReconnect(),
        );
      }, delay);
    }

    command(ev, p) {
      return new Promise((resolve, reject) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Keine Verbindung zum Spielserver. Ich verbinde neu …'));
          return;
        }
        this.seq += 1;
        const id = this.seq;
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Der Spielserver antwortet nicht.'));
        }, 8000);
        this.pending.set(id, { resolve, reject, timer });
        this.ws.send(JSON.stringify({ k: 'cmd', id, ev, p: p || {} }));
      });
    }

    failPending(text) {
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(text));
        this.pending.delete(id);
      }
    }

    finish(reason) {
      if (this.closed) return;
      this.closed = true;
      clearTimeout(this.retryTimer);
      this.failPending('Das Spiel ist beendet.');
      if (this.ws) this.ws.close();
      this.ws = null;
      this.hooks.onClosed(reason);
    }

    hostView() {
      return this.view;
    }

    // Für den Tab-Speicher: nur die Zugangsdaten, der Spielstand liegt auf dem Server
    snapshot() {
      return { v: 1, remote: { id: this.id, token: this.token, pin: this.pin } };
    }

    next() {
      return this.command('next');
    }

    kick(playerId) {
      return this.command('kick', { playerId });
    }

    end() {
      if (this.closed) return Promise.resolve();
      const done = this.command('end').catch(() => {});
      this.closed = true;
      clearTimeout(this.retryTimer);
      return done.then(() => {
        if (this.ws) this.ws.close();
      });
    }
  }

  return { HostLink, PlayerLink, LocalHostLink, LocalPlayerLink, WsPlayerLink, RemoteGame, serverMode, PREFIX };
})();
