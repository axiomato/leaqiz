'use strict';

// Verbindungstest: prüft auf diesem Gerät und in diesem Netz, ob leaqiz funktionieren kann.
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
        peer = new window.Peer({ debug: 0, ...((window.LEAQIZ_CONFIG || {}).peer || {}) });
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

  async function run() {
    const servers = ((window.LEAQIZ_CONFIG || {}).peer || {}).config || window.peerjs.util.defaultConfig;
    const ice = servers.iceServers || [];
    const stun = ice.filter((s) => [].concat(s.urls).some((u) => u.startsWith('stun:')));
    const turn = ice.filter((s) => [].concat(s.urls).some((u) => u.startsWith('turn:')));

    const setWebrtc = row('webrtc', 'WebRTC im Browser');
    const setSignal = row('signal', 'Vermittlungsserver');
    const setStun = row('stun', 'Direktverbindung (STUN)');
    const setTurn = row('turn', 'Relais (TURN)');

    const hasRtc = Boolean(window.RTCPeerConnection);
    setWebrtc(hasRtc, hasRtc ? '' : 'Dieser Browser kann keine Direktverbindungen.');

    const [signal, stunRes, turnRes] = await Promise.all([
      testSignal(),
      hasRtc && stun.length ? gather(stun, 'srflx').catch((e) => ({ ok: false, types: [], err: e.message })) : { ok: false, types: [] },
      hasRtc && turn.length ? gather(turn, 'relay', 'relay').catch((e) => ({ ok: false, types: [], err: e.message })) : { ok: false, types: [] },
    ]);
    setSignal(signal.ok, signal.text);
    setStun(stunRes.ok, stunRes.ok ? '' : 'Keine öffentliche Adresse ermittelt: UDP ist vermutlich gesperrt.');
    setTurn(turnRes.ok, turnRes.ok ? '' : 'Relais nicht erreichbar: gesperrt oder Server nicht verfügbar.');

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
      `leaqiz-Test: WebRTC ${yes(hasRtc)}, Vermittlung ${signal.ok ? signal.text : 'nein'}, ` +
      `STUN ${yes(stunRes.ok)}, TURN ${yes(turnRes.ok)}, Kandidaten ${[...new Set([...stunRes.types, ...turnRes.types])].join('/') || '-'}, ` +
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
