// Prints how much the game stream sends per second: five bot players play a whole game on a
// recorded host, one batch per tick as in the browser. Run with `npm run netstats`.
import { Sim } from "../../src/sim/sim.js";
import { TOWERS, BLOCKED } from "../../src/sim/rules.js";
import { Recorder } from "../../src/net/stream.js";

const FREE = [...BLOCKED.keys()].filter(c => !BLOCKED[c]);
const labels = ["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc", "dddddddddd", "eeeeeeeeee"];
const sim = new Sim(), rec = new Recorder(sim), seqs = new Map();
rec.roster(labels); rec.batch();
const act = (label, ...a) => { const s = (seqs.get(label) || 1e10) + 1; seqs.set(label, s); rec.act(label, [s, ...a]); };

let second = 0, bytes = 0, msgs = 0, peak = 0, total = 0, seconds = 0, maxKf = 0;
const perWave = new Map();
while (sim.ph <= 2 && sim.t < 30 * 60 * 60) {
  if (sim.t % 45 === 0) labels.forEach((label, seat) => {
    const ty = (sim.t / 90 + seat) % TOWERS.length | 0, cell = FREE[(sim.t * 7 + seat * 31) % FREE.length];
    if (sim.gold[seat] >= TOWERS[ty].cost && !sim.towers.has(cell)) act(label, "b", cell, ty);
    const mine = [...sim.towers.values()].find(t => t.o === seat && t.lv < 3);
    if (mine && sim.gold[seat] > 200) act(label, "u", mine.c);
    if (sim.ph === 1) act(label, "r", 1);
  });
  rec.step();
  const b = rec.batch();
  if (b) { second += b.length; msgs++; }
  if (sim.t % 30 === 0) {
    peak = Math.max(peak, second); total += second; seconds++;
    const w = perWave.get(sim.w) || { bytes: 0, s: 0 };
    w.bytes += second; w.s++; perWave.set(sim.w, w);
    second = 0;
  }
  if (sim.t % 300 === 0) maxKf = Math.max(maxKf, rec.keyframe("abc1234").length);
}
const kb = x => (x / 1024).toFixed(2) + " KB";
console.log(`game: ${sim.w} waves, ${(seconds / 60).toFixed(1)} min, ${sim.towers.size} towers at the end`);
console.log(`stream: ${kb(total / seconds)}/s on average, ${kb(peak)}/s at most, ${(msgs / seconds).toFixed(0)} batches/s`);
console.log(`keyframe: up to ${kb(maxKf)}`);
console.log("per wave (B/s):", [...perWave].map(([w, x]) => `${w}:${Math.round(x.bytes / x.s)}`).join(" "));
