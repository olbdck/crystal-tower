// Game rules shared by every player: board, paths, towers, enemies and waves.
// Pure data and functions, no DOM, so it runs in the browser and in Node tests alike.
export const COLS = 20, ROWS = 12, MAX_SEATS = 5, MAX_WAVES = 20;
export const START_GOLD = 160, START_LIVES = 20, BREAK_TIME = 20, GIFT = 25;
export const MAX_TOWERS = 85, MAX_ENEMIES = 55, STEP = 1 / 30, SYN_BONUS = 0.15, SLOW_FACTOR = 0.5;
// Gold. A kill pays half its bounty to the owner of the tower that landed it; the other half is shared
// equally by everyone at the table, so nobody is left without income. During a wave the crystal also
// pays every seat 1 gold a second, up to half of the wave bonus; the rest comes when the wave is cleared.
export const KILL_SHARE = 0.5, DRIP_EVERY = 30;
export function waveBonus(w) { return 20 + 4 * w; }
export function dripCap(w) { return Math.floor(waveBonus(w) / 2); }
// A player who drops out keeps their seat, gold and towers this long (in ticks): 3 minutes.
export const SEAT_GRACE = 30 * 180;
/** Owner of towers left behind by a player who did not come back: they keep shooting, nobody owns them. */
export const NO_OWNER = -1;

export const LANE_WP = [
  [[-1, 1], [3, 1], [3, 4], [7, 4], [7, 6]],
  [[-1, 10], [3, 10], [3, 8], [7, 8], [7, 6]],
];
export const SHARED_WP = [[7, 6], [10, 6], [10, 2], [14, 2], [14, 9], [17, 9], [17, 5], [18, 5]];
export const CRYSTAL = { x: 18, y: 5 };

export const TOWERS = [
  { name: "Стрілець", desc: "Швидкі постріли по одній цілі", cost: 50, dmg: 10, rate: 0.55, range: 2.5 },
  { name: "Гармата", desc: "Повільна, б’є по площі", cost: 90, dmg: 28, rate: 1.5, range: 2.3, splash: 0.95 },
  { name: "Мороз", desc: "Сповільнює ціль і тих, хто поруч", cost: 70, dmg: 5, rate: 1.0, range: 2.2, splash: 0.8, slowDur: 1.6 },
  { name: "Тесла", desc: "Блискавка перескакує на 3 цілі", cost: 140, dmg: 20, rate: 1.1, range: 2.4, chain: 3, chainRange: 1.7 },
  // Support towers do not shoot. They strengthen every shooting tower on the 8 cells around them, whoever's
  // it is; several of the same kind around one tower do not add up, the strongest counts.
  { name: "Маяк", desc: "Не стріляє. Вежі поруч бачать далі", cost: 60, dmg: 0, rate: 0, range: 0, support: "range", aura: [0.2, 0.3, 0.4] },
  { name: "Стяг", desc: "Не стріляє. Вежі поруч б’ють сильніше", cost: 80, dmg: 0, rate: 0, range: 0, support: "dmg", aura: [0.2, 0.3, 0.4] },
  { name: "Відлуння", desc: "Не стріляє. Вежі поруч часом б’ють двічі", cost: 90, dmg: 0, rate: 0, range: 0, support: "multi", aura: [0.15, 0.25, 0.35] },
];
/** Tower types that shoot, and support types that strengthen their neighbours. */
export const isSupport = ty => !!(TOWERS[ty] && TOWERS[ty].support);
export const SUPPORT_KINDS = ["range", "dmg", "multi"];
/**
 * What the support towers on the 8 cells around a shooting tower give it: { range, dmg, multi } as
 * fractions (0.25 = +25% range, +25% damage, 25% chance to attack twice), or null if nothing.
 */
export function auraAt(towers, tw) {
  if (isSupport(tw.ty)) return null;
  const x = tw.c % COLS, y = (tw.c / COLS) | 0;
  let out = null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
    const nb = towers.get(ny * COLS + nx);
    if (!nb || !isSupport(nb.ty)) continue;
    const d = TOWERS[nb.ty], v = d.aura[nb.lv - 1];
    out = out || { range: 0, dmg: 0, multi: 0 };
    if (v > out[d.support]) out[d.support] = v;
  }
  return out;
}
export const ENEMIES = [
  { name: "Пішак", hp: 34, speed: 1.15, gold: 3, leak: 1, r: 0.27 },
  { name: "Бігун", hp: 20, speed: 2.0, gold: 3, leak: 1, r: 0.24 },
  { name: "Броня", hp: 150, speed: 0.7, gold: 9, leak: 2, r: 0.33 },
  { name: "Колос", hp: 700, speed: 0.55, gold: 60, leak: 6, r: 0.43 },
];

export const PATHS = LANE_WP.map(lane => {
  const wp = lane.concat(SHARED_WP.slice(1)).map(([x, y]) => [x + 0.5, y + 0.5]);
  const cum = [0];
  // Math.sqrt is exact in every engine (Math.hypot is not), and every player must get the same lengths
  for (let i = 1; i < wp.length; i++) { const dx = wp[i][0] - wp[i - 1][0], dy = wp[i][1] - wp[i - 1][1]; cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy)); }
  return { wp, cum, len: cum[cum.length - 1] };
});

export function posAt(lane, d) {
  const p = PATHS[lane], wp = p.wp, cum = p.cum;
  if (d <= 0) return [wp[0][0], wp[0][1]];
  if (d >= p.len) { const q = wp[wp.length - 1]; return [q[0], q[1]]; }
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1], f = seg > 0 ? (d - cum[i - 1]) / seg : 0;
  return [wp[i - 1][0] + (wp[i][0] - wp[i - 1][0]) * f, wp[i - 1][1] + (wp[i][1] - wp[i - 1][1]) * f];
}

export const BLOCKED = new Uint8Array(COLS * ROWS);
(function markPath() {
  const segs = [];
  for (const lane of LANE_WP) for (let i = 1; i < lane.length; i++) segs.push([lane[i - 1], lane[i]]);
  for (let i = 1; i < SHARED_WP.length; i++) segs.push([SHARED_WP[i - 1], SHARED_WP[i]]);
  for (const [[x1, y1], [x2, y2]] of segs) {
    const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let k = 0; k <= n; k++) {
      const x = x1 + Math.sign(x2 - x1) * k, y = y1 + Math.sign(y2 - y1) * k;
      if (x >= 0 && x < COLS && y >= 0 && y < ROWS) BLOCKED[y * COLS + x] = 1;
    }
  }
  BLOCKED[CRYSTAL.y * COLS + CRYSTAL.x] = 2;
})();

// Plain multiplication instead of Math.pow: every browser must compute bit-identical numbers,
// because each player runs the same simulation from the same inputs (see src/net/stream.js).
const pow = (b, k) => { let r = 1; for (let i = 0; i < k; i++) r *= b; return r; };
export function towerStats(ty, lv) {
  const d = TOWERS[ty], k = lv - 1;
  return {
    dmg: d.dmg * pow(1.6, k), rate: d.rate * pow(0.88, k), range: d.range + 0.3 * k,
    splash: d.splash || 0, slowDur: d.slowDur ? d.slowDur + 0.4 * k : 0,
    chain: d.chain ? d.chain + k : 0, chainRange: d.chainRange || 0,
  };
}
export function upgradeCost(ty, lv) { return Math.round(TOWERS[ty].cost * 0.8 * lv); }
export function investedIn(ty, lv) { let s = TOWERS[ty].cost; for (let l = 1; l < lv; l++) s += upgradeCost(ty, l); return s; }
export function sellValue(ty, lv) { return Math.round(investedIn(ty, lv) * 0.65); }

export function hash01(n) {
  n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
}
export function waveSize(w, pc) { return Math.round((6 + 2.2 * w) * (0.6 + 0.4 * pc)); }
export function waveBosses(w, pc) { return w % 5 === 0 ? 1 + Math.floor(w / 10) + (pc >= 4 ? 1 : 0) : 0; }
export function waveTotal(w, pc) { return waveSize(w, pc) + waveBosses(w, pc); }
export function enemyTypeAt(w, i, pc) {
  if (i >= waveSize(w, pc)) return 3;
  const r = hash01(w * 7919 + i * 104729 + 17);
  if (w % 5 === 3) return r < 0.7 ? 1 : 0;
  if (w >= 4 && r < 0.1 + 0.012 * w) return 2;
  if (w >= 2 && r < 0.4) return 1;
  return 0;
}
/** A pick of 1 card out of 3 (src/sim/cards.js) comes after every CARD_EVERY-th wave. */
export const CARD_EVERY = 3;
// Cards make the team stronger every CARD_EVERY waves; enemies get tougher to match, more so with more
// players (more cards at the table). Tuned with seeded bot games: npm run balance.
const CARD_HP = [0.1, 0.08, 0.065, 0.055, 0.06];
export function hpScale(w, pc) {
  const x = w - 1, cards = Math.floor(x / CARD_EVERY);
  return (1 + 0.31 * x + 0.037 * x * x) * (0.6 + 0.4 * pc) * (1 + CARD_HP[Math.min(5, Math.max(1, pc)) - 1] * cards);
}
export function spawnInterval(w, pc) { return Math.max(0.28, 0.85 / (0.6 + 0.4 * pc)); }
export function waveMix(w, pc) {
  const c = [0, 0, 0, 0], n = waveTotal(w, pc);
  for (let i = 0; i < n; i++) c[enemyTypeAt(w, i, pc)]++;
  return c;
}

/** At most this many of the synergy bonuses can come from the owner's own towers ("Єдність"). */
export const OWN_SYN_MAX = 2;
/**
 * How many synergy bonuses a tower gets (0-4): one for every other player with a tower on the 8 cells
 * around it, and, with ownTypes (the "Єдність" card), one for every other tower type of its owner there
 * (up to OWN_SYN_MAX).
 */
export function synergyAt(towers, tw, ownTypes = false) {
  const x = tw.c % COLS, y = (tw.c / COLS) | 0, owners = new Set(), types = new Set();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
    const nb = towers.get(ny * COLS + nx);
    if (!nb) continue;
    if (nb.o !== tw.o) owners.add(nb.o);
    else if (ownTypes && nb.ty !== tw.ty) types.add(nb.ty);
  }
  return Math.min(4, owners.size + Math.min(OWN_SYN_MAX, types.size));
}
