import { test } from "node:test";
import assert from "node:assert/strict";
import { playGame } from "../support/bot.js";

// Guards the difficulty curve. If a rules change moves these on purpose, update the ranges.
test("a single bot falls in the middle-late waves", () => {
  const r = playGame(1);
  assert.ok(r.wave >= 12 && r.wave <= 18, `solo bot reached wave ${r.wave}`);
});

test("a team of bots can win but not without effort", () => {
  for (const n of [2, 5]) {
    const r = playGame(n);
    assert.ok(r.wave >= 17, `${n} bots reached wave ${r.wave}`);
    assert.ok(!r.won || r.lives < 20, `${n} bots won without losing a life`);
  }
});

test("building only archers is not enough", () => {
  const r = playGame(3, { archersOnly: true });
  assert.equal(r.won, false);
});
