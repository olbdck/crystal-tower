// Player input: the tower cards in hand, clicks and taps on the board, keyboard shortcuts,
// and the actions they send (build, upgrade, sell, ready).
import { TOWERS, BLOCKED, MAX_TOWERS } from "../sim/rules.js";
import { buildCost, upCost } from "../sim/cards.js";
import { getView } from "../net/view.js";
import { act, setPresence } from "../net/session.js";
import { pickCell, glCanvas } from "../render/scene.js";
import { portrait } from "../render/portraits.js";
import { mySeat, myGold, myPv, myOffer, canBuildAt } from "../game.js";
import { selectSpell, castAt, openOffer } from "./cards.js";
import { S } from "../state.js";
import { $, ICON, toast } from "./dom.js";
import { closeTopModal } from "./modals.js";

/* ---------- cards in hand ---------- */
let artSeat = null;
function buildCards() {
  const hand = $("hand");
  TOWERS.forEach((t, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "card t" + i; b.id = "card" + i;
    b.innerHTML = `<span class="face"><span class="art"><img alt=""></span><span class="ribbon outlined"></span><span class="txt"></span>` +
      `<span class="stats"><span>${ICON.sword}<em></em></span><span>${ICON.range}<em></em></span></span></span><span class="cost outlined">${t.cost}</span><span class="need" hidden></span><kbd>${i + 1}</kbd>`;
    b.querySelector(".ribbon").textContent = t.name;
    b.querySelector(".txt").textContent = t.desc;
    const ems = b.querySelectorAll(".stats em");
    ems[0].textContent = String(t.dmg); ems[1].textContent = String(t.range);
    b.setAttribute("aria-label", `${t.name}, ${t.cost} золота. ${t.desc}`);
    b.addEventListener("click", () => selectBuild(i));
    hand.appendChild(b);
  });
}
/** Card art shows towers in the player's own colour. */
export function refreshCardArt(seat) {
  if (seat === artSeat) return;
  artSeat = seat;
  TOWERS.forEach((_, i) => { const url = portrait("t", i, 1, seat); const img = $("card" + i).querySelector("img"); if (url) img.src = url; });
}

export function selectBuild(i) {
  S.buildType = S.buildType === i ? -1 : i;
  if (S.buildType >= 0) {
    try {
      const v = getView(performance.now());
      if (!localStorage.getItem("kv-syn-hint") && v && v.seats.filter(Boolean).length > 1) {
        localStorage.setItem("kv-syn-hint", "1");
        toast("Порада: вежа поруч із вежею друга б’є сильніше. Наведіть на клітинку, і над вежею з’явиться бонус");
      }
    } catch (_) {}
  }
  if (S.buildType >= 0) S.selCell = -1;
  S.armedCell = -1; S.castSlot = -1; sendHover(true); S.uiDirty = true;
}

/* ---------- where our pointer is, for teammates ---------- */
let lastHoverSent = 0, pendingHover = null;
export function sendHover(force) {
  if (!S.joined) return;
  const now = performance.now();
  const patch = { h: S.hoverCell >= 0 ? S.hoverCell : S.armedCell >= 0 ? S.armedCell : -1, y: S.buildType };
  if (S.myPres.h === patch.h && S.myPres.y === patch.y) return;
  if (!force && now - lastHoverSent < 110) { pendingHover = patch; return; }
  lastHoverSent = now; pendingHover = null;
  setPresence(patch);
}

/* ---------- actions ---------- */
export function cancelAll() { S.buildType = -1; S.selCell = -1; S.armedCell = -1; S.castSlot = -1; S.uiDirty = true; sendHover(true); }

export function doUpgrade() {
  const v = getView(performance.now()), tw = v && v.tmap.get(S.selCell);
  if (!tw || mySeat(v) < 0) return;
  if (tw.lv >= 3) return toast("Вежа вже максимального рівня");
  const cost = upCost(myPv(v), tw.ty, tw.lv);
  if (myGold(v) < cost) return toast(`Потрібно ${cost} золота`);
  act("u", tw.c); S.uiDirty = true;
}
export function doSell() {
  const v = getView(performance.now()), tw = v && v.tmap.get(S.selCell);
  if (!tw) return;
  if (tw.o !== mySeat(v)) return toast("Продати можна лише свою вежу");
  act("s", tw.c); S.selCell = -1; S.uiDirty = true;
}
export function doReady() {
  const v = getView(performance.now());
  if (!v) return;
  const seat = mySeat(v);
  if (v.ph >= 3) { if (seat >= 0) act("n"); return; }
  if (myOffer(v).length) { openOffer(); return; }
  if (seat < 0 || v.ph !== 1) return;
  const pending = [...S.queue].reverse().find(q => q[1] === "r");
  const curReady = pending ? !!pending[2] : v.ready[seat];
  act("r", curReady ? 0 : 1); S.uiDirty = true;
}

function onBoardClick(e) {
  const v = getView(performance.now());
  const c = pickCell(e.clientX, e.clientY);
  if (!v || c < 0) { if (c < 0) { S.selCell = -1; S.armedCell = -1; S.uiDirty = true; } return; }
  const seat = mySeat(v);
  if (castAt(v, c)) return;
  if (v.tmap.has(c)) { S.selCell = S.selCell === c ? -1 : c; S.buildType = -1; S.armedCell = -1; S.uiDirty = true; sendHover(true); return; }
  if (S.buildType < 0) { S.selCell = -1; S.armedCell = -1; S.uiDirty = true; return; }
  if (seat < 0) { toast("Ви глядач: вільного місця поки немає"); return; }
  if (v.ph > 2) return;
  if (BLOCKED[c]) { toast("На стежці будувати не можна"); S.armedCell = -1; return; }
  if (!canBuildAt(v, c)) { toast(v.towers.length >= MAX_TOWERS ? `На столі вже ${MAX_TOWERS} веж, це максимум` : "Клітинка зайнята"); return; }
  const cost = buildCost(myPv(v), S.buildType);
  if (myGold(v) < cost) { toast(`Потрібно ${cost} золота`); return; }
  if (lastPointerType === "touch" && S.armedCell !== c) { S.armedCell = c; sendHover(true); toast("Торкніться ще раз, щоб поставити"); return; }
  S.armedCell = -1;
  act("b", c, S.buildType);
  sendHover(true);
}

let lastPointerType = "mouse";
export function initInput() {
  buildCards();
  setInterval(() => { if (pendingHover) { lastHoverSent = performance.now(); setPresence(pendingHover); pendingHover = null; } }, 120);

  glCanvas.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse") return;
    const c = pickCell(e.clientX, e.clientY);
    if (c !== S.hoverCell) { S.hoverCell = c; sendHover(false); }
  });
  glCanvas.addEventListener("pointerleave", () => { S.hoverCell = -1; sendHover(false); });
  glCanvas.addEventListener("pointerdown", e => { lastPointerType = e.pointerType || "mouse"; });
  glCanvas.addEventListener("contextmenu", e => { e.preventDefault(); cancelAll(); });
  glCanvas.addEventListener("click", onBoardClick);

  $("upBtn").addEventListener("click", doUpgrade);
  // while the pointer or focus is on "Upgrade", the board shows the next level's range
  const preview = on => () => { S.upgradePreview = on; };
  for (const [ev, on] of [["pointerenter", true], ["pointerleave", false], ["focus", true], ["blur", false]]) $("upBtn").addEventListener(ev, preview(on));
  $("sellBtn").addEventListener("click", doSell);
  $("readyBtn").addEventListener("click", doReady);
  $("newGameBtn").addEventListener("click", () => act("n"));

  document.addEventListener("keydown", e => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const m = /^Digit([1-7])$/.exec(e.code);
    if (m) { if (+m[1] <= 4) selectBuild(+m[1] - 1); else selectSpell(+m[1] - 5); e.preventDefault(); }
    else if (e.code === "Escape") { if (!closeTopModal()) cancelAll(); }
    else if (e.code === "KeyU") doUpgrade();
    else if (e.code === "KeyS") doSell();
    else if (e.code === "KeyR") doReady();
  });
}
