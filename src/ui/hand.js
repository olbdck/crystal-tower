// The hand of cards at the bottom, laid out like in Hearthstone: a fan along a gentle arc that
// overlaps more as cards are added, a hovered card rises and straightens, and its neighbours
// step aside so it can be read. On narrow screens the hand is a plain row that scrolls sideways.
import { $ } from "./dom.js";

const narrow = () => { try { return matchMedia("(max-width: 899px), (max-aspect-ratio: 1/1)").matches; } catch (_) { return false; } };
let hovered = -1;

/** Places every card of the hand; call when cards are added or removed and when the window resizes. */
export function layoutHand() {
  const hand = $("hand"), cards = [...hand.children].filter(c => !c.hidden);
  if (narrow()) { for (const c of cards) for (const p of ["--rot", "--dy", "--ml", "--push"]) c.style.removeProperty(p); return; }
  const n = cards.length;
  if (!n) return;
  const w = cards[0].offsetWidth || 126;
  // room between the purse and the right column; cards overlap more the more there are
  const room = Math.max(w * 3, Math.min(900, hand.parentElement.clientWidth - 560));
  const step = n > 1 ? Math.min(w * 0.9, (room - w) / (n - 1)) : 0;
  const spread = Math.min(5, 34 / n), curve = Math.min(2.4, 22 / (n * n / 4 + 1));
  cards.forEach((c, i) => {
    const k = i - (n - 1) / 2;
    c.style.setProperty("--rot", `${(k * spread).toFixed(2)}deg`);
    c.style.setProperty("--dy", `${(k * k * curve).toFixed(1)}px`);
    c.style.setProperty("--ml", i ? `${(step - w).toFixed(1)}px` : "0px");
    c.dataset.i = String(i);
  });
  hand.dataset.overlap = step < w * 0.8 ? "1" : "";
  spreadAround(hovered);
}

// neighbours of the hovered card move aside (only when cards overlap)
function spreadAround(i) {
  const hand = $("hand"), cards = [...hand.children].filter(c => !c.hidden);
  const push = hand.dataset.overlap && !narrow() ? 34 : 0;
  cards.forEach((c, k) => {
    const d = i < 0 || k === i ? 0 : (k < i ? -1 : 1) * push * (Math.abs(k - i) === 1 ? 1 : 0.6);
    c.style.setProperty("--push", `${d}px`);
  });
}

export function initHand() {
  const hand = $("hand");
  hand.addEventListener("pointerover", e => {
    const card = e.target.closest(".card");
    if (!card || card.disabled) return;
    const i = [...hand.children].filter(c => !c.hidden).indexOf(card);
    if (i !== hovered) { hovered = i; spreadAround(i); }
  });
  hand.addEventListener("pointerleave", () => { hovered = -1; spreadAround(-1); });
  addEventListener("resize", layoutHand);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutHand);
  layoutHand();
}
