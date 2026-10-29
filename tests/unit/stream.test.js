import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../../src/sim/sim.js";
import { BLOCKED, TOWERS, STEP } from "../../src/sim/rules.js";
import { Reader, Writer, bundle, cleanAction, decodeBatch, decodeKeyframe, unbundle } from "../../src/net/codec.js";
import { Follower, Recorder } from "../../src/net/stream.js";
import { botCards } from "../support/bot.js";

const FREE = [...BLOCKED.keys()].filter(c => !BLOCKED[c]);
const STEP_MS = STEP * 1000;

test("numbers survive the binary format", () => {
  const w = new Writer(4), xs = [0, 1, 127, 128, 300, 2 ** 31, 17300000000123, 2 ** 53 - 1];
  for (const x of xs) w.uv(x);
  for (const x of [-1, 0, 5, -300]) w.sv(x);
  w.f64(Math.PI); w.str("Олег");
  const r = new Reader(w.bytes());
  for (const x of xs) assert.equal(r.uv(), x);
  for (const x of [-1, 0, 5, -300]) assert.equal(r.sv(), x);
  assert.equal(r.f64(), Math.PI);
  assert.equal(r.str(), "Олег");
  assert.ok(r.done);
  assert.throws(() => r.u8(), RangeError);
});

test("malformed actions become harmless no-ops", () => {
  assert.deepEqual(cleanAction([5, "b", 104, 0]), [5, "b", 104, 0]);
  assert.deepEqual(cleanAction([6, "b", 1.5, 0]), [6, ""]);
  assert.deepEqual(cleanAction([7, "<script>", 1]), [7, ""]);
  assert.equal(cleanAction(["x", "b"]), null);
  assert.deepEqual(bundle([Uint8Array.of(2, 1)]), Uint8Array.of(2, 1));
  assert.deepEqual(unbundle(bundle([Uint8Array.of(2, 1), Uint8Array.of(1, 9, 9)])), [Uint8Array.of(2, 1), Uint8Array.of(1, 9, 9)]);
});

/**
 * A host with bot players. Each call to run() plays some ticks: bots build, upgrade and get ready,
 * players come and go, and every batch goes to the returned list.
 */
function botHost(players) {
  const sim = new Sim(), rec = new Recorder(sim), seqs = new Map(), out = [];
  let roster = players.slice();
  rec.roster(roster); rec.batch(); // the keyframe each test starts from includes the roster
  const act = (label, ...a) => { const s = (seqs.get(label) || 0) + 1; seqs.set(label, s); rec.act(label, [s, ...a]); };
  function bots() {
    roster.forEach(label => {
      const seat = sim.seats.indexOf(label);
      if (seat < 0) return;
      const ty = (sim.t / 90 + seat) % TOWERS.length | 0, cell = FREE[(sim.t * 7 + seat * 31) % FREE.length];
      if (sim.gold[seat] >= TOWERS[ty].cost && !sim.towers.has(cell)) act(label, "b", cell, ty);
      const mine = [...sim.towers.values()].find(t => t.o === seat && t.lv < 3);
      if (mine && sim.gold[seat] > 200) act(label, "u", mine.c);
      botCards(sim, seat, (...a) => act(label, ...a));
      if (sim.ph === 1) act(label, "r", 1);
    });
  }
  return {
    sim, rec, out,
    run(ticks, { leave, join } = {}) {
      if (leave) { roster = roster.filter(l => l !== leave); rec.roster(roster); }
      if (join) { roster = roster.concat(join); rec.roster(roster); }
      for (let i = 0; i < ticks; i++) {
        if (i % 45 === 0) bots();
        rec.step();
        if (i % 2 === 1) { const b = rec.batch(); if (b) out.push(b); }
      }
      const b = rec.batch(); if (b) out.push(b);
    },
  };
}

test("a keyframe restores the game exactly", () => {
  const h = botHost(["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"]);
  h.run(30 * 60);
  assert.ok(h.sim.enemies.length > 0 || h.sim.w > 1, "the game is under way");
  const kf = decodeKeyframe(h.rec.keyframe("test"));
  assert.equal(kf.build, "test");
  assert.equal(kf.sim.stateHash(), h.sim.stateHash());
  assert.deepEqual([...kf.sim.towers.keys()], [...h.sim.towers.keys()], "towers keep their order, so they fire in the same order");
  // both copies keep going the same way
  for (let i = 0; i < 30 * 30; i++) { h.sim.step(STEP); kf.sim.step(STEP); }
  assert.equal(kf.sim.stateHash(), h.sim.stateHash());
});

/** Feeds batches to a follower at real-time pace, optionally shuffled a little, and plays them. */
function replay(f, batches, { shuffle = 0, start = 0 } = {}) {
  let now = start;
  // the bot host sends a batch every two ticks
  const queue = batches.map((b, i) => ({ b, at: start + i * 2 * STEP_MS + Math.floor(Math.random() * shuffle) })).sort((x, y) => x.at - y.at);
  for (const { b, at } of queue) {
    while (now < at) { now += 16; f.advance(now); }
    f.push(decodeBatch(b), now);
  }
  for (let i = 0; i < 20 && f.lag > 0; i++) { now += 50; f.advance(now); }
  return now;
}

test("a copy fed with the stream stays identical to the host through a whole game", () => {
  const players = ["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc", "dddddddddd"];
  const h = botHost(players);
  const f = new Follower(), fx = [];
  f.onFx = x => fx.push(x);
  f.load(decodeKeyframe(h.rec.keyframe("t")), 0);
  let now = 0;
  for (let round = 0; round < 12 && h.sim.ph <= 2; round++) {
    h.out.length = 0;
    h.run(30 * 60, round === 3 ? { leave: "bbbbbbbbbb" } : round === 5 ? { join: "eeeeeeeeee" } : {});
    now = replay(f, h.out, { start: now });
    f.catchUp();
    assert.equal(f.sim.t, h.sim.t, "the copy is at the host's tick");
    assert.equal(f.sim.stateHash(), h.sim.stateHash(), `round ${round}: same state`);
  }
  assert.equal(f.stats.resyncs, 0);
  assert.ok(f.stats.hashChecks > 100, "checksums were compared along the way");
  assert.ok(fx.length > 1000, "the copy plays the shots and deaths itself");
  assert.ok(h.sim.w >= 5, "several waves were played");
});

test("batches that arrive out of order are put back in order", () => {
  const h = botHost(["aaaaaaaaaa", "bbbbbbbbbb"]);
  const f = new Follower();
  f.load(decodeKeyframe(h.rec.keyframe("t")), 0);
  h.run(30 * 40);
  replay(f, h.out, { shuffle: 120 });
  f.catchUp();
  assert.equal(f.sim.stateHash(), h.sim.stateHash());
  assert.equal(f.stats.resyncs, 0);
});

test("a missing batch asks for a keyframe, and the keyframe gets the copy back in step", () => {
  const h = botHost(["aaaaaaaaaa", "bbbbbbbbbb"]);
  const f = new Follower();
  f.load(decodeKeyframe(h.rec.keyframe("t")), 0);
  h.run(30 * 20);
  const lost = h.out.splice(10, 1);
  assert.equal(lost.length, 1);
  let now = replay(f, h.out);
  assert.ok(f.needsKeyframe, "the gap is noticed");
  h.out.length = 0;
  h.run(30 * 5);
  const kf = decodeKeyframe(h.rec.keyframe("t"));
  f.load(kf, now, true);
  h.out.length = 0;
  h.run(30 * 20);
  now = replay(f, h.out, { start: now });
  f.catchUp();
  assert.equal(f.needsKeyframe, false);
  assert.equal(f.sim.stateHash(), h.sim.stateHash());
});

test("a copy that drifts from the host notices it at the next checksum", () => {
  const h = botHost(["aaaaaaaaaa"]);
  const f = new Follower();
  f.load(decodeKeyframe(h.rec.keyframe("t")), 0);
  f.sim.gold[0] += 1; // something went wrong on this side
  h.run(30 * 3);
  replay(f, h.out);
  assert.ok(f.needsKeyframe);
  assert.equal(f.stats.resyncs, 1);
});

test("playback runs at real-time pace a few ticks behind, and catches up after a pause", () => {
  const h = botHost(["aaaaaaaaaa"]);
  const f = new Follower();
  f.load(decodeKeyframe(h.rec.keyframe("t")), 0);
  h.run(30);
  // a second of game arrives at once: the copy plays it a bit faster than real time, not instantly
  for (const b of h.out) f.push(decodeBatch(b), 0);
  let now = 0;
  for (let i = 0; i < 3; i++) { now += 16; f.advance(now); }
  assert.ok(f.lag > 20, `a burst is not played in one go (lag ${f.lag})`);
  for (let i = 0; i < 60; i++) { now += 16; f.advance(now); }
  assert.ok(f.lag <= f.buffer + 4, `caught up to the buffer (lag ${f.lag})`);
  // between ticks the view moves on smoothly
  const a0 = f.alpha(now), a1 = f.alpha(now + STEP_MS / 2);
  assert.ok(a1 >= a0 && a1 <= 1);
  // ten seconds behind (a tab in the background): jump instead of fast-forwarding
  h.out.length = 0;
  h.run(30 * 10);
  for (const b of h.out) f.push(decodeBatch(b), now);
  f.advance(now + 16);
  assert.ok(f.lag <= f.buffer, `skipped ahead (lag ${f.lag})`);
});

test("the stream is small: under 1 KB/s even in late waves with five players", () => {
  const h = botHost(["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc", "dddddddddd", "eeeeeeeeee"]);
  let bytes = 0, ticks = 0;
  while (h.sim.ph <= 2 && h.sim.w < 15) {
    h.out.length = 0;
    const t0 = h.sim.t;
    h.run(30 * 30);
    ticks += h.sim.t - t0;
    for (const b of h.out) bytes += b.length;
  }
  const perSec = bytes / (ticks / 30), kf = h.rec.keyframe("t").length;
  assert.ok(perSec < 1024, `stream ${perSec.toFixed(0)} B/s`);
  assert.ok(kf < 6000, `keyframe ${kf} B`);
});
