import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../../src/sim/sim.js";
import { COLS, BLOCKED, START_GOLD, TOWERS, STEP, upgradeCost, sellValue, synergyAt, waveTotal, waveMix } from "../../src/sim/rules.js";

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
