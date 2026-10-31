import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../../src/sim/sim.js";
import { STEP } from "../../src/sim/rules.js";
import { SPELL_BASE, P, SP } from "../../src/sim/cards.js";
import { actionEvent, GameWatch } from "../../src/analytics/events.js";

function table(n) { const s = new Sim(); s.assignSeats(Array.from({ length: n }, (_, i) => "p" + i)); return s; }
let seq = 0;
const act = (sim, seat, ...a) => sim.apply(seat, [++seq, ...a]);
// the fields of the view (net/view.js) that the statistics read
const view = s => ({ ph: s.ph, w: s.w, l: s.l, seats: s.seats, pv: s.pv, casts: s.casts, built: s.built, offer: s.offer, hand: s.hand, tmap: s.towers });
function stepUntil(sim, done) {
  for (let t = 0; t < 30 * 60 * 30 && !done(); t++) {
    if (sim.ph === 1) sim.seats.forEach((p, s) => { if (p) act(sim, s, "r", 1); });
    sim.step(STEP);
  }
  assert.ok(done(), "the game got there");
}

test("our actions become events with tower and card names, before the host applies them", () => {
  const sim = table(1);
  sim.gold[0] = 2000;
  assert.deepEqual(actionEvent(view(sim), 0, "b", 104, 1), ["tower_build", { tower: "Гармата", wave: 0 }]);
  act(sim, 0, "b", 104, 1);
  assert.deepEqual(actionEvent(view(sim), 0, "u", 104), ["tower_upgrade", { tower: "Гармата", level: 2, wave: 0 }]);
  act(sim, 0, "u", 104);
  // in the break a fresh tower is undone for its full price
  assert.deepEqual(actionEvent(view(sim), 0, "s", 104), ["tower_sell", { tower: "Гармата", level: 2, undo: 1, wave: 0 }]);
  sim.towers.get(104).fr = 0;
  assert.equal(actionEvent(view(sim), 0, "s", 104)[1].undo, 0);
  act(sim, 0, "u", 104); act(sim, 0, "u", 104);
  assert.equal(actionEvent(view(sim), 0, "u", 104), null, "no level above 3");
  assert.equal(actionEvent(view(sim), 0, "u", 105), null, "no tower there");

  sim.offer[0] = [P.unity, SPELL_BASE + SP.storm, P.archer];
  assert.deepEqual(actionEvent(view(sim), 0, "k", 1), ["card_pick", { card: "Хуртовина", kind: "spell", wave: 0, offered: "Єдність, Хуртовина, Дешеві стріли" }]);
  assert.equal(actionEvent(view(sim), 0, "k", 0)[1].kind, "passive");
  assert.equal(actionEvent(view(sim), 0, "k", 5), null);
  sim.hand[0] = [SP.fire];
  assert.deepEqual(actionEvent(view(sim), 0, "m", 0, 104), ["spell_cast", { spell: "Вогняна куля", wave: 0 }]);
  assert.equal(actionEvent(view(sim), 0, "m", 2), null);

  assert.deepEqual(actionEvent(view(sim), 0, "p", 1), ["feature_use", { feature: "pause", wave: 0 }]);
  assert.equal(actionEvent(view(sim), 0, "p", 0), null, "turning it off is not counted");
  assert.equal(actionEvent(view(sim), 0, "x", 1)[1].feature, "speed_x2");
  assert.equal(actionEvent(view(sim), 0, "f", 1)[1].feature, "finish_wave");
  assert.equal(actionEvent(view(sim), 0, "g", 0)[1].feature, "gift");
  assert.equal(actionEvent(view(sim), 0, "n")[1].feature, "new_game");
  assert.equal(actionEvent(view(sim), 0, "r", 1), null);
  assert.equal(actionEvent(view(sim), -1, "b", 104, 0), null, "spectators send nothing");
});

test("a watched game reports joining, start, host takeover and the end, once each", () => {
  let resyncs = 3;
  const w = new GameWatch({ link: () => "direct", resyncs: () => resyncs });
  const sim = table(2);
  const look = (o = {}) => w.observe({ v: view(sim), seat: 0, now: 0, joined: true, via: "invite", host: false, ...o }).map(e => e[0]);

  assert.deepEqual(w.observe({ v: view(sim), seat: -1, now: 0, joined: false }), []);
  assert.deepEqual(w.observe({ v: view(sim), seat: 0, now: 0, joined: true, via: "invite" }), [["table_join", { via: "invite" }]]);
  assert.deepEqual(look(), []);
  stepUntil(sim, () => sim.w === 1);
  const start = w.observe({ v: view(sim), seat: 0, now: 1000, joined: true, host: false });
  assert.deepEqual(start, [["game_start", { players: 2, role: "guest", late: 0, wave: 1 }]]);
  assert.deepEqual(look({ host: true }), ["host_takeover"]);
  assert.deepEqual(look({ host: true }), []);
  for (let i = 0; i < 90; i++) w.frame(1000 / 30);
  w.frame(5000); // a hidden-tab gap is ignored

  stepUntil(sim, () => sim.ph >= 3); // no towers: the crystal falls
  resyncs = 5;
  const end = w.observe({ v: view(sim), seat: 0, now: 91000, joined: true, host: true });
  assert.equal(end.length, 1);
  assert.equal(end[0][0], "game_end");
  assert.deepEqual(end[0][1], {
    result: "lose", wave: sim.w, players: 2, role: "host", late: 0, minutes: 1.5, lives: 0,
    passives: 0, spells_cast: 0, towers_built: 0, fps: 30, link: "direct", resyncs: 2,
  });
  assert.deepEqual(look({ host: true }), [], "the end is reported once");
  assert.equal(w.quit(99000), null, "a finished game is not a quit");

  // the same table plays again
  act(sim, 0, "n");
  assert.equal(sim.w, 0);
  assert.deepEqual(look(), []);
  stepUntil(sim, () => sim.w === 2);
  assert.deepEqual(look(), ["game_start"]);
  assert.deepEqual(w.quit(60000), ["game_quit", { wave: 2, players: 2, role: "guest", late: 0, minutes: 1 }]);
  assert.equal(w.quit(61000), null);
});

test("sitting down in the middle of a game marks it late; another build at the table is reported once", () => {
  const sim = table(3);
  sim.l = 1000; // no towers: keep the crystal standing until wave 3
  stepUntil(sim, () => sim.w === 3);
  const w = new GameWatch();
  const o = { v: view(sim), seat: 2, now: 0, joined: true, via: "own", host: false };
  assert.deepEqual(w.observe(o), [["table_join", { via: "own" }], ["game_start", { players: 3, role: "guest", late: 1, wave: 3 }]]);
  assert.deepEqual(w.observe({ ...o, v: null, seat: -1, blocked: true, newer: true }), [["version_mismatch", { mine: "newer" }]]);
  assert.deepEqual(w.observe({ ...o, v: null, seat: -1, blocked: true, newer: true }), []);
});
