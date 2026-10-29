// Answers about "me" in the current view, shared by the HUD, input handling and the renderer.
// They count actions we sent but the host has not confirmed yet, so the UI reacts at once.
import { COLS, ROWS, BLOCKED, MAX_TOWERS, TOWERS, GIFT, upgradeCost } from "./sim/rules.js";
import { S } from "./state.js";

export function mySeat(v) { return v ? v.seats.indexOf(S.myPeer) : -1; }

export function myGold(v) {
  const seat = mySeat(v);
  if (seat < 0) return 0;
  let g = v.gold[seat];
  for (const q of S.queue) {
    if (q[1] === "b" && TOWERS[q[3]]) g -= TOWERS[q[3]].cost;
    else if (q[1] === "u") { const tw = v.tmap.get(q[2]); if (tw && tw.lv < 3) g -= upgradeCost(tw.ty, tw.lv); }
    else if (q[1] === "g") g -= GIFT;
  }
  return g;
}

export function canBuildAt(v, c) {
  return c >= 0 && c < COLS * ROWS && !BLOCKED[c] && !v.tmap.has(c) && !S.queue.some(q => q[1] === "b" && q[2] === c) && v.towers.length < MAX_TOWERS;
}
