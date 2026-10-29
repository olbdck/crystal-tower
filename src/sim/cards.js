// Cards that players draw every few waves: passive cards (a lasting bonus for the player who took it)
// and spells (paid, one use, cast during a wave). Pure data and functions, deterministic like the Sim.
import { CARD_EVERY, MAX_WAVES, TOWERS, hash01, investedIn, sellValue, towerStats, upgradeCost } from "./rules.js";

export { CARD_EVERY };
export const HAND_MAX = 3; // spells a player can hold

// Passive cards act on the towers of the player who took them (or on what that player pays).
export const PASSIVES = [
  { key: "archer", name: "Дешеві стріли", desc: "Ваші Стрільці коштують на 20% менше" },
  { key: "craft", name: "Майстер-ремісник", desc: "Покращення за ваше золото на 20% дешевші" },
  { key: "winter", name: "Довга зима", desc: "Ваш Мороз сповільнює на 1 с довше" },
  { key: "powder", name: "Порох", desc: "Вибух ваших Гармат на 30% ширший" },
  { key: "arc", name: "Розряд", desc: "Блискавка ваших Тесл перескакує ще на одну ціль" },
  { key: "eye", name: "Гострий зір", desc: "Ваші вежі бачать на 10% далі" },
  { key: "trade", name: "Торговець", desc: "Продаж ваших веж повертає 80% замість 65%" },
  { key: "temper", name: "Загартування", desc: "Ваші вежі б’ють на 10% сильніше" },
];
// Spells: cheaper than a strong tower, one use, only while a wave is on. Damage grows with the waves.
export const SPELLS = [
  { key: "fire", name: "Вогняна куля", desc: "Вибух у вибраному місці", cost: 60, target: "cell", radius: 1.2, dmg: 110 },
  { key: "storm", name: "Хуртовина", desc: "Усі вороги 4 с ідуть удвічі повільніше", cost: 50, slow: 4 },
  { key: "quake", name: "Землетрус", desc: "Відкидає всіх ворогів на 1,5 клітинки назад", cost: 70, push: 1.5 },
  { key: "heal", name: "Сила кристала", desc: "Повертає кристалу 3 життя", cost: 80, lives: 3 },
  { key: "surge", name: "Перевантаження", desc: "Вибрана вежа 8 с стріляє вдвічі швидше", cost: 40, target: "tower", time: 8 },
  { key: "rush", name: "Золота лихоманка", desc: "10 с ваша частка за вбивства подвійна", cost: 30, time: 10 },
];
export const P = Object.fromEntries(PASSIVES.map((c, i) => [c.key, i]));
export const SP = Object.fromEntries(SPELLS.map((c, i) => [c.key, i]));

// Card codes in offers: 0-7 passives, 8-13 spells.
export const SPELL_BASE = PASSIVES.length;
export const isSpellCode = code => code >= SPELL_BASE;
export function cardOf(code) {
  return isSpellCode(code) ? { spell: true, id: code - SPELL_BASE, ...SPELLS[code - SPELL_BASE] } : { spell: false, id: code, ...PASSIVES[code] };
}

export const has = (pv, key) => !!(pv & (1 << P[key]));

/** Tower stats with the owner's passive cards (pv: the owner's bitmask, 0 for ownerless towers). */
export function towerStatsFor(ty, lv, pv) {
  const s = towerStats(ty, lv);
  if (!pv) return s;
  if (has(pv, "temper")) s.dmg *= 1.1;
  if (has(pv, "eye")) s.range *= 1.1;
  if (ty === 2 && has(pv, "winter")) s.slowDur += 1;
  if (ty === 1 && has(pv, "powder")) s.splash *= 1.3;
  if (ty === 3 && has(pv, "arc")) s.chain += 1;
  return s;
}
/** What a player with these passives pays and gets back. Discounts and refunds never add up to a profit. */
export function buildCost(pv, ty) { return ty === 0 && has(pv, "archer") ? Math.round(TOWERS[0].cost * 0.8) : TOWERS[ty].cost; }
export function upCost(pv, ty, lv) { const c = upgradeCost(ty, lv); return has(pv, "craft") ? Math.round(c * 0.8) : c; }
export function sellFor(pv, ty, lv) { return has(pv, "trade") ? Math.round(investedIn(ty, lv) * 0.8) : sellValue(ty, lv); }

/** True after the waves that end with a card pick. */
export const cardWave = w => w > 0 && w % CARD_EVERY === 0 && w < MAX_WAVES;

/**
 * Three different cards for one seat after wave w: at least one passive the player does not have yet
 * (while any are left) and at least one spell, in a shuffled order. `salt` varies it between games.
 */
export function drawOffer(w, seat, pv, salt) {
  const r = k => hash01(w * 7919 + seat * 104729 + k * 613 + salt * 31);
  const shuffle = (list, k) => list.map((x, i) => [r(k + i), x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(p => p[1]);
  const passives = shuffle(PASSIVES.map((_, i) => i).filter(i => !(pv & (1 << i))), 1);
  const spells = shuffle(SPELLS.map((_, i) => SPELL_BASE + i), 50);
  const out = [];
  if (passives.length) out.push(passives.shift());
  out.push(spells.shift());
  const rest = shuffle([...passives, ...spells], 100);
  while (out.length < 3 && rest.length) out.push(rest.shift());
  return shuffle(out, 200);
}
