'use strict';

// Verbindungswege für WebRTC (ICE): STUN für Direktverbindungen, TURN als Relais.
// Quelle ist js/config.js. Reihenfolge:
// 1. peer.config.iceServers ausdrücklich gesetzt (z. B. lokale Entwicklung) → genau diese
// 2. turnCredentialsUrl (z. B. Metered Open Relay) und/oder feste iceServers → plus öffentliches STUN
// 3. nichts eingerichtet → PeerJS-Standard (Google-STUN + öffentliches PeerJS-Relais)

window.LQIce = (function () {
  const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  let pending = null;

  const cfg = () => window.LEAQIZ_CONFIG || {};

  async function fetchServers(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data && Array.isArray(data.iceServers) ? data.iceServers : [];
      if (!list.length) throw new Error('keine Server in der Antwort');
      return list;
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message);
    } finally {
      clearTimeout(timer);
    }
  }

  // Liefert { iceServers, source, error }. source: 'peer-config' | 'eigen' | 'peerjs'
  function resolve() {
    if (pending) return pending;
    pending = (async () => {
      const c = cfg();
      const explicit = c.peer && c.peer.config && Array.isArray(c.peer.config.iceServers) ? c.peer.config.iceServers : null;
      if (explicit) return { iceServers: explicit, source: 'peer-config', error: null };

      const fixed = Array.isArray(c.iceServers) ? c.iceServers : [];
      let fetched = [];
      let error = null;
      if (c.turnCredentialsUrl) {
        try {
          fetched = await fetchServers(c.turnCredentialsUrl);
        } catch (err) {
          error = `Relais-Zugangsdaten nicht abrufbar: ${err.message}`;
        }
      }
      const own = [...fetched, ...fixed];
      if (own.length) return { iceServers: [...STUN, ...own], source: 'eigen', error };
      const fallback = window.peerjs && window.peerjs.util ? window.peerjs.util.defaultConfig.iceServers : STUN;
      return { iceServers: fallback, source: 'peerjs', error };
    })();
    // Fehlgeschlagenen Abruf beim nächsten Mal wiederholen
    pending.then((r) => {
      if (r.error) pending = null;
    });
    return pending;
  }

  async function peerOptions() {
    const { iceServers } = await resolve();
    const base = cfg().peer || {};
    return { debug: 0, ...base, config: { ...(base.config || {}), iceServers } };
  }

  return { resolve, peerOptions };
})();
