import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../../src/sim/sim.js";
import { COLS, BLOCKED, START_GOLD, TOWERS, ENEMIES, PATHS, STEP, DRIP_EVERY, upgradeCost, sellValue, synergyAt, waveTotal, waveMix, waveBonus, dripCap, posAt } from "../../src/sim/rules.js";

const FREE = [...BLOCKED.keys()].filter(c => !BLOCKED[c]);
function table(n) { const s = new Sim(); s.assignSeats(Array.from({ length: n }, (_, i) => "p" + i)); return s; }
let seq = 0;
const act = (sim, seat, ...a) => sim.apply(seat, [++seq, ...a]);

test("building costs gold and is refused on the path or without money", () => {
  const sim = table(1), cell = FREE[0];
  act(sim, 0, "b", cell, 0);
  assert.equal(sim.towers.get(cell).o, 0);
  assert.equal(sim.gold[0], START_GOLD - TOWERS[0].cost);
  const path = [...BLOCKED.keys()].find(c => BLOCKED[c] === 1);
  act(sim, 0, "b", path, 0);
  assert.equal(sim.towers.has(path), false);
  act(sim, 0, "b", FREE[1], 3); // 140 > 110 left
  assert.equal(sim.towers.has(FREE[1]), false);
});

test("upgrading and selling use the published prices", () => {
  const sim = table(1), cell = FREE[0];
  sim.gold[0] = 1000;
  act(sim, 0, "b", cell, 1);
  act(sim, 0, "u", cell);
  assert.equal(sim.towers.get(cell).lv, 2);
  assert.equal(sim.gold[0], 1000 - TOWERS[1].cost - upgradeCost(1, 1));
  const before = sim.gold[0];
  act(sim, 0, "s", cell);
  assert.equal(sim.towers.has(cell), false);
  assert.equal(sim.gold[0], before + sellValue(1, 2));
});

test("only the owner can sell a tower", () => {
  const sim = table(2), cell = FREE[0];
  act(sim, 0, "b", cell, 0);
  act(sim, 1, "s", cell);
  assert.equal(sim.towers.has(cell), true);
});

test("synergy counts other players around a tower, not the same player twice", () => {
  const towers = new Map(), put = (x, y, o) => towers.set(y * COLS + x, { c: y * COLS + x, ty: 0, lv: 1, o });
  put(5, 5, 0); put(6, 5, 1); put(6, 6, 1); put(4, 4, 2); put(4, 5, 0); put(8, 8, 3);
  assert.equal(synergyAt(towers, towers.get(5 * COLS + 5)), 2);
});

test("a wave starts when everyone is ready and pays a bonus when cleared", () => {
  const sim = table(2);
  act(sim, 0, "r", 1);
  sim.step(STEP);
  assert.equal(sim.w, 0, "waits for the second player");
  act(sim, 1, "r", 1);
  sim.step(STEP);
  assert.equal(sim.w, 1);
  assert.equal(sim.ph, 2);
  sim.gold.fill(5000);
  for (const c of FREE.slice(0, 40)) act(sim, 0, "b", c, 0);
  let guard = 0;
  while (sim.ph === 2 && guard++ < 30 * 120) sim.step(STEP);
  assert.equal(sim.ph, 1, "wave cleared");
  assert.equal(sim.w, 1);
});

test("the same inputs give the same game, bit for bit", () => {
  const play = () => {
    const sim = table(3);
    sim.gold.fill(2000);
    FREE.slice(0, 12).forEach((c, i) => act(sim, i % 3, "b", c, i % 4));
    for (let s = 0; s < 3; s++) act(sim, s, "r", 1);
    for (let i = 0; i < 30 * 20; i++) sim.step(STEP);
    return sim;
  };
  const a = play(), b = play();
  assert.ok(a.kills.some(k => k > 0), "the towers have been shooting");
  assert.equal(a.stateHash(), b.stateHash());
  b.gold[2] += 1e-9;
  assert.notEqual(a.stateHash(), b.stateHash(), "the checksum notices the smallest difference");
});

test("waves grow with the number of players", () => {
  assert.ok(waveTotal(10, 5) > waveTotal(10, 1));
  assert.equal(waveMix(5, 1)[3], 1, "every fifth wave brings a Colossus");
});

test("a dropped player keeps the seat for a while, then towers stay without an owner", async () => {
  const { SEAT_GRACE, NO_OWNER } = await import("../../src/sim/rules.js");
  const sim = table(2), cell = FREE[0];
  act(sim, 1, "b", cell, 0);
  const gold = sim.gold[1];
  for (let i = 0; i < 100; i++) { sim.t++; sim.assignSeats(["p0"]); }
  assert.deepEqual(sim.seats.slice(0, 2), ["p0", "p1"], "seat held while away");
  sim.assignSeats(["p0", "p1"]);
  assert.equal(sim.gold[1], gold, "comes back to the same gold");
  for (let i = 0; i < SEAT_GRACE + 5; i++) { sim.t++; sim.assignSeats(["p0"]); }
  assert.equal(sim.seats[1], "", "seat freed after the grace period");
  assert.equal(sim.towers.get(cell).o, NO_OWNER);
  sim.assignSeats(["p0", "p9"]);
  assert.equal(sim.seats[1], "p9");
  assert.equal(sim.gold[1], START_GOLD, "newcomer starts fresh");
  act(sim, 1, "s", cell);
  assert.equal(sim.towers.has(cell), true, "nobody can sell an ownerless tower");
});

test("players who are away do not hold back the first wave", () => {
  const sim = table(2);
  sim.t++; sim.assignSeats(["p0"]);
  act(sim, 0, "r", 1);
  sim.step(STEP);
  assert.equal(sim.w, 1);
});

/** A wave in progress with no more spawns: an enemy with 1 HP right next to a tower of seat 0, one far away. */
function killSetup(players) {
  const sim = table(players), cell = 5 * COLS + 4; // next to the first lane
  act(sim, 0, "b", cell, 0);
  sim.gold.fill(0);
  sim.ph = 2; sim.w = 1; sim.sp = 999;
  const cx = cell % COLS + 0.5, cy = ((cell / COLS) | 0) + 0.5;
  let d = 0;
  for (let x = 0; x < PATHS[0].len; x += 0.05) { const p = posAt(0, x), q = posAt(0, d); if ((p[0] - cx) ** 2 + (p[1] - cy) ** 2 < (q[0] - cx) ** 2 + (q[1] - cy) ** 2) d = x; }
  const enemy = (id, ln, at, hp) => { const p = posAt(ln, at); return { id, ty: 0, ln, d: at, pd: at, hp, sl: 0, x: p[0], y: p[1], dead: false, leak: false, killer: -1 }; };
  sim.enemies.push(enemy(1, 0, d, 1), enemy(2, 1, 0, 1e6));
  return sim;
}

test("a kill pays half to the tower's owner and shares the other half with the table", () => {
  const sim = killSetup(3), g = ENEMIES[0].gold;
  sim.step(STEP);
  assert.equal(sim.enemies.length, 1, "the weak enemy died");
  assert.equal(sim.gold[0], g / 2 + g / 2 / 3);
  assert.equal(sim.gold[1], g / 2 / 3);
  assert.equal(sim.gold[2], g / 2 / 3);
  assert.equal(sim.kills[0], 1);
  const solo = killSetup(1);
  solo.step(STEP);
  assert.equal(solo.gold[0], g, "alone you keep the whole bounty");
});

test("shared gold stays in whole cents", () => {
  const sim = table(5);
  sim.gold[0] = 0;
  for (let i = 0; i < 10; i++) sim.addGold(0, 0.3);
  assert.equal(sim.gold[0], 3);
});

test("the crystal drips gold during a wave and pays the rest of the bonus at the end", () => {
  const sim = table(2);
  act(sim, 0, "r", 1); act(sim, 1, "r", 1);
  sim.step(STEP);
  assert.equal(sim.ph, 2);
  sim.gold.fill(0);
  for (let i = 0; i < DRIP_EVERY * 5; i++) sim.step(STEP);
  assert.deepEqual(sim.gold.slice(0, 2), [5, 5], "1 gold a second to everyone");
  let guard = 0;
  while (sim.ph === 2 && guard++ < 30 * 300) sim.step(STEP);
  assert.equal(sim.ph, 1, "the wave ended");
  assert.ok(dripCap(1) < waveBonus(1));
  assert.deepEqual(sim.gold.slice(0, 2), [waveBonus(1), waveBonus(1)], "drip plus the rest is the whole bonus");
});

test("a pause stops the wave and the break timer until someone resumes", () => {
  const sim = table(2);
  act(sim, 0, "r", 1); act(sim, 1, "r", 1);
  for (let i = 0; i < 90; i++) sim.step(STEP);
  const before = sim.enemies.map(e => e.d).join(), sp = sim.sp;
  act(sim, 1, "p", 1);
  assert.equal(sim.pz, 2);
  sim.gold[0] = 1000;
  act(sim, 0, "b", 5 * COLS + 4, 0);
  assert.equal(sim.towers.size, 0, "no building in a paused wave");
  for (let i = 0; i < 300; i++) sim.step(STEP);
  assert.equal(sim.enemies.map(e => e.d).join(), before);
  assert.equal(sim.sp, sp);
  act(sim, 0, "p", 0);
  sim.step(STEP);
  assert.notEqual(sim.enemies.map(e => e.d).join(), before, "anyone can resume");
});

test("a wave is finished at once only when everyone at the table agrees", () => {
  const sim = table(2);
  act(sim, 0, "r", 1); act(sim, 1, "r", 1);
  sim.step(STEP);
  act(sim, 0, "f", 1);
  assert.equal(sim.finishing(), false, "one vote is not enough");
  act(sim, 1, "f", 1);
  assert.equal(sim.finishing(), true);
  act(sim, 1, "p", 1);
  assert.equal(sim.finishing(), false, "not while paused");
  act(sim, 1, "p", 0);
  let n = 0;
  while (sim.finishing() && n++ < 30 * 300) sim.step(STEP);
  assert.equal(sim.ph, 1, "the wave is over");
  assert.equal(sim.sk, 0, "votes reset for the next wave");
});
