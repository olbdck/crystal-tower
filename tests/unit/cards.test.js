import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../../src/sim/sim.js";
import { COLS, STEP, START_LIVES, TOWERS } from "../../src/sim/rules.js";
import { P, SP, SPELLS, SPELL_BASE, HAND_MAX, isSpellCode, drawOffer } from "../../src/sim/cards.js";
import { decodeKeyframe, encodeKeyframe } from "../../src/net/codec.js";

let seq = 0;
const act = (sim, seat, ...a) => sim.apply(seat, [++seq, ...a]);
function table(n) { const s = new Sim(); s.setRoster(Array.from({ length: n }, (_, i) => "p" + i)); return s; }
/** Ends wave w at once (no enemies left to spawn). */
function finishWave(sim, w) { sim.w = w; sim.ph = 2; sim.sp = 1e6; sim.enemies = []; sim.step(STEP); }
function enemyAt(sim, cell, hp) {
  const x = cell % COLS + 0.5, y = ((cell / COLS) | 0) + 0.5;
  const e = { id: sim.nid++, ty: 0, ln: 0, d: 1, pd: 1, hp, sl: 0, x, y, dead: false, leak: false, killer: -1 };
  sim.enemies.push(e);
  return e;
}

test("every third wave each player is offered three different cards, a passive and a spell among them", () => {
  const sim = table(3);
  finishWave(sim, 2);
  assert.deepEqual(sim.offer.slice(0, 3), [[], [], []], "no cards after wave 2");
  finishWave(sim, 3);
  for (let i = 0; i < 3; i++) {
    const o = sim.offer[i];
    assert.equal(new Set(o).size, 3);
    assert.ok(o.some(isSpellCode) && o.some(c => !isSpellCode(c)));
  }
  assert.notDeepEqual(sim.offer[0], sim.offer[1], "players get different offers");
  assert.ok(!drawOffer(6, 0, 0b111111111, 1).some(c => !isSpellCode(c)), "owned passives are not offered again");
  for (let w = 3; w <= 18; w += 3) for (let seat = 0; seat < 5; seat++) assert.ok(drawOffer(w, seat, 0b011111111 & ~(1 << (w % 8)), w).includes(P.unity), "Єдність comes every time until taken");
});

test("a card on offer must be picked before getting ready", () => {
  const sim = table(1);
  finishWave(sim, 3);
  act(sim, 0, "r", 1);
  assert.equal(sim.ready[0], false);
  act(sim, 0, "k", 0);
  assert.deepEqual(sim.offer[0], []);
  act(sim, 0, "r", 1);
  assert.equal(sim.ready[0], true);
});

test("passive cards change prices and stats of the owner's towers only, and never pay a profit", () => {
  const sim = table(2), a = 5 * COLS + 4, b = 5 * COLS + 5;
  sim.pv[0] = (1 << P.archer) | (1 << P.trade) | (1 << P.eye);
  sim.gold.fill(1000);
  act(sim, 0, "b", a, 0); act(sim, 1, "b", b, 0);
  assert.equal(sim.gold[0], 1000 - TOWERS[0].cost * 0.8);
  assert.equal(sim.gold[1], 1000 - TOWERS[0].cost);
  act(sim, 0, "s", a);
  assert.equal(sim.gold[0], 1000, "bought at 80%, sold at 80%");
});

test("spells cost gold, work only during a wave and leave the hand", () => {
  const sim = table(1), cell = 5 * COLS + 4;
  sim.hand[0] = [SP.fire, SP.heal];
  sim.gold[0] = 500;
  act(sim, 0, "m", 0, cell);
  assert.equal(sim.hand[0].length, 2, "not during the break");
  sim.ph = 2; sim.w = 4; sim.sp = 1e6; sim.hs = 1;
  const near = enemyAt(sim, cell, 50), far = enemyAt(sim, cell + 6, 50);
  act(sim, 0, "m", 0, cell);
  assert.equal(near.dead, true); assert.equal(far.dead, false);
  assert.equal(sim.gold[0], 500 - SPELLS[SP.fire].cost);
  assert.deepEqual(sim.hand[0], [SP.heal]);
  sim.step(STEP);
  assert.equal(sim.kills[0], 1, "the spell's kill pays like a tower's");
  act(sim, 0, "m", 0, -1);
  assert.deepEqual(sim.hand[0], [SP.heal], "full lives: nothing to heal, the card stays");
  sim.l = START_LIVES - 5;
  act(sim, 0, "m", 0, -1);
  assert.equal(sim.l, START_LIVES - 2);
});

test("a hand holds three spells; a fourth pushes the oldest out", () => {
  const sim = table(1);
  for (let k = 0; k < HAND_MAX + 1; k++) { sim.offer[0] = [SPELL_BASE + k, 0, 1]; act(sim, 0, "k", 0); }
  assert.deepEqual(sim.hand[0], [1, 2, 3]);
});

test("cards survive a keyframe", () => {
  const sim = table(2);
  sim.pv[1] = 0b1010; sim.hand[0] = [SP.surge, SP.rush]; sim.offer[1] = [1, 9, 12]; sim.gr[0] = 3.5;
  sim.gold.fill(1000); act(sim, 0, "b", 5 * COLS + 4, 0);
  sim.towers.get(5 * COLS + 4).bt = 2;
  const copy = decodeKeyframe(encodeKeyframe(sim, { e: 1, seq: 0, build: "t" })).sim;
  assert.equal(copy.stateHash(), sim.stateHash());
  assert.deepEqual([copy.pv, copy.hand, copy.offer, copy.gr], [sim.pv, sim.hand, sim.offer, sim.gr]);
});

test("Єдність gives synergy between your own towers of different types", async () => {
  const { synergyAt } = await import("../../src/sim/rules.js");
  const sim = table(1), a = 5 * COLS + 4, b = 5 * COLS + 5, c = 5 * COLS + 6;
  sim.gold[0] = 1000;
  act(sim, 0, "b", a, 0); act(sim, 0, "b", b, 2); act(sim, 0, "b", c, 0);
  assert.equal(sim.syn.get(b), 0, "alone, no synergy without the card");
  sim.offer[0] = [P.unity, SPELL_BASE, SPELL_BASE + 1];
  act(sim, 0, "k", 0);
  assert.equal(sim.syn.get(b), 1, "frost next to archers: one other type");
  assert.equal(sim.syn.get(a), 1);
  act(sim, 0, "b", 6 * COLS + 5, 1);
  assert.equal(sim.syn.get(b), 2, "archers and a cannon around the frost");
  assert.equal(synergyAt(sim.towers, sim.towers.get(a)), 0, "without the card nothing counts");
});
