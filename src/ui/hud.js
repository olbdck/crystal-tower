// The heads-up display: connection plaque, wave banner, crystal, ready button, gold and cards,
// the selected tower panel, the party list and the end-of-game sign.
import { MAX_SEATS, MAX_WAVES, START_LIVES, TOWERS, ENEMIES, GIFT, SYN_BONUS, OWN_SYN_MAX, waveTotal, waveBosses, waveMix } from "../sim/rules.js";
import { P, buildCost, upCost, sellFor, towerStatsFor } from "../sim/cards.js";
import { TEST } from "../config.js";
import { S } from "../state.js";
import { act, advertise, nameOfPeer } from "../net/session.js";
import { SEAT_CSS } from "../render/gfx.js";
import { isNarrow } from "../render/scene.js";
import { otherOwners, synKey } from "../render/sync.js";
import { portrait } from "../render/portraits.js";
import { mySeat, myGold, myPv, myOffer } from "../game.js";
import { updateCards, passiveIcons } from "./cards.js";
import { updatePause } from "./pause.js";
import { $, ICON, toast, announce } from "./dom.js";
import { refreshCardArt } from "./input.js";
import { updateJoinCard, copyInvite } from "./join.js";
import { openSyn } from "./modals.js";

const AWAY = { cls: "slow", text: "немає зв’язку", title: "Гравець вийшов або втратив зв’язок. Його місце, золото й вежі чекають 3 хвилини" };
// how a seated player is reached from here, for the party list
function linkInfo(peer) {
  if (!peer || S.soloMode || peer === S.myPeer || !S.room || typeof S.room.links !== "function") return null;
  const l = S.room.links()[peer];
  if (!l) return null;
  const ms = l.rtt != null ? ` ${Math.round(l.rtt / 10) * 10} мс` : "";
  if (l.kind === "direct") return { cls: "ok", text: "пряме" + ms, title: "Пряме з’єднання між браузерами" };
  if (l.kind === "turn") return { cls: "turn", text: "TURN" + ms, title: "Через TURN-ретранслятор" };
  if (l.kind === "server") return { cls: "slow", text: "через сервер", title: "Пряме з’єднання не вдалося, дані йдуть через MQTT-сервер (повільно)" };
  return { cls: "wait", text: "з’єднання…", title: "Встановлюємо пряме з’єднання" };
}
let lastPartyKey = "", lastNextKey = "", lastSelKey = "", lastPhase = null, lastWave = null, lastGold = null;
export function updateUI(v, now) {
  const seat = mySeat(v);
  S.mySeat = seat;
  if (!TEST.noRender) refreshCardArt(seat);

  const seatedCount = v ? v.seats.filter(Boolean).length : 0;
  const lost = !S.soloMode && S.roomReady && !S.connected && S.disconnectedSince && now - S.disconnectedSince > 2000;
  $("net").className = "net " + (S.soloMode ? "" : lost ? "warn" : S.roomReady ? "on" : "");
  $("netText").textContent = !S.roomReady ? "Підключення…" : S.soloMode ? "Соло" : lost ? "Відновлюємо зв’язок…" : isNarrow() ? `${seatedCount}/${MAX_SEATS}` + (S.isHost ? " · хост" : S.rttMs !== null ? ` · ${Math.round(S.rttMs)} мс` : "") : `Онлайн · ${seatedCount} з ${MAX_SEATS}` + (S.isHost ? " · ви ведете гру" : S.rttMs !== null ? ` · відгук ${Math.round(S.rttMs)} мс` : "") + " · стіл";
  const showCode = !S.soloMode && S.roomReady && !!S.tableName;
  $("codeBtn").hidden = !showCode;
  if (showCode) $("codeTxt").textContent = S.tableName.slice(5).toUpperCase();

  // banner
  let main = v ? `Хвиля ${v.w}` : "Хвиля 0", sub = S.joined ? "Готуємо стіл…" : "Сідайте за стіл, щоб грати";
  if (v) {
    const occ = seatedCount, nReady = v.seats.reduce((a, s, i) => a + (s && v.ready[i] ? 1 : 0), 0);
    if (v.ph === 1 && v.w === 0) { main = "Підготовка"; sub = `Розставте вежі. Перша хвиля, коли всі готові (${nReady}/${occ})`; }
    else if (v.ph === 1) { main = `Перерва · ${Math.max(0, Math.ceil(v.tm))} с`; sub = `Хвиля ${v.w + 1} почнеться раніше, якщо всі готові (${nReady}/${occ})`; }
    else if (v.ph === 2) { const left = Math.max(0, waveTotal(v.w, v.pc) - v.sp) + v.enemies.length; sub = `Ворогів лишилось: ${left}`; }
    else if (v.ph === 3) { main = "Кристал розбито"; sub = `Команда дійшла до хвилі ${v.w}`; }
    else if (v.ph === 4) { main = "Перемога"; sub = "Кристал вистояв усі 20 хвиль"; }
  }
  if (v && v.pz && v.ph <= 2) { main = "Пауза"; sub = `Поставив(-ла) ${nameOfPeer(v.seats[v.pz - 1])}`; }
  updatePause(v);
  const wl = $("waveLine");
  wl.textContent = main;
  if (v && v.ph === 2 && !v.pz) { const s = document.createElement("span"); s.textContent = ` з ${MAX_WAVES}`; wl.appendChild(s); }
  $("phaseLine").textContent = sub;

  if (v && lastPhase !== null && v.ph === 2 && (lastPhase !== 2 || lastWave !== v.w)) {
    const boss = waveBosses(v.w, v.pc);
    announce(`Хвиля ${v.w}`, boss ? (boss > 1 ? `Колосів: ${boss}` : "Іде Колос") : v.w === MAX_WAVES ? "Остання" : "");
  }
  lastPhase = v ? v.ph : null; lastWave = v ? v.w : null;
  if (S.joined) advertise(v ? v.w : 0);

  // life gem
  $("lifeNum").textContent = String(v ? v.l : START_LIVES);
  $("lifeGem").classList.toggle("low", !!v && v.l <= 5);

  // ready button
  const rb = $("readyBtn"), rl = $("readyLbl"), rs = $("readySub");
  rb.classList.remove("nudge"); rb.title = "";
  if (v && v.ph <= 2 && myOffer(v).length) {
    // a card pick is waiting: the button opens it (and getting ready waits for it)
    rb.disabled = false; rb.classList.remove("on"); rb.classList.add("nudge");
    rl.textContent = "Карта"; rs.textContent = "оберіть 1 з 3";
  } else if (v && v.ph >= 3) { rb.disabled = seat < 0; rb.classList.remove("on"); rl.textContent = "Нова гра"; rs.textContent = "з хвилі 1"; }
  else if (v && v.ph === 1 && seat >= 0) {
    const pr2 = [...S.queue].reverse().find(q => q[1] === "r");
    const r = pr2 ? !!pr2[2] : v.ready[seat];
    const nReady = v.seats.reduce((a, s, i) => a + (s && v.ready[i] ? 1 : 0), 0);
    rb.disabled = false; rb.classList.toggle("on", r);
    if (!r && (v.w === 0 || nReady > 0)) rb.classList.add("nudge");
    rl.textContent = r ? "Готовий" : "До бою"; rs.textContent = `${nReady}/${seatedCount} готові`;
  } else if (v && v.ph === 2 && seat >= 0 && !v.pz) {
    // during a wave the button votes to finish it at once
    const pf = [...S.queue].reverse().find(q => q[1] === "f");
    const mine = pf ? !!pf[2] : !!(v.sk & (1 << seat));
    const voters = v.seats.filter(Boolean).length, n = v.seats.reduce((a, s, i) => a + (s && v.sk & (1 << i) ? 1 : 0), 0);
    rb.disabled = false; rb.classList.toggle("on", mine);
    rl.textContent = "Завершити"; rs.textContent = voters > 1 ? `хвилю · ${n}/${voters} за` : "хвилю зараз";
    rb.title = "Дограти хвилю миттєво (F). Результат той самий, просто не треба чекати";
  } else {
    rb.disabled = true; rb.classList.remove("on");
    rl.textContent = v && v.ph === 2 ? "Бій" : "До бою";
    rs.textContent = seat < 0 && S.joined ? "ви глядач" : v && v.ph === 2 ? `хвиля ${v.w}` : "—";
  }

  // gold & cards
  const g = seat >= 0 ? Math.floor(myGold(v)) : null;
  $("myGold").textContent = g === null ? "—" : String(g);
  if (g !== null && lastGold !== null && g > lastGold) { const p = $("purse"); p.classList.remove("bump"); void p.offsetWidth; p.classList.add("bump"); }
  lastGold = g;
  const pv = v ? myPv(v) : 0;
  TOWERS.forEach((t, i) => {
    const b = $("card" + i), cost = buildCost(pv, i);
    b.classList.toggle("sel", S.buildType === i);
    const ce = b.querySelector(".cost");
    if (ce.textContent !== String(cost)) ce.textContent = String(cost);
    b.classList.toggle("cheap", cost < t.cost);
    const poor = g !== null && g < cost;
    b.classList.toggle("poor", poor);
    const need = b.querySelector(".need");
    need.hidden = !poor;
    if (poor) need.textContent = `Бракує ${cost - g}`;
    b.disabled = seat < 0 || (v && v.ph > 2);
  });
  updateCards(v, g);

  // selected tower
  const tw = v && S.selCell >= 0 ? v.tmap.get(S.selCell) : null;
  const sc = $("selCard");
  if (!tw) { sc.hidden = true; if (S.selCell >= 0 && v) S.selCell = -1; lastSelKey = ""; }
  else {
    sc.hidden = false;
    const opv = tw.o >= 0 ? v.pv[tw.o] : 0, s = towerStatsFor(tw.ty, tw.lv, opv), syn = v.syn.get(tw.c) || 0;
    const key = [tw.c, tw.ty, tw.lv, tw.o, syn, v.seats[tw.o] ? nameOfPeer(v.seats[tw.o]) : "", g, seat, synKey, v.seats.join(","), opv, pv, tw.fr, v.ph].join("|");
    if (key !== lastSelKey) {
      lastSelKey = key;
      const url = TEST.noRender ? "" : portrait("t", tw.ty, tw.lv, tw.o); if (url) $("selImg").src = url;
      $("selTitle").textContent = TOWERS[tw.ty].name;
      const stars = $("selStars"); stars.textContent = "";
      for (let i = 0; i < 3; i++) { const sp = document.createElement("span"); sp.textContent = "★"; if (i >= tw.lv) sp.className = "off"; stars.appendChild(sp); }
      const owner = $("selOwner"); owner.textContent = "";
      const sw = document.createElement("span"); sw.className = "sw"; sw.style.setProperty("--c", SEAT_CSS[tw.o] || "#9b8a70");
      const on = document.createElement("span"); on.textContent = tw.o < 0 ? "нічия вежа" : v.seats[tw.o] ? nameOfPeer(v.seats[tw.o]) + (tw.o === seat ? " (ви)" : "") : "вільне місце";
      owner.append(sw, on);
      // current stats, and what the next level would give (upgrade preview)
      const nx = tw.lv < 3 ? towerStatsFor(tw.ty, tw.lv + 1, opv) : null, synK = 1 + SYN_BONUS * syn;
      const rows = [
        ["Шкода", (s.dmg * synK).toFixed(1), nx && (nx.dmg * synK).toFixed(1)],
        ["Постріл", `${s.rate.toFixed(2)} с`, nx && `${nx.rate.toFixed(2)} с`],
        ["Дальність", s.range.toFixed(1), nx && nx.range.toFixed(1)],
      ];
      if (tw.ty === 1) rows.push(["Вибух", String(+s.splash.toFixed(2)), null]);
      if (tw.ty === 2) rows.push(["Холод", `${s.slowDur.toFixed(1)} с`, nx && `${nx.slowDur.toFixed(1)} с`]);
      if (tw.ty === 3) rows.push(["Перескоки", String(s.chain), nx && String(nx.chain)]);
      rows.push(["Синергія", syn ? `+${Math.round(syn * SYN_BONUS * 100)}%` : "—", null]);
      const dl = $("selInfo"); dl.textContent = "";
      dl.classList.toggle("has-next", !!nx);
      for (const [k, val, next] of rows) {
        const dt = document.createElement("dt"); dt.textContent = k;
        const dd = document.createElement("dd"); dd.textContent = val; if (k === "Синергія" && syn) dd.className = "syn";
        if (next && next !== val) {
          const n = document.createElement("span"); n.className = "next"; n.textContent = `→ ${next}`;
          n.title = `Після покращення до рівня ${tw.lv + 1}`;
          dd.appendChild(n);
        }
        dl.append(dt, dd);
      }
      const up = $("upBtn"), sell = $("sellBtn");
      if (tw.lv >= 3) { up.textContent = "Максимум"; up.disabled = true; }
      else { const c = upCost(pv, tw.ty, tw.lv); up.textContent = `Покращити · ${c}`; up.disabled = seat < 0 || (g || 0) < c; }
      const undo = v.ph === 1 && tw.fr > 0;
      sell.textContent = undo ? `Скасувати · ${tw.fr}` : `Продати · ${sellFor(opv, tw.ty, tw.lv)}`;
      sell.title = undo ? "Вежу поставлено на цій перерві: усе золото повернеться" : "";
      sell.disabled = tw.o !== seat;
      $("selNote").textContent = tw.o === seat ? "" : "Покращення за ваше золото. За вбивства половина нагороди йде власнику, решта ділиться між усіма.";
      const sl = $("selSyn"); sl.textContent = "";
      const rel = otherOwners(v.tmap, tw.c, tw.o, tw.ty, tw.o >= 0 && !!(opv & (1 << P.unity)));
      if (rel.owners.size || rel.types.size) {
        sl.append("Підсилюють:");
        for (const o of rel.owners) {
          const w = document.createElement("span"); w.className = "who";
          const dot = document.createElement("i"); dot.style.setProperty("--c", SEAT_CSS[o] || "#9b8a70");
          w.append(dot, o < 0 ? "нічиї вежі" : v.seats[o] ? nameOfPeer(v.seats[o]) : "вільне місце");
          sl.appendChild(w);
        }
        if (rel.types.size) {
          const w = document.createElement("span"); w.className = "who";
          const dot = document.createElement("i"); dot.style.setProperty("--c", SEAT_CSS[tw.o] || "#9b8a70");
          w.append(dot, `свої вежі інших типів (${Math.min(rel.types.size, OWN_SYN_MAX)})`);
          sl.appendChild(w);
        }
      } else sl.append(opv & (1 << P.unity) ? "Поставте поруч свою вежу іншого типу або вежу іншого гравця: +15% за кожну." : v.seats.filter(Boolean).length > 1 ? "Поставте поруч вежу іншого гравця: +15% за кожного." : "Синергія з’явиться з карткою «Єдність» або коли поруч стоятимуть вежі інших гравців.");
      const lb = document.createElement("button"); lb.type = "button"; lb.className = "linkbtn"; lb.textContent = "Як працює синергія";
      lb.addEventListener("click", openSyn);
      sl.appendChild(lb);
    }
  }

  // party
  const rows = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    const peer = v ? v.seats[i] : "";
    const away = !!peer && !S.soloMode && peer !== S.myPeer && !S.peerList.some(p => p.peer === peer);
    rows.push([i, peer, peer ? nameOfPeer(peer) : "", v ? Math.floor(v.gold[i]) : 0, v ? v.kills[i] : 0, !!(v && v.ph === 1 && v.ready[i]), !S.soloMode && !!S.cur && S.cur.peer === peer, away ? AWAY : linkInfo(peer), away, v ? v.pv[i] : 0]);
  }
  const specs = S.peerList.filter(p => p.kind === "viewer" && !(v && v.seats.includes(p.peer))).length;
  const pkey = JSON.stringify([rows, seat, g !== null && g >= GIFT, v && v.ph, specs, S.soloMode, S.roomReady, S.tableName]);
  if (pkey !== lastPartyKey) {
    lastPartyKey = pkey;
    const ul = $("party"); ul.textContent = "";
    for (const [i, peer, nm, gold, kills, ready, host, link, away, ppv] of rows) {
      const li = document.createElement("li");
      li.className = "hero" + (peer ? "" : " empty") + (i === seat ? " me" : "") + (away ? " away" : "");
      if (!peer && !S.soloMode && S.roomReady && S.tableName) {
        const inv = document.createElement("button");
        inv.type = "button"; inv.className = "inv";
        inv.setAttribute("aria-label", "Запросити гравця на це місце: скопіювати посилання");
        const pt0 = document.createElement("span"); pt0.className = "portrait outlined"; pt0.textContent = "+";
        const pl0 = document.createElement("span"); pl0.className = "plate";
        const b0 = document.createElement("b"); b0.textContent = "Вільне місце";
        const s0 = document.createElement("small"); s0.textContent = "Запросити";
        pl0.append(b0, s0); inv.append(pt0, pl0);
        inv.addEventListener("click", copyInvite);
        li.appendChild(inv); ul.appendChild(li); continue;
      }
      const pt = document.createElement("span"); pt.className = "portrait outlined"; pt.style.setProperty("--c", SEAT_CSS[i]);
      pt.textContent = peer ? (nm.trim()[0] || "?").toUpperCase() : "·";
      const plate = document.createElement("span"); plate.className = "plate";
      const b = document.createElement("b"); b.textContent = peer ? nm : "Вільне місце";
      plate.appendChild(b);
      if (peer) {
        const sm = document.createElement("small");
        const gs = document.createElement("span"); gs.innerHTML = '<span class="coin-dot"></span>'; gs.append(String(gold));
        const ks = document.createElement("i"); ks.textContent = `${kills} вбивств`;
        sm.append(gs, ks);
        plate.appendChild(sm);
        if (ppv) plate.appendChild(passiveIcons(ppv));
        if (host || link) {
          const tg = document.createElement("span"); tg.className = "tag";
          if (link) { const lk = document.createElement("span"); lk.className = "lnk " + link.cls; lk.textContent = link.text; lk.title = link.title; tg.appendChild(lk); }
          if (host) tg.append((link ? " · " : "") + "веде гру");
          plate.appendChild(tg);
        }
        if (link) { const dot = document.createElement("span"); dot.className = "lnkdot " + link.cls; dot.title = link.title; li.appendChild(dot); }
      }
      li.append(pt, plate);
      if (ready) { const tk = document.createElement("span"); tk.className = "tick"; tk.innerHTML = ICON.tick; li.appendChild(tk); }
      if (peer && seat >= 0 && i !== seat && v && v.ph <= 2) {
        const gb = document.createElement("button"); gb.type = "button"; gb.className = "gift"; gb.textContent = `+${GIFT}`;
        gb.title = `Подарувати ${GIFT} золота`; gb.setAttribute("aria-label", `Подарувати ${GIFT} золота гравцю ${nm}`);
        gb.disabled = g === null || g < GIFT;
        gb.addEventListener("click", () => { act("g", i); toast(`Подаровано ${GIFT} золота`); });
        li.appendChild(gb);
      }
      ul.appendChild(li);
    }
    if (specs) { const sp = document.createElement("li"); sp.className = "spec"; sp.textContent = `Глядачів: ${specs}`; ul.appendChild(sp); }
  }

  // next wave
  const nkey = v ? `${v.w}|${v.ph}|${seatedCount}` : "none";
  if (nkey !== lastNextKey) {
    lastNextKey = nkey;
    const nw = $("nextWave"); nw.textContent = "";
    if (v && v.ph <= 2 && v.w < MAX_WAVES) {
      nw.hidden = false;
      const h3 = document.createElement("h3"); h3.textContent = `Наступна: хвиля ${v.w + 1}`; nw.appendChild(h3);
      const box = document.createElement("div"); box.className = "foes";
      waveMix(v.w + 1, Math.max(1, seatedCount)).forEach((n, i) => {
        if (!n) return;
        const f = document.createElement("span"); f.className = "foe" + (i === 3 ? " boss" : ""); f.title = ENEMIES[i].name;
        const img = document.createElement("img"); img.alt = ENEMIES[i].name; const url = TEST.noRender ? "" : portrait("e", i, 0, -1); if (url) img.src = url;
        f.append(img, `×${n}`);
        box.appendChild(f);
      });
      nw.appendChild(box);
    } else nw.hidden = true;
  }

  // end overlay
  const showEnd = !!v && v.ph >= 3 && $("joinOverlay").hidden;
  $("endOverlay").hidden = !showEnd;
  if (showEnd) {
    $("endSign").className = "sign wide " + (v.ph === 4 ? "win" : "lose");
    $("endTitle").textContent = v.ph === 4 ? "Перемога!" : "Кристал розбито";
    const total = v.kills.reduce((a, b) => a + b, 0), min = Math.max(1, Math.round(v.time / 30 / 60));
    $("endText").textContent = (v.ph === 4 ? `Усі ${MAX_WAVES} хвиль відбито.` : `Ви дійшли до хвилі ${v.w}.`) +
      ` Команда знищила ${total} ворогів, ${livesText(v.lost)}. Гра тривала ${min} хв.`;
    renderSummary(v, seat);
    $("newGameBtn").hidden = seat < 0;
  }
  if (!$("joinOverlay").hidden) updateJoinCard();
}


function livesText(n) {
  if (!n) return "кристал не втратив жодного життя";
  const few = n % 10 >= 1 && n % 10 <= 4 && !(n % 100 >= 11 && n % 100 <= 14);
  return `кристал утратив ${n} ${few ? "життя" : "життів"}`;
}
// The summary table after a game: one row per seat that played, the best value of each column marked.
let lastSummaryKey = "";
const fmt = x => Math.round(x).toLocaleString("uk-UA");
function renderSummary(v, seat) {
  const seats = [0, 1, 2, 3, 4].filter(i => v.seats[i] || v.kills[i] || v.dmg[i]);
  const key = JSON.stringify([v.ph, v.w, v.lost, seats, seats.map(i => [v.kills[i], v.dmg[i], v.gave[i]])]);
  if (key === lastSummaryKey) return;
  lastSummaryKey = key;
  const cols = [
    ["Вбивства", i => v.kills[i], String],
    ["Шкода", i => v.dmg[i], fmt],
    ["Золото", i => v.earn[i], fmt],
    ["Вежі", i => v.built[i], String],
    ["Магія", i => v.casts[i], String],
    ["Подаровано", i => v.gave[i], String],
  ];
  const tb = $("endStats"); tb.textContent = "";
  const head = tb.createTHead().insertRow();
  for (const h of ["Гравець", ...cols.map(c => c[0])]) { const th = document.createElement("th"); th.textContent = h; head.appendChild(th); }
  const body = tb.createTBody();
  for (const i of seats) {
    const r = body.insertRow();
    if (i === seat) r.className = "me";
    const c0 = r.insertCell(); c0.className = "who";
    const dot = document.createElement("i"); dot.style.setProperty("--c", SEAT_CSS[i]);
    c0.append(dot, v.seats[i] ? nameOfPeer(v.seats[i]) : "Гравець");
    for (const [, get, show] of cols) {
      const c = r.insertCell(), val = get(i), top = Math.max(...seats.map(get));
      c.textContent = show(val);
      if (seats.length > 1 && val > 0 && val === top) c.className = "top";
    }
  }
  const b = v.best;
  $("endBest").textContent = b ? `Найкраща вежа: ${TOWERS[b.ty].name} ${"★".repeat(b.lv)}` +
    (b.o >= 0 && v.seats[b.o] ? ` гравця ${nameOfPeer(v.seats[b.o])}` : "") + ` — ${fmt(b.dm)} шкоди` : "";
}

/** Forces the party list to rebuild, e.g. after web fonts load. */
export function invalidateParty() { lastPartyKey = ""; }
