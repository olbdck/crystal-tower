// Small DOM helpers used across the UI: element lookup, toasts, wave announcements, icons.
import { playSound } from "../audio/sound.js";

export const $ = id => document.getElementById(id);

export const ICON = {
  sword: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 1.5 6 9l1 1 7.5-7.5V1.5h-1ZM4.2 9.4l-1 1 1.4 1.4-2.1 2.1.7.7 2.1-2.1 1.4 1.4 1-1-3.5-3.5Z" fill="currentColor"/></svg>',
  range: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
  tick: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3 3 7-7" fill="none" stroke="#10300a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

let toastTimer = 0;
export function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, Math.max(1900, msg.length * 55));
}

export function announce(main, sub) {
  const host = $("announceHost");
  host.textContent = "";
  const d = document.createElement("div"); d.className = "announce";
  const b = document.createElement("b"); b.className = "outlined"; b.textContent = main; d.appendChild(b);
  if (sub) { const s = document.createElement("span"); s.textContent = sub; d.appendChild(s); }
  host.appendChild(d);
  setTimeout(() => { if (d.parentNode) d.remove(); }, 2100);
}

export function lifeHit() { playSound("leak"); const g = $("lifeGem"); g.classList.remove("hit"); void g.offsetWidth; g.classList.add("hit"); }
