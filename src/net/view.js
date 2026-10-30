// What the renderer and the HUD show right now: our copy of the game (the host's own Sim, or the
// copy replayed from the host's stream), with enemies drawn between the last two ticks.
import { ENEMIES, posAt } from "../sim/rules.js";
import { S } from "../state.js";
import { viewAlpha } from "./session.js";

export function getView(now) {
  const sim = S.sim;
  if (!sim) return null;
  const alpha = viewAlpha(now);
  const enemies = sim.enemies.map(e => {
    const d = e.pd + (e.d - e.pd) * alpha, p = posAt(e.ln, d);
    return { id: e.id, ty: e.ty, ln: e.ln, d, x: p[0], y: p[1], hp: e.hp, mhp: ENEMIES[e.ty].hp * sim.hs, sl: e.sl };
  });
  return {
    ph: sim.ph, w: sim.w, l: sim.l, tm: sim.tm, sp: sim.sp, pc: sim.pc, hs: sim.hs, seats: sim.seats, gold: sim.gold,
    kills: sim.kills, ready: sim.ready, towers: [...sim.towers.values()], tmap: sim.towers, enemies, syn: sim.syn, t: sim.t + alpha,
    pv: sim.pv, hand: sim.hand, offer: sim.offer, gr: sim.gr, pz: sim.pz, sk: sim.sk,
  };
}
