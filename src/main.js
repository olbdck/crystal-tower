// Entry point: wires the modules together and runs the frame loop.
import { TEST } from "./config.js";
import { S } from "./state.js";
import { initNet, fxPending, setHostFxHandler, act, inviteLink } from "./net/session.js";
import { getView } from "./net/view.js";
import { SEAT_CSS } from "./render/gfx.js";
import { initThree, render3D, renderer, resizeAll, fitCamera, measureSafe, lastSafe, trackPerf, stage } from "./render/scene.js";
import { spawnFx } from "./render/fx.js";
import { $ } from "./ui/dom.js";
import { updateUI, invalidateParty } from "./ui/hud.js";
import { initInput } from "./ui/input.js";
import { initJoin } from "./ui/join.js";
import { initModals } from "./ui/modals.js";

let lastUi = 0, lastFitCheck = 0, lastLoopTime = performance.now();

function frame(now) {
  const v = getView(now);
  trackPerf(now, now - lastLoopTime); lastLoopTime = now;
  if (!S.isHost && fxPending.length) {
    // effects from snapshots play once the view reaches their tick
    const rt = v ? v.rt : 0;
    let keep = 0;
    for (const p of fxPending) { if (p.at <= rt) { if (renderer) spawnFx(p.f); } else fxPending[keep++] = p; }
    fxPending.length = keep;
  }
  if (renderer) render3D(v, now);
  if (S.uiDirty || now - lastUi > 150) { updateUI(v, now); lastUi = now; S.uiDirty = false; }
  if (renderer && now - lastFitCheck > 600) {
    lastFitCheck = now;
    if (JSON.stringify(measureSafe()) !== lastSafe) fitCamera();
  }
  requestAnimationFrame(frame);
}

function boot() {
  for (let i = 0; i < SEAT_CSS.length; i++) document.documentElement.style.setProperty("--p" + i, SEAT_CSS[i]);
  initModals();
  initJoin();
  initInput();
  setHostFxHandler(f => { if (renderer) spawnFx(f); });
  initNet();
  if (!TEST.noRender && !initThree()) $("fallback").hidden = false;
  new ResizeObserver(resizeAll).observe(stage);
  resizeAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { S.uiDirty = true; invalidateParty(); setTimeout(fitCamera, 50); });
  requestAnimationFrame(frame);
}

boot();

// End-to-end tests drive the game through this handle; it exists only when a test set window.KV_TEST.
if (TEST && Object.keys(TEST).length) window.__kv = { S, act, getView, inviteLink, renderer: () => renderer };
