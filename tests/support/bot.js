// A simple bot team that plays a full game on the simulation, used to check balance.
// It builds on the cells covering most of the path, rotates tower types and upgrades when it can.
// A seed varies how often each bot shops, its first tower type and which of the best free cells it takes,
// so averages over several seeds show the difficulty better than one deterministic game.
import { Sim } from "../../src/sim/sim.js";
import { TOWERS, PATHS, BLOCKED, COLS, ROWS, STEP, START_LIVES, posAt, upgradeCost, isSupport } from "../../src/sim/rules.js";
import { P, SP, SPELLS, isSpellCode } from "../../src/sim/cards.js";

const PREFER = ["unity", "temper", "eye", "archer", "craft", "powder", "arc", "winter", "trade"].map(k => P[k]);
/**
 * A bot's card play: takes the most useful passive on offer (else the first spell) and casts spells
 * when they help. `act(...args)` sends one action for this seat.
 */
export function botCards(sim, seat, act) {
  const offer = sim.offer[seat];
  if (offer.length) {
    const passive = PREFER.find(p => offer.includes(p));
    act("k", passive !== undefined ? offer.indexOf(passive) : offer.findIndex(isSpellCode));
    return;
  }
  if (sim.ph !== 2) return;
  const foes = sim.enemies.filter(e => !e.dead);
  const front = foes.slice().sort((a, b) => (PATHS[a.ln].len - a.d) - (PATHS[b.ln].len - b.d))[0];
  sim.hand[seat].some((id, idx) => {
    if (sim.gold[seat] < SPELLS[id].cost) return false;
    let target = -1;
    if (id === SP.heal && sim.l > START_LIVES - 3) return false;
    if ((id === SP.storm || id === SP.quake) && foes.length < 8) return false;
    if (id === SP.rush && foes.length < 6) return false;
    if (id === SP.fire) { if (foes.length < 3) return false; target = Math.floor(front.y) * COLS + Math.floor(front.x); }
    if (id === SP.surge) { const tw = [...sim.towers.values()].sort((a, b) => b.lv - a.lv)[0]; if (!tw || foes.length < 4) return false; target = tw.c; }
    act("m", idx, target);
    return true;
  });
}

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

function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Plays one game with n bot players; returns the wave reached, lives left and how each wave went. */
// Support towers go on a free cell touching the most shooting towers (at least three), or are skipped.
function supportCell(sim) {
  let best = -1, most = 2;
  for (let c = 0; c < COLS * ROWS; c++) {
    if (BLOCKED[c] || sim.towers.has(c)) continue;
    const x = c % COLS, y = (c / COLS) | 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = (dx || dy) && x + dx >= 0 && x + dx < COLS && y + dy >= 0 && y + dy < ROWS ? sim.towers.get((y + dy) * COLS + x + dx) : null;
      if (t && !isSupport(t.ty)) n++;
    }
    // prefer cells that shooters would cover the path poorly from
    if (n > most || (n === most && best >= 0 && cov[c] < cov[best])) { most = n; best = c; }
  }
  return best;
}

export function playGame(n, { archersOnly = false, seed = 0, cards = true, supports = true } = {}) {
  const sim = new Sim();
  sim.assignSeats(Array.from({ length: n }, (_, i) => "bot" + i));
  let seq = 0;
  const rand = rng(seed + 1), period = seed ? 60 + Math.floor(rand() * 60) : 90, pick = seed ? 3 : 1;
  const built = Array.from({ length: n }, () => (seed ? Math.floor(rand() * ROTATION.length) : 0)), sup = Array(n).fill(0), shooters = Array(n).fill(0);
  const act = (s, ...a) => sim.apply(s, [++seq, ...a]);
  function spend(s) {
    for (let guard = 0; guard < 20; guard++) {
      let ty = archersOnly ? 0 : ROTATION[built[s] % ROTATION.length];
      // now and then a support tower: one per six shooters from the fourth wave on (beacon, banner, echo in turn)
      const wantSupport = supports && !archersOnly && sim.w >= 4 && shooters[s] >= 6 * (sup[s] + 1);
      if (wantSupport) ty = 4 + sup[s] % 3;
      const g = sim.gold[s];
      const mine = [...sim.towers.values()].filter(t => t.o === s && !isSupport(t.ty)); // supports are extra
      const wantBuild = mine.length < (archersOnly ? 99 : 3 + Math.floor(sim.w * 0.6));
      const free = () => { const f = order.filter(c => !sim.towers.has(c)).slice(0, pick); return f[Math.floor(rand() * f.length)]; };
      if (isSupport(ty)) {
        const c = supportCell(sim);
        if (c < 0) { sup[s]++; continue; } // no good spot: skip it
        if (g < TOWERS[ty].cost) return; // save up for it
        act(s, "b", c, ty); sup[s]++; continue;
      }
      if (wantBuild && g >= TOWERS[ty].cost) { const c = free(); if (c === undefined) return; act(s, "b", c, ty); built[s]++; shooters[s]++; continue; }
      if (!archersOnly) {
        const up = mine.filter(t => t.lv < 3).sort((a, b) => cov[b.c] - cov[a.c])[0];
        if (up && g >= upgradeCost(up.ty, up.lv)) { act(s, "u", up.c); continue; }
        if (!wantBuild && g >= TOWERS[ty].cost + 120) { const c = free(); if (c !== undefined) { act(s, "b", c, ty); built[s]++; shooters[s]++; continue; } }
      }
      return;
    }
  }
  const lost = [];
  let t = 0, lastW = 0, livesAtStart = sim.l;
  while (sim.ph <= 2 && t < 30 * 60 * 60) {
    if (t % period === 0) for (let s = 0; s < n; s++) { if (cards) botCards(sim, s, (...a) => act(s, ...a)); spend(s); }
    if (sim.ph === 1) for (let s = 0; s < n; s++) act(s, "r", 1);
    sim.step(STEP); t++;
    if (sim.w !== lastW) { if (lastW) lost.push(livesAtStart - sim.l); lastW = sim.w; livesAtStart = sim.l; }
  }
  return { players: n, wave: sim.w, lives: sim.l, won: sim.ph === 4, minutes: +(t / 30 / 60).toFixed(1), livesLostPerWave: lost };
}
