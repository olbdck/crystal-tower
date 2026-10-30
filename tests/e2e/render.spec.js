import { test, expect } from "@playwright/test";
import { openGame, sitDown } from "./helpers.js";

test("the 3D table renders without errors", async ({ browser }) => {
  const a = await openGame(browser, { render: true });
  await sitDown(a.page, "Олег");
  await a.page.waitForFunction(() => { const r = window.__kv.renderer(); return r && r.info.render.calls > 10; }, null, { timeout: 30_000 });
  await expect(a.page.locator("#fallback")).toBeHidden();
  await expect(a.page.locator("#hand .card")).toHaveCount(7); // 4 shooting and 3 support towers
  expect(a.errors).toEqual([]);
  await a.context.close();
});

test("on a phone the table is in front of the fog, not lost in it", async ({ browser }) => {
  const a = await openGame(browser, { render: true, viewport: { width: 390, height: 844 } });
  await sitDown(a.page, "Олег");
  await a.page.waitForFunction(() => { const r = window.__kv.renderer(); return r && r.info.render.calls > 10; }, null, { timeout: 30_000 });
  await a.page.waitForTimeout(800); // the camera refits once the layout settles
  const { dist, near } = await a.page.evaluate(() => {
    const k = window.__kv, cam = k.camera(), fog = k.scene().fog;
    const dx = cam.position.x - 10, dy = cam.position.y, dz = cam.position.z - 6;
    return { dist: Math.sqrt(dx * dx + dy * dy + dz * dz), near: fog.near };
  });
  expect(near).toBeGreaterThan(dist - 8); // the board (within ~11 units of its centre) is at most lightly fogged
  expect(a.errors).toEqual([]);
  await a.context.close();
});

test("every sound plays without errors once the page was clicked", async ({ browser }) => {
  const a = await openGame(browser);
  const logs = [];
  a.page.on("console", m => { if (m.type() === "error") logs.push(m.text()); });
  await sitDown(a.page, "Олег");
  await a.page.mouse.click(5, 400);
  await a.page.waitForTimeout(300); // the audio context starts
  const played = await a.page.evaluate(async () => {
    const k = window.__kv, out = [];
    for (const n of k.SOUND_NAMES()) { if (k.playSound(n, { pan: 0.3 })) out.push(n); await new Promise(r => setTimeout(r, 30)); }
    return out;
  });
  expect(played.length).toBeGreaterThan(20);
  await a.page.waitForTimeout(500);
  expect(logs.filter(l => l.startsWith("sound"))).toEqual([]);
  expect(a.errors).toEqual([]);
  await a.context.close();
});

test("winning and losing look different: confetti and a crystal, or a skull on a dark table", async ({ browser }) => {
  const a = await openGame(browser);
  await sitDown(a.page, "Олег");
  // one player alone: the test sets the end of the game directly on the host's Sim
  await a.page.evaluate(() => { window.__kv.S.sim.ph = 4; });
  await expect(a.page.locator("#endOverlay")).toHaveClass(/win/);
  await expect(a.page.locator("#endArt .art-win")).toBeVisible();
  await a.page.waitForFunction(() => { const c = document.getElementById("confetti"); return c.width > 0 && c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some(x => x > 0); });
  await a.page.click("#newGameBtn");
  await expect(a.page.locator("#endOverlay")).toBeHidden();
  await a.page.evaluate(() => { window.__kv.S.sim.ph = 3; });
  await expect(a.page.locator("#endOverlay")).toHaveClass(/lose/);
  await expect(a.page.locator("#endArt .art-lose")).toBeVisible();
  await expect(a.page.locator("#endTitle")).toHaveText("Кристал розбито");
  expect(a.errors).toEqual([]);
  await a.context.close();
});
