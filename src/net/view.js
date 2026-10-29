// What the renderer and the HUD show right now: the host's own Sim, or the latest snapshot with
// enemies moved forward to the present (they walk fixed paths at known speeds).
import { ENEMIES, PATHS, SLOW_FACTOR, posAt } from "../sim/rules.js";
import { S } from "../state.js";
import { hostAlpha } from "./session.js";

export const corr = new Map(); // id -> { off, at }: display offsets that fade out after a correction

export function getView(now) {
  const sim = S.sim;
  if (S.isHost && sim) {
    const alpha = hostAlpha();
    const enemies = sim.enemies.map(e => {
      const d = e.pd + (e.d - e.pd) * alpha, p = posAt(e.ln, d);
      return { id: e.id, ty: e.ty, ln: e.ln, d, x: p[0], y: p[1], hp: e.hp, mhp: ENEMIES[e.ty].hp * sim.hs, sl: e.sl };
    });
    const towers = [...sim.towers.values()];
    return {
      ph: sim.ph, w: sim.w, l: sim.l, tm: sim.tm, sp: sim.sp, pc: sim.pc, hs: sim.hs, seats: sim.seats, gold: sim.gold,
      kills: sim.kills, ready: sim.ready, towers, tmap: sim.towers, enemies, syn: sim.syn, t: sim.t, rt: sim.t,
    };
  }
  const latest = S.latest;
  if (!latest) return null;
  const el = Math.min(0.6, Math.max(0, (now - latest.at) / 1000));
  const enemies = [];
  for (const [id, p] of predictEnemies(latest, now)) {
    const d = p.d + (corr.has(id) ? corrOffset(id, now) : 0), e = p.e, pos = posAt(p.ln, d);
    enemies.push({ id, ty: e.ty, ln: e.ln, d, x: pos[0], y: pos[1], hp: e.hp, mhp: e.mhp, sl: Math.max(0, e.sl - el) });
  }
  return { ...latest.dec, enemies, rt: latest.t + el * 30 };
}

// Enemies walk fixed paths at known speeds, so between updates each client moves them forward itself.
export function predictEnemies(snap, now) {
  const el = Math.min(0.6, Math.max(0, (now - snap.at) / 1000)), out = new Map();
  for (const e of snap.dec.enemies) {
    const slowT = Math.min(el, Math.max(0, e.sl));
    const d = Math.min(PATHS[e.ln].len, e.d + ENEMIES[e.ty].speed * (slowT * SLOW_FACTOR + (el - slowT)));
    out.set(e.id, { ln: e.ln, d, e });
  }
  return out;
}

export function corrOffset(id, now) {
  const c = corr.get(id);
  if (!c) return 0;
  const k = Math.exp(-(now - c.at) / 140);
  if (k < 0.02) { corr.delete(id); return 0; }
  return c.off * k;
}
