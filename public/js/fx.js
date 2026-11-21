'use strict';

// Effekte der Leinwand: Töne (im Browser erzeugt, keine Audiodateien) und Konfetti.
// Töne sind abschaltbar; die Einstellung bleibt im Browser der Spielleitung gespeichert.

window.LQFX = (function () {
  const KEY = 'leaqiz.sound';
  let ctx = null;
  let master = null;
  let enabled = true;
  try {
    enabled = window.localStorage.getItem(KEY) !== 'off';
  } catch {
    enabled = true;
  }

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Browser erlauben Ton erst nach einer Nutzeraktion: beim ersten Klick oder Tastendruck vorbereiten.
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });

  function ready() {
    return enabled && ctx && ctx.state === 'running';
  }

  function tone(freq, start, length, { type = 'triangle', gain = 0.5, glideTo = null } = {}) {
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + length);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  let noiseBuffer = null;
  function noise(start, length, gain) {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    src.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter).connect(amp).connect(master);
    src.start(t);
    src.stop(t + length + 0.02);
  }

  const C5 = 523.25;
  const E5 = 659.25;
  const G5 = 783.99;
  const C6 = 1046.5;

  const sounds = {
    // Neuer Name in der Lobby
    join: () => tone(880, 0, 0.12, { type: 'sine', gain: 0.35, glideTo: 1320 }),
    // Letzte Sekunden einer Frage
    tick: () => tone(1200, 0, 0.05, { type: 'square', gain: 0.12 }),
    // Frage startet
    go: () => {
      tone(G5, 0, 0.12, { gain: 0.4 });
      tone(C6, 0.1, 0.25, { gain: 0.4 });
    },
    // Doppelte Punkte angekündigt
    double: () => {
      [C5, G5, C5, G5].forEach((f, i) => tone(f, i * 0.09, 0.1, { type: 'square', gain: 0.18 }));
      tone(C6, 0.38, 0.4, { type: 'square', gain: 0.2 });
    },
    // Auflösung
    reveal: () => {
      tone(E5, 0, 0.14, { gain: 0.45 });
      tone(C6, 0.12, 0.45, { gain: 0.45 });
    },
    // Rangliste sortiert sich um
    shuffle: () => [0, 0.06, 0.12, 0.18].forEach((s, i) => tone(500 + i * 120, s, 0.08, { type: 'sine', gain: 0.2 })),
    // Podiumsplatz erscheint
    place: () => tone(392, 0, 0.3, { gain: 0.45, glideTo: 784 }),
    // Trommelwirbel vor Platz 1
    drumroll: (seconds = 2) => {
      const hits = Math.round(seconds * 18);
      for (let i = 0; i < hits; i += 1) noise(i / 18, 0.07, 0.15 + (i / hits) * 0.5);
    },
    // Sieger
    fanfare: () => {
      [C5, E5, G5].forEach((f, i) => tone(f, i * 0.12, 0.2, { gain: 0.4 }));
      [C5, E5, G5, C6].forEach((f) => tone(f, 0.4, 1.4, { gain: 0.22 }));
    },
    // Auszeichnung erscheint
    award: () => tone(C6, 0, 0.25, { type: 'sine', gain: 0.3, glideTo: 1568 }),
  };

  function play(name, ...args) {
    if (!ready() || !sounds[name]) return;
    try {
      sounds[name](...args);
    } catch {
      /* Ton ist Beiwerk: Fehler nie durchreichen */
    }
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    try {
      window.localStorage.setItem(KEY, enabled ? 'on' : 'off');
    } catch {
      /* ohne Speicher gilt die Einstellung nur bis zum Neuladen */
    }
    if (enabled) unlock();
  }

  // ---------- Konfetti (Canvas, ohne Bibliothek) ----------

  const COLORS = ['#0f6e74', '#c2410c', '#6741d9', '#b0234f', '#ffffff', '#f5c542'];

  function confetti(host, { duration = 3200, count = 160 } = {}) {
    if (reducedMotion() || !host) return () => {};
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    canvas.setAttribute('aria-hidden', 'true');
    host.append(canvas);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = host.clientWidth;
    const hgt = host.clientHeight;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const parts = Array.from({ length: count }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: hgt * 0.55,
      vx: (Math.random() - 0.5) * 14,
      vy: -8 - Math.random() * 12,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      s: 6 + Math.random() * 8,
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
    const start = performance.now();
    let frame = 0;
    function step(now) {
      const t = now - start;
      g.clearRect(0, 0, w, hgt);
      g.globalAlpha = t > duration - 600 ? Math.max(0, (duration - t) / 600) : 1;
      for (const p of parts) {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.fillStyle = p.c;
        g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        g.restore();
      }
      if (t < duration) frame = requestAnimationFrame(step);
      else canvas.remove();
    }
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      canvas.remove();
    };
  }

  return {
    play,
    confetti,
    reducedMotion,
    get enabled() {
      return enabled;
    },
    setEnabled,
  };
})();
