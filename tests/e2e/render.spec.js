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
