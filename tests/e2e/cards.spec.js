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
  await expect(a.page.locator("#hand .card.spell")).toHaveCount(1);
  await a.page.keyboard.press("Digit8"); // keys 1-7 are towers, 8, 9, 0 the spells
  await a.page.waitForFunction(() => window.__kv.S.sim.hand[0].length === 0);
  const slowed = await a.page.evaluate(() => window.__kv.S.sim.enemies.every(e => e.sl > 3));
  expect(slowed).toBe(true);
  await expect(a.page.locator("#hand .card.spell")).toHaveCount(0);

  // the same moments would go to the play statistics (tests never load Google Analytics)
  const events = await a.page.evaluate(() => window.__kv.events());
  const names = events.map(e => e.event);
  for (const n of ["table_join", "card_pick", "tower_build", "game_start", "spell_cast"]) expect(names).toContain(n);
  expect(events.find(e => e.event === "card_pick")).toMatchObject({ card: "Загартування", kind: "passive", offered: "Загартування, Хуртовина, Єдність" });
  expect(events.find(e => e.event === "game_start")).toMatchObject({ players: 1, role: "host", late: 0 });
  expect(events.find(e => e.event === "spell_cast")).toMatchObject({ spell: "Хуртовина", wave: 1 });
  expect(JSON.stringify(events)).not.toContain("Олег"); // never player names
  expect(await a.page.evaluate(() => typeof window.gtag)).toBe("undefined");
  expect(a.errors).toEqual([]);
  await a.context.close();
});
