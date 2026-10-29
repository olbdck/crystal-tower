// Answers about "me" in the current view, shared by the HUD, input handling and the renderer.
// They count actions we sent but the host has not confirmed yet, so the UI reacts at once.
import { COLS, ROWS, BLOCKED, MAX_TOWERS, GIFT } from "./sim/rules.js";
import { SPELLS, buildCost, upCost } from "./sim/cards.js";
import { S } from "./state.js";

export function mySeat(v) { return v ? v.seats.indexOf(S.myPeer) : -1; }
/** Our passive cards (bitmask). */
export function myPv(v) { const s = mySeat(v); return s >= 0 ? v.pv[s] : 0; }
/** The three cards on offer to us, or none (also while our pick is on its way). */
export function myOffer(v) { const s = mySeat(v); return s < 0 || S.queue.some(q => q[1] === "k") ? [] : v.offer[s]; }
/** Our spells in hand. */
export function myHand(v) { const s = mySeat(v); return s >= 0 ? v.hand[s] : []; }
/** A spell we cast is still on its way to the host (hand positions change once it lands). */
export const castPending = () => S.queue.some(q => q[1] === "m");

export function myGold(v) {
  const seat = mySeat(v);
  if (seat < 0) return 0;
  const pv = v.pv[seat];
  let g = v.gold[seat];
  for (const q of S.queue) {
    if (q[1] === "b" && q[3] >= 0 && q[3] < 4) g -= buildCost(pv, q[3]);
    else if (q[1] === "u") { const tw = v.tmap.get(q[2]); if (tw && tw.lv < 3) g -= upCost(pv, tw.ty, tw.lv); }
    else if (q[1] === "g") g -= GIFT;
    else if (q[1] === "m") { const id = v.hand[seat][q[2]]; if (SPELLS[id]) g -= SPELLS[id].cost; }
  }
  return g;
}

export function canBuildAt(v, c) {
  return c >= 0 && c < COLS * ROWS && !BLOCKED[c] && !v.tmap.has(c) && !S.queue.some(q => q[1] === "b" && q[2] === c) && v.towers.length < MAX_TOWERS;
}
