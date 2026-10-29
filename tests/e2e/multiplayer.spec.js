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

test("a player who reloads gets their seat, gold and towers back", async ({ browser }) => {
  const a = await openGame(browser);
  await sitDown(a.page, "Олег");
  await waitView(a.page, v => v.host);
  const hash = new URL(await a.page.evaluate(() => window.__kv.inviteLink())).hash;
  const b = await openGame(browser, { path: "/" + hash });
  await sitDown(b.page, "Марко");
  await waitView(a.page, v => v.seats.filter(Boolean).length === 2);
  await b.page.evaluate(() => window.__kv.act("b", 5 * 20 + 4, 0));
  await waitView(a.page, v => v.towers.length === 1);
  const before = await view(a.page);

  await b.page.reload();
  await b.page.waitForFunction(() => window.__kv && window.__kv.S.joined === true, null, { timeout: 30_000 });
  await waitView(b.page, v => v.mySeat === 1);
  const after = await view(a.page);
  expect(after.seats).toEqual(before.seats);
  expect(after.gold[1]).toBe(before.gold[1]);
  expect(after.towers).toEqual([[104, 1, 1]]);
  await a.context.close(); await b.context.close();
});

test("the next player takes over within a couple of seconds when the host closes the tab", async ({ browser }) => {
  const a = await openGame(browser);
  await sitDown(a.page, "Олег");
  await waitView(a.page, v => v.host);
  const hash = new URL(await a.page.evaluate(() => window.__kv.inviteLink())).hash;
  const b = await openGame(browser, { path: "/" + hash });
  await sitDown(b.page, "Марко");
  await b.page.waitForFunction(() => Object.values(window.__kv.S.room.links()).some(l => l.kind === "direct"), null, { timeout: 30_000 });
  await a.page.close({ runBeforeUnload: true });
  await waitView(b.page, v => v.host, null, 10_000);
  // measured inside B: from noticing the closed channel to running the game
  const d = await b.page.evaluate(() => window.__kv.hostDebug());
  expect(d.hostSince - d.hostLinkLostAt).toBeLessThan(1600);
  await a.context.close();
  await b.context.close();
});

test("a player on another build cannot sit down and is told why", async ({ browser }) => {
  const a = await openGame(browser);
  await sitDown(a.page, "Олег");
  await waitView(a.page, v => v.host);
  const hash = new URL(await a.page.evaluate(() => window.__kv.inviteLink())).hash;
  const newer = await openGame(browser, { path: "/" + hash, build: { id: "zzzzzzz", t: Date.now() + 1e9 } });
  await expect(newer.page.locator("#joinStatus")).toContainText("старішій версії");
  await expect(newer.page.locator("#joinBtn")).toHaveText("Відкрити свій стіл");
  const older = await openGame(browser, { path: "/" + hash, build: { id: "aaaaaaa", t: 1 } });
  await expect(older.page.locator("#joinStatus")).toContainText("застаріла");
  await expect(older.page.locator("#joinBtn")).toHaveText("Оновити сторінку");
  await a.page.waitForTimeout(1500);
  expect((await view(a.page)).seats.filter(Boolean).length).toBe(1);
  await a.context.close(); await newer.context.close(); await older.context.close();
});

test("a host that freezes without closing is replaced too", async ({ browser }) => {
  const a = await openGame(browser);
  await sitDown(a.page, "Олег");
  await waitView(a.page, v => v.host);
  const hash = new URL(await a.page.evaluate(() => window.__kv.inviteLink())).hash;
  const b = await openGame(browser, { path: "/" + hash });
  await sitDown(b.page, "Марко");
  await b.page.waitForFunction(() => Object.values(window.__kv.S.room.links()).some(l => l.kind === "direct"), null, { timeout: 30_000 });
  // stop the host's simulation as if its phone went to sleep, the connection stays up
  const stoppedAt = await b.page.evaluate(() => performance.now());
  await a.page.evaluate(() => { window.__kv.S.isHost = false; });
  await waitView(b.page, v => v.host, null, 10_000);
  const d = await b.page.evaluate(() => window.__kv.hostDebug());
  expect(d.hostSince - stoppedAt).toBeLessThan(3500);
  await waitView(a.page, v => !v.host && v.mySeat === 0);
  await a.context.close(); await b.context.close();
});
