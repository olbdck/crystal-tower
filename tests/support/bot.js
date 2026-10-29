// A simple bot team that plays a full game on the simulation, used to check balance.
// It builds on the cells covering most of the path, rotates tower types and upgrades when it can.
import { Sim } from "../../src/sim/sim.js";
import { TOWERS, PATHS, BLOCKED, COLS, ROWS, STEP, posAt, upgradeCost } from "../../src/sim/rules.js";

const samples = [];
PATHS.forEach((p, ln) => { for (let d = 0; d < p.len; d += 0.25) samples.push(posAt(ln, d)); });
function coverage(c, r) {
  const x = c % COLS + 0.5, y = ((c / COLS) | 0) + 0.5;
  let n = 0;
  for (const [sx, sy] of samples) if ((sx - x) ** 2 + (sy - y) ** 2 <= r * r) n++;
  return n;
}
const cov = Array.from({ length: COLS * ROWS }, (_, c) => (BLOCKED[c] ? -1 : coverage(c, 2.4)));
const order = [...cov.keys()].filter(c => cov[c] > 0).sort((a, b) => cov[b] - cov[a]);
const ROTATION = [0, 0, 2, 1, 0, 3, 1, 0, 2, 3];

/** Plays one game with n bot players; returns the wave reached, lives left and how each wave went. */
export function playGame(n, { archersOnly = false } = {}) {
  const sim = new Sim();
  sim.assignSeats(Array.from({ length: n }, (_, i) => "bot" + i));
  let seq = 0;
  const built = Array(n).fill(0);
  const act = (s, ...a) => sim.apply(s, [++seq, ...a]);
  function spend(s) {
    for (let guard = 0; guard < 20; guard++) {
      const g = sim.gold[s], ty = archersOnly ? 0 : ROTATION[built[s] % ROTATION.length];
      const mine = [...sim.towers.values()].filter(t => t.o === s);
      const wantBuild = mine.length < (archersOnly ? 99 : 3 + Math.floor(sim.w * 0.6));
      const free = () => order.find(c => !sim.towers.has(c));
      if (wantBuild && g >= TOWERS[ty].cost) { const c = free(); if (c === undefined) return; act(s, "b", c, ty); built[s]++; continue; }
      if (!archersOnly) {
        const up = mine.filter(t => t.lv < 3).sort((a, b) => cov[b.c] - cov[a.c])[0];
        if (up && g >= upgradeCost(up.ty, up.lv)) { act(s, "u", up.c); continue; }
        if (!wantBuild && g >= TOWERS[ty].cost + 120) { const c = free(); if (c !== undefined) { act(s, "b", c, ty); built[s]++; continue; } }
      }
      return;
    }
  }
  const lost = [];
  let t = 0, lastW = 0, livesAtStart = sim.l;
  while (sim.ph <= 2 && t < 30 * 60 * 60) {
    if (t % 90 === 0) for (let s = 0; s < n; s++) spend(s);
    if (sim.ph === 1) for (let s = 0; s < n; s++) act(s, "r", 1);
    sim.step(STEP); t++;
    if (sim.w !== lastW) { if (lastW) lost.push(livesAtStart - sim.l); lastW = sim.w; livesAtStart = sim.l; }
  }
  return { players: n, wave: sim.w, lives: sim.l, won: sim.ph === 4, minutes: +(t / 30 / 60).toFixed(1), livesLostPerWave: lost };
}
