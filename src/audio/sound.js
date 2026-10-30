// Sound effects, synthesised with the Web Audio API (no audio files to download).
// Each sound is a short recipe of oscillators and filtered noise. Busy moments stay pleasant:
// every sound has a minimum gap between repeats and the number of voices at once is capped.
// The volume (and mute) is a per-browser setting kept in localStorage.

let ctx = null, master = null, noiseBuf = null;
let volume = 0.6, muted = false, voices = 0;
const MAX_VOICES = 24;
const lastPlayed = new Map();

try {
  const v = parseFloat(localStorage.getItem("kv-vol"));
  if (Number.isFinite(v)) volume = Math.min(1, Math.max(0, v));
  muted = localStorage.getItem("kv-mute") === "1";
} catch (_) {}

export function getVolume() { return { volume, muted }; }
export function setVolume(v, m) {
  if (v !== undefined) volume = Math.min(1, Math.max(0, v));
  if (m !== undefined) muted = !!m;
  try { localStorage.setItem("kv-vol", String(volume)); localStorage.setItem("kv-mute", muted ? "1" : "0"); } catch (_) {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : volume * volume, ctx.currentTime, 0.02);
}

/** Browsers start audio only after a click or key press: call this from one. */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (_) { ctx = null; return; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume * volume;
    // a gentle limiter, so many shots at once do not clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}

/* ---------- building blocks ---------- */
function out(pan, gain) {
  const g = ctx.createGain(); g.gain.value = gain;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master); }
  else g.connect(master);
  return g;
}
function env(param, t, peak, attack, decay) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function tone(dest, t, { type = "sine", f0, f1 = f0, dur, peak = 0.5, attack = 0.005 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g.gain, t, peak, attack, dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + attack + dur + 0.02);
  return o;
}
function noise(dest, t, { dur, peak = 0.5, attack = 0.003, filter = "bandpass", f0 = 1000, f1 = f0, q = 1 }) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true;
  f.type = filter; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g.gain, t, peak, attack, dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random() * 0.5); s.stop(t + attack + dur + 0.02);
  return s;
}
const notes = (dest, t, freqs, step, opts) => freqs.forEach((f, i) => tone(dest, t + i * step, { f0: f, ...opts }));

/* ---------- the sounds ---------- */
// [minimum gap between repeats in ms, volume, recipe(dest, t)]
export const SOUND_NAMES = () => Object.keys(SOUNDS);
const SOUNDS = {
  arrow: [45, 0.32, (d, t) => { noise(d, t, { dur: 0.06, f0: 3800, f1: 1800, q: 2, peak: 0.6 }); tone(d, t, { type: "triangle", f0: 900, f1: 500, dur: 0.05, peak: 0.25 }); }],
  cannon: [90, 0.5, (d, t) => { tone(d, t, { f0: 140, f1: 48, dur: 0.28, peak: 0.9 }); noise(d, t, { dur: 0.12, filter: "lowpass", f0: 900, f1: 200, peak: 0.6 }); }],
  boom: [80, 0.55, (d, t) => { noise(d, t, { dur: 0.32, filter: "lowpass", f0: 700, f1: 90, peak: 0.9 }); tone(d, t, { f0: 90, f1: 35, dur: 0.3, peak: 0.6 }); }],
  frost: [70, 0.3, (d, t) => { tone(d, t, { f0: 1760, f1: 2400, dur: 0.16, peak: 0.25 }); tone(d, t + 0.02, { f0: 2637, f1: 3200, dur: 0.12, peak: 0.15 }); noise(d, t, { dur: 0.12, filter: "highpass", f0: 5000, peak: 0.2 }); }],
  zap: [60, 0.28, (d, t) => { tone(d, t, { type: "sawtooth", f0: 1400 + Math.random() * 400, f1: 300, dur: 0.11, peak: 0.35 }); noise(d, t, { dur: 0.08, f0: 2500, q: 4, peak: 0.4 }); }],
  pop: [35, 0.3, (d, t) => tone(d, t, { type: "triangle", f0: 520 + Math.random() * 80, f1: 160, dur: 0.09, peak: 0.6 })],
  bigpop: [200, 0.7, (d, t) => { noise(d, t, { dur: 0.6, filter: "lowpass", f0: 900, f1: 60, peak: 0.9 }); tone(d, t, { f0: 110, f1: 30, dur: 0.6, peak: 0.8 }); }],
  coin: [70, 0.3, (d, t) => notes(d, t, [1318, 1976], 0.06, { type: "triangle", dur: 0.12, peak: 0.4 })],
  drip: [500, 0.12, (d, t) => tone(d, t, { f0: 2093, f1: 2350, dur: 0.08, peak: 0.4 })],
  leak: [150, 0.6, (d, t) => { tone(d, t, { f0: 80, f1: 40, dur: 0.4, peak: 0.9 }); noise(d, t, { dur: 0.25, filter: "lowpass", f0: 500, f1: 120, peak: 0.5 }); tone(d, t, { type: "square", f0: 220, f1: 110, dur: 0.18, peak: 0.12 }); }],
  wave: [500, 0.45, (d, t) => { for (const f of [196, 294]) tone(d, t, { type: "sawtooth", f0: f, f1: f * 1.02, dur: 0.9, attack: 0.18, peak: 0.18 }); noise(d, t, { dur: 0.8, filter: "lowpass", f0: 400, peak: 0.08, attack: 0.2 }); }],
  cleared: [500, 0.4, (d, t) => notes(d, t, [523, 659, 784, 1046], 0.09, { type: "triangle", dur: 0.25, peak: 0.4 })],
  win: [1000, 0.5, (d, t) => notes(d, t, [523, 659, 784, 1046, 1318], 0.13, { type: "triangle", dur: 0.5, peak: 0.45 })],
  lose: [1000, 0.5, (d, t) => notes(d, t, [392, 330, 262, 196], 0.22, { type: "sawtooth", dur: 0.5, peak: 0.12 })],
  card: [300, 0.4, (d, t) => notes(d, t, [784, 988, 1175, 1568], 0.06, { dur: 0.35, peak: 0.25 })],
  build: [60, 0.45, (d, t) => { noise(d, t, { dur: 0.07, filter: "lowpass", f0: 1200, peak: 0.7 }); tone(d, t, { f0: 210, f1: 150, dur: 0.1, peak: 0.6 }); }],
  upgrade: [80, 0.4, (d, t) => notes(d, t, [660, 990], 0.07, { type: "triangle", dur: 0.16, peak: 0.45 })],
  sell: [80, 0.35, (d, t) => notes(d, t, [990, 660], 0.07, { type: "triangle", dur: 0.14, peak: 0.4 })],
  click: [40, 0.25, (d, t) => tone(d, t, { type: "triangle", f0: 1200, f1: 900, dur: 0.04, peak: 0.4 })],
  pause: [150, 0.35, (d, t) => notes(d, t, [660, 440], 0.08, { dur: 0.16, peak: 0.35 })],
  resume: [150, 0.35, (d, t) => notes(d, t, [440, 660], 0.08, { dur: 0.16, peak: 0.35 })],
  fire: [100, 0.6, (d, t) => { noise(d, t, { dur: 0.35, f0: 400, f1: 2400, q: 0.7, peak: 0.4, attack: 0.05 }); SOUNDS.boom[2](d, t + 0.3); }],
  storm: [300, 0.45, (d, t) => { noise(d, t, { dur: 1.2, f0: 600, f1: 2600, q: 3, peak: 0.35, attack: 0.25 }); tone(d, t, { f0: 1976, f1: 2637, dur: 0.6, peak: 0.1, attack: 0.1 }); }],
  quake: [300, 0.6, (d, t) => { noise(d, t, { dur: 0.9, filter: "lowpass", f0: 220, f1: 60, peak: 0.9, attack: 0.05 }); tone(d, t, { f0: 50, f1: 32, dur: 0.9, peak: 0.7, attack: 0.05 }); }],
  heal: [300, 0.45, (d, t) => { notes(d, t, [523, 659, 784], 0.08, { dur: 0.7, peak: 0.25, attack: 0.04 }); tone(d, t + 0.25, { f0: 1046, f1: 1568, dur: 0.6, peak: 0.12 }); }],
  surge: [200, 0.4, (d, t) => tone(d, t, { type: "sawtooth", f0: 200, f1: 1600, dur: 0.4, peak: 0.25, attack: 0.02 })],
  rush: [300, 0.4, (d, t) => notes(d, t, [1318, 1568, 1976, 2637], 0.05, { type: "triangle", dur: 0.12, peak: 0.35 })],
};

/**
 * Plays a sound. pan: -1 (left) .. 1 (right); delay in seconds; gain multiplies the sound's volume.
 * Quietly does nothing before the first click, while muted, and when the same sound just played.
 * Returns whether it played.
 */
export function playSound(name, { pan = 0, delay = 0, gain = 1 } = {}) {
  if (!ctx || muted || volume <= 0 || ctx.state !== "running") return false;
  const s = SOUNDS[name];
  if (!s || voices >= MAX_VOICES) return false;
  const now = performance.now();
  if (now - (lastPlayed.get(name) || -1e9) < s[0]) return false;
  lastPlayed.set(name, now);
  voices++;
  const t = ctx.currentTime + 0.01 + delay;
  const dest = out(pan * 0.7, s[1] * gain);
  try { s[2](dest, t); } catch (e) { console.error("sound", name, e); }
  setTimeout(() => { voices--; try { dest.disconnect(); } catch (_) {} }, (delay + 1.6) * 1000);
  return true;
}
