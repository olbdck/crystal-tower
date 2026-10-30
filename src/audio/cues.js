// Which sound goes with which moment of the game. Effects come from the local copy of the Sim
// (see Sim.fx), so every player hears the shots of the game they see.
import { COLS, ROWS, ENEMIES, KILL_SHARE } from "../sim/rules.js";
import { SP } from "../sim/cards.js";
import { S } from "../state.js";
import { playSound } from "./sound.js";

const SPELL_SOUND = { [SP.fire]: "fire", [SP.storm]: "storm", [SP.quake]: "quake", [SP.heal]: "heal", [SP.surge]: "surge", [SP.rush]: "rush" };
let panOf = (x, z) => (x / COLS) * 2 - 1;
/** Lets the renderer tell where on screen a board point is, so sounds come from the left or the right. */
export function setPanner(fn) { panOf = fn; }

/** Sound for one effect from the simulation: [kind, x*10, z*10, ...] (see Sim.fx). */
export function fxSound(f) {
  const k = f[0], x = f[1] / 10, z = f[2] / 10;
  const pan = Math.max(-1, Math.min(1, panOf(Math.min(COLS, Math.max(0, x)), Math.min(ROWS, Math.max(0, z)))));
  if (k === 0) playSound("arrow", { pan });
  else if (k === 1) { playSound("cannon", { pan }); playSound("boom", { pan: Math.max(-1, Math.min(1, panOf(f[3] / 10, f[4] / 10))), delay: 0.3 }); }
  else if (k === 2) playSound("frost", { pan });
  else if (k === 3) playSound("zap", { pan });
  else if (k === 4) {
    const ty = f[3], killer = f[4] - 1, share = (f[5] || 0) / 100;
    playSound(ty === 3 ? "bigpop" : "pop", { pan });
    const mine = S.mySeat >= 0 && ENEMIES[ty] ? (killer === S.mySeat ? ENEMIES[ty].gold * (1 - KILL_SHARE) + share : share) : 0;
    if (mine >= 1) playSound("coin", { pan, delay: 0.05 });
  } else if (k === 5) { if (S.mySeat >= 0) playSound("drip", { pan }); }
  else if (k === 6 && SPELL_SOUND[f[3]]) playSound(SPELL_SOUND[f[3]], { pan });
}
