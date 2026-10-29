// The welcome sign (sit down, open tables, table code) and inviting friends.
import { MAX_SEATS } from "../sim/rules.js";
import { S } from "../state.js";
import { joinedPeers, cleanName, enterTable, goSolo, sitDown, inviteLink, lobbyTables, TABLE_RE } from "../net/session.js";
import { $, toast } from "./dom.js";

let lastTablesKey = "";

export function showJoin() { $("joinOverlay").hidden = false; }

function renderTableList() {
  const box = $("tableList");
  const here = joinedPeers(S.peerList).filter(p => !p.sameTab).length;
  const others = S.soloMode || !S.roomReady || here ? [] : [...lobbyTables.entries()].filter(([n, e]) => n !== S.tableName && e.count > 0).slice(0, 5);
  const key = JSON.stringify(others);
  if (key === lastTablesKey) return;
  lastTablesKey = key;
  box.textContent = "";
  box.hidden = !others.length;
  if (!others.length) return;
  const h3 = document.createElement("h3"); h3.textContent = "Або сядьте за стіл, де вже грають:"; box.appendChild(h3);
  for (const [name, e] of others) {
    const row = document.createElement("div"); row.className = "trow";
    const info = document.createElement("div");
    const b = document.createElement("b"); b.textContent = e.names.join(", ") || "Гравці";
    const sm = document.createElement("small"); sm.textContent = `${Math.min(e.count, MAX_SEATS)} з ${MAX_SEATS}` + (e.w ? ` · хвиля ${e.w}` : " · ще не почали");
    info.append(b, sm);
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn"; btn.textContent = "Сісти";
    btn.disabled = e.count >= MAX_SEATS;
    btn.addEventListener("click", async () => { btn.disabled = true; await enterTable(name); if (S.roomReady && !S.soloMode) doJoin(); });
    row.append(info, btn); box.appendChild(row);
  }
}

export function updateJoinCard() {
  const btn = $("joinBtn"), st = $("joinStatus");
  renderTableList();
  $("soloBtn").hidden = !(S.netFailed && !S.soloMode && !S.switching);
  if (S.netFailed && !S.soloMode && !S.switching) {
    btn.disabled = false; btn.textContent = "Спробувати ще раз";
    st.textContent = "Не вдалося підключитися до сервера гри. Перевірте інтернет і спробуйте ще раз або грайте соло.";
    return;
  }
  if (!S.roomReady) { btn.disabled = true; btn.textContent = "Підключення…"; st.textContent = S.switching ? "Переходимо до столу…" : "Шукаємо кімнату…"; return; }
  btn.disabled = false;
  if (S.soloMode) {
    btn.textContent = "Грати соло";
    st.textContent = "Не вдалося підключитися до сервера гри. Перевірте інтернет і оновіть сторінку, або грайте соло.";
    return;
  }
  const live = joinedPeers(S.peerList).filter(p => !p.sameTab);
  btn.textContent = live.length ? "Сісти за стіл" : S.invitedByHash ? "Сісти за стіл" : "Відкрити свій стіл";
  st.textContent = live.length >= MAX_SEATS ? "Усі 5 місць зайняті. Ви дивитиметесь гру й сядете, щойно звільниться місце."
    : live.length ? `${S.invitedByHash ? "Вас запросили. " : ""}За столом: ${live.map(p => cleanName(p.presence.n) || "гравець").join(", ")}`
    : S.invitedByHash ? "За цим столом зараз нікого. Можете сісти й почекати друзів або почати самі."
    : "Сядьте, а потім запросіть друзів кнопкою «Запросити» на вільному місці.";
}

export function doJoin() {
  if (S.netFailed && !S.soloMode) { const n = S.netFailed; S.netFailed = null; enterTable(n); updateJoinCard(); return; }
  if (!S.roomReady) return;
  const n = cleanName($("nick").value) || "Гравець";
  try { localStorage.setItem("kv-nick", n); } catch (_) {}
  $("joinOverlay").hidden = true;
  sitDown(n);
}

/* ---------- invites ---------- */
function showInvite(link) {
  const inp = $("inviteLink");
  inp.value = link;
  $("inviteCode").textContent = S.tableName ? S.tableName.slice(5).toUpperCase() : "";
  $("inviteOverlay").hidden = false;
  setTimeout(() => { try { inp.focus(); inp.select(); } catch (_) {} }, 30);
}
export function copyInvite() {
  if (S.soloMode || !S.tableName) { toast("Онлайн зараз недоступний, запросити не вийде"); return; }
  const link = inviteLink();
  try {
    const pr = navigator.clipboard && navigator.clipboard.writeText(link);
    if (pr && pr.then) pr.then(() => toast("Посилання на ваш стіл скопійовано. Надішліть його друзям"), () => showInvite(link));
    else showInvite(link);
  } catch (_) { showInvite(link); }
}
function copyCode() {
  if (S.soloMode || !S.tableName) return;
  const code = S.tableName.slice(5).toUpperCase();
  try {
    const pr = navigator.clipboard && navigator.clipboard.writeText(code);
    if (pr && pr.then) pr.then(() => toast(`Код столу ${code} скопійовано`), () => showInvite(inviteLink()));
    else showInvite(inviteLink());
  } catch (_) { showInvite(inviteLink()); }
}
function goCode() {
  const raw = $("codeIn").value.trim().toLowerCase().replace(/^stil-/, "").replace(/[^a-z0-9]/g, "");
  const n = "stil-" + raw;
  if (!TABLE_RE.test(n)) { toast("Код столу — це 4–16 літер чи цифр"); return; }
  if (S.soloMode) { toast("Онлайн зараз недоступний"); return; }
  if (n === S.tableName) { toast("Ви вже за цим столом"); return; }
  S.invitedByHash = true; $("codeIn").value = "";
  enterTable(n);
}

export function initJoin() {
  try { $("nick").value = localStorage.getItem("kv-nick") || ""; } catch (_) {}
  $("joinForm").addEventListener("submit", e => { e.preventDefault(); doJoin(); });
  $("inviteCopy").addEventListener("click", () => {
    const inp = $("inviteLink");
    try { inp.focus(); inp.select(); } catch (_) {}
    try {
      const pr = navigator.clipboard && navigator.clipboard.writeText(inp.value);
      if (pr && pr.then) pr.then(() => { $("inviteOverlay").hidden = true; toast("Посилання скопійовано"); }, () => toast("Натисніть Ctrl+C або ⌘C, щоб скопіювати"));
      else toast("Натисніть Ctrl+C або ⌘C, щоб скопіювати");
    } catch (_) { toast("Натисніть Ctrl+C або ⌘C, щоб скопіювати"); }
  });
  $("codeBtn").addEventListener("click", copyCode);
  $("soloBtn").addEventListener("click", () => { S.netFailed = null; goSolo(null); });
  $("codeGo").addEventListener("click", goCode);
  $("codeIn").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); goCode(); } });
}
