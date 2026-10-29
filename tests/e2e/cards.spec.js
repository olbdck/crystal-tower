import { test, expect } from "@playwright/test";
import { openGame, sitDown, waitView } from "./helpers.js";

// One player alone: the test hands out cards directly on the host's Sim (fine with nobody to stream to).
test("a card pick opens by itself, and spells are cast from the hand during a wave", async ({ browser }) => {
  const a = await openGame(browser);
  await sitDown(a.page, "Олег");
  await waitView(a.page, v => v.host);
  const P = { temper: 7 }, SP = { storm: 1 }, base = 9; // codes from src/sim/cards.js
  await a.page.evaluate(([p, s]) => { window.__kv.S.sim.offer[0] = [p, s, 8]; }, [P.temper, base + SP.storm]);
  await expect(a.page.locator("#cardOverlay")).toBeVisible();
  await expect(a.page.locator("#readyLbl")).toHaveText("Карта");
  await a.page.locator("#offerCards .card").first().click();
  await expect(a.page.locator("#cardOverlay")).toBeHidden();
  await a.page.waitForFunction(() => window.__kv.S.sim.pv[0] === 1 << 7);
  await expect(a.page.locator(".hero.me .relic")).toHaveCount(1);

  await a.page.evaluate(s => { const sim = window.__kv.S.sim; sim.hand[0] = [s]; sim.gold[0] = 500; window.__kv.act("b", 104, 0); window.__kv.act("r", 1); }, SP.storm);
  await waitView(a.page, v => v.ph === 2);
  await a.page.waitForFunction(() => window.__kv.S.sim.enemies.length > 0);
  await expect(a.page.locator("#spells .card")).toHaveCount(1);
  await a.page.keyboard.press("Digit5");
  await a.page.waitForFunction(() => window.__kv.S.sim.hand[0].length === 0);
  const slowed = await a.page.evaluate(() => window.__kv.S.sim.enemies.every(e => e.sl > 3));
  expect(slowed).toBe(true);
  await expect(a.page.locator("#spells")).toBeHidden();
  expect(a.errors).toEqual([]);
  await a.context.close();
});
