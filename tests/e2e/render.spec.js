import { test, expect } from "@playwright/test";
import { openGame, sitDown } from "./helpers.js";

test("the 3D table renders without errors", async ({ browser }) => {
  const a = await openGame(browser, { render: true });
  await sitDown(a.page, "Олег");
  await a.page.waitForFunction(() => { const r = window.__kv.renderer(); return r && r.info.render.calls > 10; }, null, { timeout: 30_000 });
  await expect(a.page.locator("#fallback")).toBeHidden();
  await expect(a.page.locator(".card")).toHaveCount(4);
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
