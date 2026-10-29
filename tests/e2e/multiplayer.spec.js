import { test, expect } from "@playwright/test";
import { openGame, sitDown, view, waitView } from "./helpers.js";

test("a friend joins through the invite link and sees the same board", async ({ browser }) => {
  const a = await openGame(browser);
  await sitDown(a.page, "Олег");
  await waitView(a.page, v => v.host && v.mySeat === 0);
  const link = await a.page.evaluate(() => window.__kv.inviteLink());
  const hash = new URL(link).hash;
  expect(hash).toMatch(/^#stil-[a-z0-9]+$/);

  const b = await openGame(browser, { path: "/" + hash });
  await expect(b.page.locator("#joinStatus")).toContainText("Вас запросили");
  await sitDown(b.page, "Марко");
  await waitView(a.page, v => v.seats.filter(Boolean).length === 2);

  await b.page.evaluate(() => window.__kv.act("b", 5 * 20 + 4, 0));
  await waitView(a.page, v => v.towers.some(t => t[0] === 104 && t[1] === 1));
  await waitView(b.page, v => v.towers.some(t => t[0] === 104 && t[1] === 1));
  expect((await view(b.page)).gold[1]).toBe(110);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await a.context.close(); await b.context.close();
});

test("players can join by typing the table code", async ({ browser }) => {
  const a = await openGame(browser);
  await sitDown(a.page, "Олег");
  const table = await a.page.evaluate(() => window.__kv.S.tableName);
  const c = await openGame(browser);
  await c.page.fill("#codeIn", table.slice(5).toUpperCase());
  await c.page.click("#codeGo");
  await c.page.waitForFunction(t => window.__kv.S.tableName === t && window.__kv.S.roomReady, table);
  await sitDown(c.page, "Ірина");
  await waitView(a.page, v => v.seats.filter(Boolean).length === 2);
  await a.context.close(); await c.context.close();
});

test("the game continues when the host leaves", async ({ browser }) => {
  const a = await openGame(browser);
  await sitDown(a.page, "Олег");
  await waitView(a.page, v => v.host);
  const hash = new URL(await a.page.evaluate(() => window.__kv.inviteLink())).hash;
  const b = await openGame(browser, { path: "/" + hash });
  await sitDown(b.page, "Марко");
  await waitView(a.page, v => v.seats.filter(Boolean).length === 2);
  await a.page.evaluate(() => window.__kv.act("b", 3 * 20 + 12, 1));
  await waitView(b.page, v => v.towers.length === 1);

  await a.context.close();
  await waitView(b.page, v => v.host, null, 15_000);
  const vb = await view(b.page);
  expect(vb.towers).toEqual([[72, 0, 1]]);
  await b.page.evaluate(() => window.__kv.act("b", 5 * 20 + 4, 0));
  await waitView(b.page, v => v.towers.length === 2);
  await b.context.close();
});
