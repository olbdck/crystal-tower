import { test } from "node:test";
import assert from "node:assert/strict";
import { playGame } from "../support/bot.js";

// Guards the difficulty curve over several seeded bot games (one game alone swings by several waves).
// If a rules change moves these on purpose, check `npm run balance` and update the ranges.
const games = (n, opts = {}) => Array.from({ length: 8 }, (_, i) => playGame(n, { ...opts, seed: i + 1 }));
const avgWave = rs => rs.reduce((a, r) => a + r.wave, 0) / rs.length;

test("a single bot usually falls in the middle-late waves", () => {
  const rs = games(1), w = avgWave(rs);
  assert.ok(w >= 12 && w <= 17.5, `solo bots reached wave ${w.toFixed(1)} on average`);
  assert.ok(rs.filter(r => r.won).length <= 1, "solo bots almost never win");
});

test("bot teams get far, but winning is not guaranteed", () => {
  for (const n of [2, 5]) {
    const rs = games(n), w = avgWave(rs);
    assert.ok(w >= 16, `${n} bots reached wave ${w.toFixed(1)} on average`);
    assert.ok(rs.some(r => !r.won), `${n} bots won every game`);
    const wins = rs.filter(r => r.won);
    if (wins.length) assert.ok(wins.reduce((a, r) => a + r.lives, 0) / wins.length < 18, `${n} bots win without losing lives`);
  }
});

test("building only archers is not enough", () => {
  for (const seed of [1, 2, 3]) assert.equal(playGame(3, { archersOnly: true, seed }).won, false);
});
