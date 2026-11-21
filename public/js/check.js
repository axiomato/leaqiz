'use strict';

// Verbindungstest: prüft auf diesem Gerät und in diesem Netz, ob leaqizz funktionieren kann.
// 1. WebRTC im Browser  2. Vermittlungsserver  3. STUN (Direktverbindung)  4. TURN (Relais)

(function () {
  const { h } = window.LQ;
  const list = document.getElementById('checks');
  const summary = document.getElementById('summary');
  const code = document.getElementById('code');
  const results = {};

  function row(id, label) {
    const status = h('span', { class: 'check-status', text: 'läuft …' });
    const detail = h('span', { class: 'hint' });
    list.append(h('li', { class: 'check-row', id: `c-${id}` }, h('span', { class: 'check-label', text: label }), status, detail));
    return (ok, text) => {
      results[id] = ok;
      status.textContent = ok ? 'OK' : 'Fehler';
      status.dataset.ok = String(ok);
      detail.textContent = text || '';
    };
  }

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), ms))]);
  }

  function testSignal() {
    return new Promise((resolve) => {
      const started = performance.now();
      let peer;
      try {
        // Nur der Vermittlungsserver wird geprüft: Optionen ohne Relais-Abruf
        const base = (window.LEAQIZ_CONFIG || {}).peer || {};
        peer = new window.Peer({ debug: 0, ...base });
      } catch (err) {
        resolve({ ok: false, text: err.message });
        return;
      }
      const timer = setTimeout(() => {
        peer.destroy();
        resolve({ ok: false, text: 'keine Antwort nach 30 Sekunden' });
      }, 30000);
      peer.on('open', () => {
        clearTimeout(timer);
        const ms = Math.round(performance.now() - started);
        peer.destroy();
        resolve({ ok: true, text: `${ms} ms`, ms });
      });
      peer.on('error', (err) => {
        clearTimeout(timer);
        peer.destroy();
        resolve({ ok: false, text: err.type || err.message });
      });
    });
  }

  // Sammelt ICE-Kandidaten und meldet, ob ein Kandidat des gesuchten Typs dabei ist.
  async function gather(iceServers, wanted, policy) {
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy || 'all' });
    const types = new Set();
    const done = new Promise((resolve) => {
      pc.onicecandidate = (e) => {
        if (!e.candidate) return resolve();
        const m = / typ (\w+)/.exec(e.candidate.candidate);
        if (m) types.add(m[1]);
        if (types.has(wanted)) resolve();
      };
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') resolve();
      };
    });
    pc.createDataChannel('test');
    await pc.setLocalDescription(await pc.createOffer());
    await withTimeout(done, 10000);
    pc.close();
    return { ok: types.has(wanted), types: [...types] };
  }

  // Beschreibt einen TURN-Weg kurz: „UDP 3478“, „TLS 443“ …
  function routeLabel(url) {
    const m = /^(turns?):([^:?]+)(?::(\d+))?(?:\?transport=(\w+))?/.exec(url);
    if (!m) return url;
    const tls = m[1] === 'turns';
    const proto = tls ? 'TLS' : (m[4] || 'udp').toUpperCase();
    return `${m[2]} ${proto} ${m[3] || (tls ? '5349' : '3478')}`;
  }

  // Jeden TURN-Weg einzeln prüfen, damit sichtbar wird, was das Netz durchlässt
  async function testTurnRoutes(turnServers) {
    const routes = [];
    for (const s of turnServers) {
      for (const url of [].concat(s.urls)) {
        if (/^turns?:/.test(url)) routes.push({ url, server: { ...s, urls: url } });
      }
    }
    const results = await Promise.all(
      routes.map((r) =>
        gather([r.server], 'relay', 'relay')
          .then((res) => ({ label: routeLabel(r.url), ok: res.ok }))
          .catch(() => ({ label: routeLabel(r.url), ok: false })),
      ),
    );
    return { ok: results.some((r) => r.ok), routes: results, types: results.some((r) => r.ok) ? ['relay'] : [] };
  }

  async function run() {
    const setWebrtc = row('webrtc', 'WebRTC im Browser');
    const setSignal = row('signal', 'Vermittlungsserver');
    const setStun = row('stun', 'Direktverbindung (STUN)');
    const setTurn = row('turn', 'Relais (TURN)');

    const ice = await window.LQIce.resolve();
    const servers = ice.iceServers || [];
    const stun = servers.filter((s) => [].concat(s.urls).some((u) => u.startsWith('stun:')));
    const turn = servers.filter((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
    const sourceText = { 'peer-config': 'eigene Einstellung', eigen: 'eigenes Relais', peerjs: 'Relais des PeerJS-Projekts' }[ice.source] || ice.source;

    const hasRtc = Boolean(window.RTCPeerConnection);
    setWebrtc(hasRtc, hasRtc ? '' : 'Dieser Browser kann keine Direktverbindungen.');

    const [signal, stunRes, turnRes] = await Promise.all([
      testSignal(),
      hasRtc && stun.length ? gather(stun, 'srflx').catch((e) => ({ ok: false, types: [], err: e.message })) : { ok: false, types: [] },
      hasRtc && turn.length ? testTurnRoutes(turn) : { ok: false, types: [], routes: [] },
    ]);
    setSignal(signal.ok, signal.text);
    setStun(stunRes.ok, stunRes.ok ? '' : 'Keine öffentliche Adresse ermittelt: UDP ist vermutlich gesperrt.');
    const routeText = turnRes.routes.map((r) => `${r.label} ${r.ok ? 'OK' : 'nicht erreichbar'}`).join(', ');
    setTurn(
      turnRes.ok,
      [sourceText, routeText, ice.error, turnRes.ok ? '' : turn.length ? 'Relais nicht erreichbar.' : 'Kein Relais eingerichtet.'].filter(Boolean).join('. '),
    );

    let text;
    if (!hasRtc) text = 'Dieser Browser ist nicht geeignet. Bitte einen aktuellen Browser nutzen.';
    else if (!signal.ok) text = 'Der Vermittlungsserver ist nicht erreichbar. Ohne ihn findet niemand das Spiel.';
    else if (stunRes.ok && turnRes.ok) text = 'Alles erreichbar. Beitreten sollte von diesem Gerät aus klappen.';
    else if (turnRes.ok) text = 'Direktverbindung gesperrt, aber das Relais ist erreichbar. Beitreten sollte klappen, eventuell langsamer.';
    else if (stunRes.ok) text = 'Das Relais ist nicht erreichbar. Beitreten klappt nur, wenn eine Direktverbindung möglich ist. In Mobilfunk- und Schulnetzen scheitert das oft.';
    else text = 'Weder Direktverbindung noch Relais möglich. Von diesem Gerät und Netz aus wird Beitreten nicht klappen.';
    summary.textContent = text;

    const yes = (v) => (v ? 'ja' : 'nein');
    code.textContent =
      `leaqizz-Test: WebRTC ${yes(hasRtc)}, Vermittlung ${signal.ok ? signal.text : 'nein'}, ` +
      `STUN ${yes(stunRes.ok)}, TURN ${yes(turnRes.ok)} (${ice.source}${routeText ? `: ${routeText}` : ''}), Kandidaten ${[...new Set([...stunRes.types, ...turnRes.types])].join('/') || '-'}, ` +
      `${navigator.userAgent.replace(/\s*\(.*?\)\s*/g, ' ').slice(0, 80)}`;
  }

  document.getElementById('rerun').addEventListener('click', () => {
    list.replaceChildren();
    summary.textContent = 'Test läuft …';
    code.textContent = '';
    run();
  });
  run();
})();
