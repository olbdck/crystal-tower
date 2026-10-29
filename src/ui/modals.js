// Rules, synergy explainer and invite dialogs.
import { TOWERS, SYN_BONUS, towerStats } from "../sim/rules.js";
import { $ } from "./dom.js";

const MODALS = ["synOverlay", "inviteOverlay", "rulesOverlay", "cardOverlay"];

/** Closes the top-most open dialog; returns false if none was open. */
export function closeTopModal() {
  for (const id of MODALS) if (!$(id).hidden) { $(id).hidden = true; return true; }
  return false;
}

export function openSyn() {
  const tb = $("synTable");
  if (!tb.rows.length) {
    const what = ["Шкода кожної стріли", "Вибух у центрі й бризки навколо", "Шкода холоду (сповільнення не змінюється)", "Кожен перескок блискавки"];
    const head = tb.createTHead().insertRow();
    for (const h of ["Вежа", "Що посилює", "Без", "+30%", "+60%"]) { const th = document.createElement("th"); th.textContent = h; head.appendChild(th); }
    const body = tb.createTBody();
    TOWERS.forEach((t, i) => {
      const r = body.insertRow(), dmg = towerStats(i, 1).dmg;
      const c0 = r.insertCell(); c0.className = "tname"; c0.textContent = t.name;
      r.insertCell().textContent = what[i];
      for (const k of [0, 2, 4]) {
        const c = r.insertCell(); c.className = "num";
        const val = +(dmg * (1 + SYN_BONUS * k)).toFixed(1);
        if (k) { const b = document.createElement("b"); b.textContent = val; c.appendChild(b); } else c.textContent = val;
      }
    });
  }
  $("synOverlay").hidden = false;
}

export function initModals() {
  $("helpBtn").addEventListener("click", () => { $("rulesOverlay").hidden = false; });
  document.querySelectorAll("[data-open-syn]").forEach(b => b.addEventListener("click", () => { $("rulesOverlay").hidden = true; openSyn(); }));
  $("synClose").addEventListener("click", () => { $("synOverlay").hidden = true; });
  $("rulesClose").addEventListener("click", () => { $("rulesOverlay").hidden = true; });
  $("inviteClose").addEventListener("click", () => { $("inviteOverlay").hidden = true; });
  for (const id of MODALS) $(id).addEventListener("click", e => { if (e.target === $(id)) $(id).hidden = true; });
}
