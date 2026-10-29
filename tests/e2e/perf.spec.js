import { test } from "@playwright/test";
import { openGame, sitDown, waitView } from "./helpers.js";

// Rendering benchmark on a full board. Not part of the regular run: PERF=1 npx playwright test perf
test.skip(!process.env.PERF, "set PERF=1 to run the benchmark");

test("full board during a late wave", async ({ browser }) => {
  const a = await openGame(browser, { render: true });
  await a.page.setViewportSize({ width: 1280, height: 760 });
  await sitDown(a.page, "Bench");
  await waitView(a.page, v => v.host);
  await a.page.evaluate(() => {
    const { S, rules } = window.__kv, sim = S.sim;
    let k = 0;
    for (let c = 0; c < rules.COLS * rules.ROWS && sim.towers.size < 85; c++) {
      if (rules.BLOCKED[c]) continue;
      sim.towers.set(c, { c, ty: k % 4, lv: 1 + (k % 3), o: k % 5, cd: 0 }); k++;
    }
    sim.recomputeSyn(); sim.tv++;
    sim.w = 14; sim.startWave();
  });
  await a.page.waitForTimeout(9000);
  const r = await a.page.evaluate(() => new Promise(res => {
    const rd = window.__kv.renderer(), orig = rd.render.bind(rd);
    let n = 0, t = 0, calls = 0, tris = 0, frames = 0, worst = 0, last = performance.now();
    rd.render = (s, c) => { const t0 = performance.now(); orig(s, c); t += performance.now() - t0; n++; calls += rd.info.render.calls; tris += rd.info.render.triangles; };
    const tick = now => { frames++; worst = Math.max(worst, now - last); last = now; if (frames < 400) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    setTimeout(() => res({
      frames: n, msPerRender: +(t / n).toFixed(2), drawCalls: Math.round(calls / n), triangles: Math.round(tris / n),
      worstFrameMs: Math.round(worst), enemies: window.__kv.S.sim.enemies.length,
      geometries: rd.info.memory.geometries, programs: rd.info.programs.length, fx: window.__kv.fxStats(),
    }), 8000);
  }));
  console.log("PERF", JSON.stringify(r));
  await a.page.screenshot({ path: "test-results/perf-board.png" });
  await a.context.close();
});
