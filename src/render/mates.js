// Teammates' pointers on the board. Their positions arrive 10-15 times a second and a little late, so
// each pointer glides towards the newest position instead of jumping, and fades in and out.
import { COLS, ROWS } from "../sim/rules.js";
import { S } from "../state.js";
import { cleanName } from "../net/session.js";

const GLIDE_MS = 75, FADE_MS = 140;
const state = new Map(); // peer -> { x, z, tx, tz, a, on, seat, name }
let lastNow = 0;
/** Smoothed pointers for this frame: [{ x, z, a (0..1), seat, name }]. */
export let mates = [];

export function updateMates(v, now) {
  if (now === lastNow) return mates;
  const dt = Math.min(120, Math.max(0, now - lastNow)); lastNow = now;
  const glide = 1 - Math.exp(-dt / GLIDE_MS), fade = 1 - Math.exp(-dt / FADE_MS);
  const seen = new Set();
  for (const p of S.peerList) {
    if (p.sameTab || !p.presence || !v) continue;
    const seat = v.seats.indexOf(p.peer);
    if (seat < 0) continue;
    seen.add(p.peer);
    const pr = p.presence, hp = pr.hp, h = pr.h;
    let tx = null, tz = null;
    if (Array.isArray(hp) && Number.isFinite(hp[0]) && Number.isFinite(hp[1])) { tx = Math.min(COLS, Math.max(0, hp[0] / 10)); tz = Math.min(ROWS, Math.max(0, hp[1] / 10)); }
    else if (Number.isInteger(h) && h >= 0 && h < COLS * ROWS) { tx = h % COLS + 0.5; tz = ((h / COLS) | 0) + 0.5; }
    let m = state.get(p.peer);
    if (!m) { m = { x: tx || 0, z: tz || 0, tx: 0, tz: 0, a: 0, on: false }; state.set(p.peer, m); }
    m.seat = seat; m.name = cleanName(pr.n);
    if (tx !== null) {
      // appearing again somewhere else: start there instead of sliding across the board
      if (m.a < 0.05) { m.x = tx; m.z = tz; }
      m.tx = tx; m.tz = tz; m.on = true;
    } else m.on = false;
    m.x += (m.tx - m.x) * glide; m.z += (m.tz - m.z) * glide;
    m.a += ((m.on ? 1 : 0) - m.a) * fade;
  }
  for (const [peer, m] of state) if (!seen.has(peer)) { m.on = false; m.a *= 1 - fade; if (m.a < 0.02) state.delete(peer); }
  mates = [];
  for (const m of state.values()) if (m.a > 0.02) mates.push(m);
  return mates;
}
