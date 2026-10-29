// Cards in the interface: the pick of 1 out of 3 after every few waves, spells in hand (cast on the board
// during a wave), and the small icons of passive cards next to each player in the party list.
import { PASSIVES, SPELLS, SPELL_BASE, cardOf } from "../sim/cards.js";
import { S } from "../state.js";
import { act } from "../net/session.js";
import { getView } from "../net/view.js";
import { mySeat, myGold, myOffer, myHand, castPending } from "../game.js";
import { $, toast } from "./dom.js";

// Line icons on a 24x24 grid, drawn with the current text colour.
const PATHS = {
  archer: '<path d="M5 19 19 5M13 5h6v6M5 19l-.5-4M5 19l4 .5"/><circle cx="7" cy="7" r="2.6"/>',
  craft: '<path d="m14 3 7 7-3 3-7-7zM12.5 8.5 3.5 17.5l3 3 9-9"/>',
  winter: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/>',
  powder: '<circle cx="10" cy="14" r="7"/><path d="m15 9 3-3M19 2.5v2M21.5 5h-2M17.5 3.5l1 1"/>',
  arc: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  trade: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  temper: '<path d="M20 4 9 15M14 4h6v6M7 13l4 4M6.5 17.5l-3 3"/>',
  fire: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z"/>',
  storm: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><circle cx="12" cy="12" r="3"/>',
  quake: '<path d="M2 11h5l2-4 3 9 2-6 2 3h6M3 20h18"/>',
  heal: '<path d="M6 3h12l4 6-10 13L2 9zM2 9h20M12 12v6M9 15h6"/>',
  surge: '<path d="m6 13 6-6 6 6M6 19l6-6 6 6M6 7l6-6 6 6"/>',
  rush: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v11M9 9.5h4.5a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3H15"/>',
};
export function cardIcon(key) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${PATHS[key] || ""}</svg>`;
}

/** A card element (button) for an offer code: passive 0-7 or spell 8-13. */
function cardElement(code, extraClass) {
  const c = cardOf(code), b = document.createElement("button");
  b.type = "button";
  b.className = `card cardx ${c.spell ? "spell" : "passive"} ${extraClass || ""}`;
  b.innerHTML = `<span class="face"><span class="art">${cardIcon(c.key)}</span><span class="ribbon outlined"></span><span class="txt"></span><span class="kind"></span></span>` +
    (c.spell ? `<span class="cost outlined">${c.cost}</span><span class="need" hidden></span>` : "");
  b.querySelector(".ribbon").textContent = c.name;
  b.querySelector(".txt").textContent = c.desc;
  b.querySelector(".kind").textContent = c.spell ? "Магія · одноразова" : "Пасивна";
  b.setAttribute("aria-label", `${c.name}. ${c.spell ? `Магія, ${c.cost} золота` : "Пасивна карта"}. ${c.desc}`);
  return b;
}

/* ---------- the pick ---------- */
let shownOffer = "";
export function openOffer() {
  const v = getView(performance.now()), offer = v ? myOffer(v) : [];
  if (!offer.length) return;
  const box = $("offerCards");
  box.textContent = "";
  offer.forEach((code, slot) => {
    const b = cardElement(code, "big");
    b.addEventListener("click", () => {
      act("k", slot);
      $("cardOverlay").hidden = true;
      const c = cardOf(code);
      toast(c.spell ? `«${c.name}» у руці. Застосуйте її під час хвилі` : `«${c.name}» діє до кінця гри`);
      S.uiDirty = true;
    });
    box.appendChild(b);
  });
  const owned = PASSIVES.filter((_, i) => v.pv[mySeat(v)] & (1 << i)).map(p => p.name);
  $("offerOwned").textContent = owned.length ? `Ваші пасивні карти: ${owned.join(", ")}` : "";
  $("cardOverlay").hidden = false;
}
/** Opens the pick by itself when new cards arrive (once; "Пізніше" leaves it on the ready button). */
function watchOffer(v) {
  const offer = myOffer(v), key = offer.length ? `${v.w}|${offer.join(",")}` : "";
  if (key === shownOffer) return;
  shownOffer = key;
  if (!key) { $("cardOverlay").hidden = true; return; }
  openOffer(); // a new pick: show it (closing it any way just postpones it)
}

/* ---------- spells in hand ---------- */
let handKey = "";
export function selectSpell(i) {
  const v = getView(performance.now()), hand = v ? myHand(v) : [], id = hand[i];
  if (id === undefined) return;
  const sp = SPELLS[id];
  if (v.ph !== 2) { toast("Магію можна застосувати лише під час хвилі"); return; }
  if (castPending()) return;
  if (myGold(v) < sp.cost) { toast(`Потрібно ${sp.cost} золота`); return; }
  S.buildType = -1; S.selCell = -1; S.armedCell = -1;
  if (!sp.target) { act("m", i, -1); S.castSlot = -1; S.uiDirty = true; return; }
  S.castSlot = S.castSlot === i ? -1 : i;
  if (S.castSlot >= 0) toast(sp.target === "tower" ? "Оберіть вежу на полі" : "Оберіть місце на полі");
  S.uiDirty = true;
}
/** Casts the selected spell at a board cell; returns true if the click was used for it. */
export function castAt(v, cell) {
  if (S.castSlot < 0) return false;
  const id = myHand(v)[S.castSlot], sp = SPELLS[id];
  if (!sp || v.ph !== 2) { S.castSlot = -1; return true; }
  if (sp.target === "tower" && !v.tmap.has(cell)) { toast("Оберіть вежу"); return true; }
  act("m", S.castSlot, cell);
  S.castSlot = -1; S.uiDirty = true;
  return true;
}

function renderSpells(v, g) {
  const hand = myHand(v), box = $("spells");
  const key = hand.join(",");
  if (key !== handKey) {
    handKey = key;
    box.textContent = "";
    hand.forEach((id, i) => {
      const b = cardElement(SPELL_BASE + id);
      const k = document.createElement("kbd"); k.textContent = String(5 + i); b.appendChild(k);
      b.addEventListener("click", () => selectSpell(i));
      box.appendChild(b);
    });
    if (S.castSlot >= hand.length) S.castSlot = -1;
  }
  box.hidden = !hand.length;
  const wave = v.ph === 2, pending = castPending();
  [...box.children].forEach((b, i) => {
    const sp = SPELLS[hand[i]], poor = g !== null && g < sp.cost;
    b.classList.toggle("poor", poor);
    b.classList.toggle("sel", S.castSlot === i);
    b.classList.toggle("idle", !wave);
    b.disabled = mySeat(v) < 0 || pending;
    b.title = wave ? "" : "Лише під час хвилі";
    const need = b.querySelector(".need");
    need.hidden = !poor; if (poor) need.textContent = `Бракує ${Math.ceil(sp.cost - g)}`;
  });
  if (!wave && S.castSlot >= 0) S.castSlot = -1;
}

/** Called by the HUD on every update. */
export function updateCards(v, g) {
  if (!v) return;
  renderSpells(v, g);
  watchOffer(v);
}

/** Small icons of a player's passive cards, for the party list. */
export function passiveIcons(pv) {
  const box = document.createElement("span"); box.className = "relics";
  PASSIVES.forEach((p, i) => {
    if (!(pv & (1 << i))) return;
    const s = document.createElement("span"); s.className = "relic"; s.innerHTML = cardIcon(p.key);
    s.title = `${p.name}: ${p.desc}`;
    box.appendChild(s);
  });
  return box;
}

export function initCards() {
  $("cardLater").addEventListener("click", () => { $("cardOverlay").hidden = true; });
}
