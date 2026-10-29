// Helpers for multiplayer tests: every page talks to the local broker and skips 3D unless asked.
export const BROKER = "ws://127.0.0.1:8888";

export async function openGame(browser, { path = "/", render = false, build = null, p2p = true } = {}) {
  const context = await browser.newContext();
  await context.addInitScript(([broker, render, build, p2p]) => {
    window.KV_TEST = { noRender: !render, ...(build ? { build } : {}) };
    window.KV_NET_CONFIG = { brokers: [{ id: "e", url: broker }, { id: "h", url: broker }], stun: [], openRelay: null, p2p };
  }, [BROKER, render, build, p2p]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(path);
  await page.waitForFunction(() => window.__kv && window.__kv.S.roomReady === true, null, { timeout: 30_000, polling: 100 });
  return { page, context, errors };
}

export async function sitDown(page, name) {
  await page.fill("#nick", name);
  await page.click("#joinBtn");
  await page.waitForFunction(() => window.__kv.S.joined === true);
}

/** The game view as plain data: seats taken, towers, wave, whether this tab hosts. */
export function view(page) {
  return page.evaluate(() => {
    const k = window.__kv, v = k.getView(performance.now());
    return v && {
      seats: v.seats.map(Boolean), mySeat: v.seats.indexOf(k.S.myPeer), gold: v.gold.slice(),
      towers: v.towers.map(t => [t.c, t.o, t.lv]), w: v.w, ph: v.ph, host: k.S.isHost, table: k.S.tableName,
    };
  });
}

export async function waitView(page, predicate, arg, timeout = 20_000) {
  await page.waitForFunction(([src, arg]) => {
    const k = window.__kv, v = k.getView(performance.now());
    if (!v) return false;
    const data = { seats: v.seats.map(Boolean), mySeat: v.seats.indexOf(k.S.myPeer), gold: v.gold.slice(), towers: v.towers.map(t => [t.c, t.o, t.lv]), w: v.w, ph: v.ph, host: k.S.isHost };
    return new Function("v", "arg", "return (" + src + ")(v, arg)")(data, arg);
  }, [predicate.toString(), arg], { timeout, polling: 100 });
}
