// Entry point: wires the modules together and runs the frame loop.
import { TEST } from "./config.js";
import * as R from "./sim/rules.js";
import { S } from "./state.js";
import { initNet, pump, setFxHandler, act, inviteLink, hostDebug, joinedPeers } from "./net/session.js";
import { getView } from "./net/view.js";
import { SEAT_CSS } from "./render/gfx.js";
import { initThree, render3D, renderer, scene, camera, resizeAll, fitCamera, measureSafe, lastSafe, trackPerf, stage } from "./render/scene.js";
import { spawnFx, fxStats } from "./render/fx.js";
import { $ } from "./ui/dom.js";
import { updateUI, invalidateParty } from "./ui/hud.js";
import { initInput } from "./ui/input.js";
import { initJoin } from "./ui/join.js";
import { initModals } from "./ui/modals.js";
import { initCards } from "./ui/cards.js";
import { initPause } from "./ui/pause.js";

let lastUi = 0, lastFitCheck = 0, lastLoopTime = performance.now();

function frame(now) {
  pump(now); // replay the host's stream up to this frame
  const v = getView(now);
  trackPerf(now, now - lastLoopTime); lastLoopTime = now;
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
  initCards();
  initPause();
  setFxHandler(f => { if (renderer && !document.hidden) spawnFx(f); });
  initNet();
  if (!TEST.noRender && !initThree()) $("fallback").hidden = false;
  new ResizeObserver(resizeAll).observe(stage);
  resizeAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { S.uiDirty = true; invalidateParty(); setTimeout(fitCamera, 50); });
  requestAnimationFrame(frame);
}

boot();

// End-to-end tests drive the game through this handle; it exists only when a test set window.KV_TEST.
if (TEST && Object.keys(TEST).length) window.__kv = { S, act, getView, inviteLink, hostDebug, joinedPeers, renderer: () => renderer, scene: () => scene, camera: () => camera, rules: R, fxStats };
