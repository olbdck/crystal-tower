// Session: which table we are at, who hosts the game, and how state and actions flow.
//
// One player's tab (the host) runs the Sim and publishes snapshots about 10 times a second through
// its presence. Everyone sends their actions (build, upgrade, ready...) in their own presence; the host
// applies them and acknowledges them in the next snapshot. If the host leaves or goes silent, the next
// player takes over from the last snapshot.
import { Sim } from "../sim/sim.js";
import { STEP, TOWERS, ENEMIES, PATHS, synergyAt } from "../sim/rules.js";
import { NET_CONFIG } from "../config.js";
import { makeLobby, generatedHere } from "./transport.js";
import { predictEnemies, corr, corrOffset } from "./view.js";
import { S } from "../state.js";
import { toast } from "../ui/dom.js";
import { updateJoinCard, showJoin } from "../ui/join.js";

export const STEP_MS = STEP * 1000;
const PRESENCE_BUDGET = 3800, PUBLISH_MS = 100, HOST_STALE_MS = 3500;
const TERMINAL = new Set(["revoked", "not_granted", "capability_disabled", "capability_removed", "transform_error"]);
const isCoarse = (() => { try { return matchMedia("(pointer: coarse)").matches; } catch (_) { return false; } })();

let hostTimer = null, tickWorker = null, hostAcc = 0, lastHostTime = 0, lastPublish = 0;
let seq = Math.floor(Date.now() / 10) % 1e11;
const sentAt = new Map(), seenS = new Map(), lastTBy = new Map();
export const fxPending = []; // effects from snapshots, played when the view reaches their tick
export const lobbyTables = new Map();

/** Host's progress into the current tick, 0..1, for smooth rendering between ticks. */
export function hostAlpha() { return Math.min(1, hostAcc / STEP_MS); }

/* ---------- presence ---------- */
export function joinPresence() { return { n: S.myName, j: Date.now(), hid: document.hidden ? 1 : null, mob: isCoarse ? 1 : null }; }

export function setPresence(patch) {
  for (const k in patch) { if (patch[k] === null) delete S.myPres[k]; else S.myPres[k] = patch[k]; }
  if (!S.room) return;
  try { const p = S.room.presence(patch); if (p && p.catch) p.catch(() => {}); } catch (_) {}
}

function makeSoloRoom() {
  let pres = {}, me = mk(), list = [me];
  const handlers = new Set();
  function mk() { return Object.freeze({ peer: "solo", by: null, isMe: true, sameTab: true, kind: "viewer", guest: false, presence: Object.freeze({ ...pres }), updatedAt: Date.now() }); }
  return {
    solo: true,
    peers: () => list,
    presence(patch) {
      pres = { ...pres };
      for (const k in patch) { if (patch[k] === null) delete pres[k]; else pres[k] = patch[k]; }
      me = mk(); list = [me];
      queueMicrotask(() => handlers.forEach(h => h({ peers: list, joined: [], left: [], updated: [me] })));
      return Promise.resolve();
    },
    onPeers(h) { handlers.add(h); queueMicrotask(() => h({ peers: list, joined: list, left: [], updated: [] })); return () => handlers.delete(h); },
    connected: () => true,
  };
}

export const byJ = (a, b) => (a.presence.j - b.presence.j) || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0);
/** Players who sat down at the table, in joining order. */
export function joinedPeers(list) {
  return list.filter(p => p.kind === "viewer" && p.presence && typeof p.presence.j === "number" && Number.isFinite(p.presence.j)).sort(byJ);
}

export function cleanName(n) {
  if (typeof n !== "string") return "";
  return n.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, "").trim().slice(0, 16);
}
export function nameOfPeer(peer) {
  if (peer === S.myPeer) return S.myName || "Ви";
  const p = S.peerList.find(x => x.peer === peer);
  return (p && cleanName(p.presence && p.presence.n)) || "Гравець";
}

/* ---------- snapshots ---------- */
function validState(s) {
  return s && typeof s === "object" && s.v === 1 && Number.isFinite(s.e) && Number.isFinite(s.t) &&
    Array.isArray(s.T) && Array.isArray(s.E) && Array.isArray(s.st) && Array.isArray(s.g);
}
function better(peer, s) {
  if (!S.cur) return true;
  if (s.e !== S.cur.e) return s.e > S.cur.e;
  if (peer === S.cur.peer) return s.t > S.cur.t;
  return peer < S.cur.peer;
}

export function decodeState(s) {
  const towers = [], tmap = new Map(), enemies = [], emap = new Map();
  for (let i = 0; i + 3 < s.T.length; i += 4) {
    const tw = { c: s.T[i], ty: s.T[i + 1], lv: s.T[i + 2], o: s.T[i + 3] };
    if (!TOWERS[tw.ty] || !Number.isInteger(tw.c)) continue;
    towers.push(tw); tmap.set(tw.c, tw);
  }
  const hs = (Number.isFinite(s.hs) ? s.hs : 1000) / 1000;
  for (let i = 0; i + 5 < s.E.length; i += 6) {
    const e = { id: s.E[i], ty: s.E[i + 1], ln: s.E[i + 2], d: s.E[i + 3] / 100, hp: s.E[i + 4], sl: s.E[i + 5] / 10 };
    if (!ENEMIES[e.ty] || !PATHS[e.ln] || !Number.isFinite(e.d)) continue;
    e.mhp = ENEMIES[e.ty].hp * hs;
    enemies.push(e); emap.set(e.id, e);
  }
  const syn = new Map();
  for (const tw of towers) syn.set(tw.c, synergyAt(tmap, tw));
  const ready = [0, 1, 2, 3, 4].map(i => !!((s.r | 0) & (1 << i)));
  return {
    ph: s.ph, w: s.w | 0, l: s.l, tm: (s.tm || 0) / 10, sp: s.sp | 0, pc: Math.max(1, s.pc | 0), hs,
    seats: [0, 1, 2, 3, 4].map(i => (typeof s.st[i] === "string" ? s.st[i] : "")),
    gold: [0, 1, 2, 3, 4].map(i => (Number.isFinite(s.g[i]) ? s.g[i] : 0)),
    kills: [0, 1, 2, 3, 4].map(i => (Array.isArray(s.k) && Number.isFinite(s.k[i]) ? s.k[i] : 0)),
    ready, towers, tmap, enemies, emap, syn, t: s.t,
  };
}

function acceptState(peer, s) {
  const isNewEpoch = !S.cur || S.cur.e !== s.e, hostChanged = !!S.cur && S.cur.peer !== peer;
  const now = performance.now();
  const before = S.latest ? predictEnemies(S.latest, now) : null;
  S.cur = { peer, e: s.e, t: s.t };
  S.lastState = s; S.lastStateAt = now;
  S.latest = { t: s.t, dec: decodeState(s), at: now };
  // what we were showing vs. what the new snapshot says: keep the difference and let it fade, so nothing jumps
  if (before) {
    for (const [id, pnew] of predictEnemies(S.latest, now)) {
      const pold = before.get(id);
      if (pold && pold.ln === pnew.ln) {
        const off = pold.d + (corr.has(id) ? corrOffset(id, now) : 0) - pnew.d;
        if (Math.abs(off) < 1.5) corr.set(id, { off, at: now }); else corr.delete(id);
      }
    }
    if (corr.size > 150) for (const [id, c] of corr) if (now - c.at > 1000) corr.delete(id);
  }
  if (hostChanged && S.joined) toast(`Гру тепер веде ${nameOfPeer(peer)}`);
  if (Array.isArray(s.F)) for (let i = 0; i + 4 < s.F.length; i += 5) fxPending.push({ at: s.t, f: s.F.slice(i, i + 5) });
  if (fxPending.length > 120) fxPending.splice(0, fxPending.length - 120);
  handleAck(s.ak);
  if (isNewEpoch) S.uiDirty = true;
}

function handleAck(ak) {
  if (!Array.isArray(ak) || !S.myPeer) return;
  let x = null;
  for (let i = 0; i + 1 < ak.length; i += 2) if (ak[i] === S.myPeer) { x = ak[i + 1]; break; }
  if (x == null) return;
  const before = S.queue.length, now = performance.now();
  for (const q of S.queue) if (q[0] <= x && sentAt.has(q[0])) { const rtt = now - sentAt.get(q[0]); S.rttMs = S.rttMs === null ? rtt : S.rttMs * 0.7 + rtt * 0.3; }
  for (const k of [...sentAt.keys()]) if (k <= x) sentAt.delete(k);
  S.queue = S.queue.filter(q => q[0] > x);
  if (S.queue.length !== before) setPresence({ a: S.queue.length ? S.queue : null });
}

function onPeersChange(ch) {
  S.peerList = ch.peers;
  for (const p of ch.peers) if (p.sameTab) S.myPeer = p.peer;
  for (const p of ch.peers) {
    if (p.sameTab || p.kind !== "viewer") continue;
    const s = p.presence && p.presence.s;
    if (!s || seenS.get(p.peer) === s) continue;
    seenS.set(p.peer, s);
    let st = s;
    if (Array.isArray(s.T)) lastTBy.set(p.peer, s.T);
    else if (lastTBy.has(p.peer)) st = { ...s, T: lastTBy.get(p.peer) };
    else continue;
    if (!validState(st) || !better(p.peer, st)) continue;
    if (S.isHost) stepDown(true);
    acceptState(p.peer, st);
  }
  for (const p of ch.left || []) seenS.delete(p.peer);
  if (S.isHost && S.sim) { const n = processActions(ch.peers); if (n) { const now = performance.now(); if (now - lastPublish >= 30) publish(now); } }
  decideHost();
  S.uiDirty = true;
}

function onRoomError(err) {
  if (err && TERMINAL.has(err.code) && !S.soloMode) goSolo("Кімната недоступна в цьому перегляді, граємо соло");
}

/* ---------- hosting ---------- */
// Who runs the game. The current host keeps the job for as long as its state keeps arriving, even if its tab
// is in the background (the simulation ticks from a worker, which browsers do not throttle). Only when the host
// leaves, or its state stops for HOST_STALE_MS, the next player takes over: visible tabs first, then desktops
// before phones, then whoever joined earliest.
const hostRank = p => (p.presence.hid ? 2 : 0) + (p.presence.mob ? 1 : 0);
export function decideHost() {
  if (!S.room || !S.myPeer) return;
  if (!S.joined) { if (S.isHost) stepDown(true); return; }
  if (S.isHost) return;
  const now = performance.now();
  const live = joinedPeers(S.peerList);
  const hostPeer = S.cur ? live.find(p => p.peer === S.cur.peer && p.presence.s) : null;
  if (hostPeer && now - S.lastStateAt < HOST_STALE_MS) return;
  // the host looks silent: make sure it is not our own connection that dropped
  if (hostPeer && (!S.connected || !S.connectedSince || now - S.connectedSince < 5000)) return;
  const pool = live.filter(p => p !== hostPeer).sort((a, b) => hostRank(a) - hostRank(b) || byJ(a, b));
  if (pool.length && pool[0].peer === S.myPeer) becomeHost();
}
function startTicker() {
  stopTicker();
  try {
    const src = "let t=0;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data);};";
    tickWorker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    tickWorker.onmessage = hostLoop;
    tickWorker.postMessage(33);
  } catch (_) { tickWorker = null; hostTimer = setInterval(hostLoop, 33); }
}
function stopTicker() {
  if (tickWorker) { try { tickWorker.terminate(); } catch (_) {} tickWorker = null; }
  if (hostTimer) { clearInterval(hostTimer); hostTimer = null; }
}

let onHostFx = null;
/** Called by the renderer to see the host's own effects as they happen. */
export function setHostFxHandler(fn) { onHostFx = fn; }

function becomeHost() {
  S.isHost = true;
  S.sim = S.lastState ? Sim.fromSnapshot(S.lastState) : new Sim();
  S.sim.e = (S.cur ? S.cur.e : 0) + 1;
  pubTv = -1;
  S.sim.onFx = f => { if (onHostFx) onHostFx(f); };
  hostAcc = 0; lastHostTime = performance.now(); lastPublish = 0;
  if (S.cur && S.cur.peer !== S.myPeer && S.joined) toast("Тепер гру ведете ви");
  startTicker();
  hostLoop();
  S.uiDirty = true;
}

function stepDown(clearPresence) {
  if (!S.isHost) return;
  S.isHost = false;
  stopTicker();
  if (S.sim) {
    const s = S.sim.serialize();
    S.lastState = s;
    S.latest = { t: s.t, dec: decodeState(s), at: performance.now() };
    corr.clear();
  }
  S.sim = null;
  if (clearPresence) setPresence({ s: null });
  S.uiDirty = true;
}

function hostLoop() {
  if (!S.isHost || !S.sim) return;
  const now = performance.now();
  hostAcc += Math.min(now - lastHostTime, 3000); lastHostTime = now;
  const list = S.room.peers();
  S.sim.assignSeats(joinedPeers(list).map(p => p.peer));
  const applied = processActions(list);
  let n = 0;
  while (hostAcc >= STEP_MS && n < 90) { S.sim.step(STEP); hostAcc -= STEP_MS; n++; }
  if (hostAcc >= STEP_MS) hostAcc = 0;
  if (now - lastPublish >= PUBLISH_MS || (applied && now - lastPublish >= 30)) publish(now);
}

function processActions(list) {
  let applied = 0;
  for (const p of list) {
    if (p.kind !== "viewer") continue;
    const a = p.presence && p.presence.a;
    if (!Array.isArray(a)) continue;
    const seat = S.sim.seats.indexOf(p.peer);
    let last = S.sim.ak.get(p.peer) || 0;
    const items = a.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && x[0] > last).sort((x, y) => x[0] - y[0]);
    for (const it of items) { if (seat >= 0) S.sim.apply(seat, it); last = it[0]; applied++; }
    if (items.length) S.sim.ak.set(p.peer, last);
  }
  return applied;
}

const enc = new TextEncoder();
let pubTv = -1, pubN = 0;
function publish(now) {
  lastPublish = now;
  const full = S.sim.serialize(), s = { ...full };
  // towers rarely change: send them when they do, and every 2 s for anyone who missed it
  pubN++;
  if (S.sim.tv === pubTv && pubN % 20 !== 0) delete s.T; else pubTv = S.sim.tv;
  const size = () => enc.encode(JSON.stringify({ ...S.myPres, s })).length;
  if (size() > PRESENCE_BUDGET) { s.F = []; }
  while (size() > PRESENCE_BUDGET && s.E.length) s.E.length -= 6;
  S.cur = { peer: S.myPeer, e: s.e, t: s.t };
  S.lastState = full;
  setPresence({ s });
  handleAck(s.ak);
}

/** Send one of our actions to the host: ["b", cell, type], ["u", cell], ["s", cell], ["r", 0|1], ["g", seat], ["n"]. */
export function act(code, a1, a2) {
  if (!S.joined) return;
  seq++;
  const it = [seq, code];
  if (a1 !== undefined) it.push(a1);
  if (a2 !== undefined) it.push(a2);
  S.queue.push(it);
  sentAt.set(seq, performance.now());
  if (S.queue.length > 16) S.queue.shift();
  setPresence({ a: S.queue });
}

/* ---------- tables ---------- */
export const PAGE_URL = location.href.split("#")[0];
export const TABLE_RE = /^stil-[a-z0-9]{4,16}$/;
let lastAdvKey = "", pendingTable = null;

function newTableName() {
  const a = new Uint8Array(6), abc = "abcdefghijkmnpqrstuvwxyz23456789";
  try { crypto.getRandomValues(a); } catch (_) { for (let i = 0; i < 6; i++) a[i] = (Math.random() * 256) | 0; }
  const name = "stil-" + NET_CONFIG.brokers[0].id + Array.from(a.slice(1), x => abc[x % abc.length]).join("");
  generatedHere.add(name);
  return name;
}
function hashTable() { const h = (location.hash || "").slice(1).toLowerCase(); return TABLE_RE.test(h) ? h : null; }
export function inviteLink() { return S.tableName ? PAGE_URL + "#" + S.tableName : PAGE_URL; }
function onTableError(err) {
  if (!err || S.soloMode) return;
  if (err.code === "upstream_error" || err.code === "limit_reached") { const n = S.tableName; setTimeout(() => { if (n && n === S.tableName && !S.switching) enterTable(n); }, 1500); }
  else if (err.code === "not_permitted" || TERMINAL.has(err.code)) goSolo("Зв’язок зі столом втрачено, граємо соло");
}
function onLobbyPeers(ch) {
  lobbyTables.clear();
  for (const p of ch.peers) {
    if (p.kind !== "viewer" || !p.presence) continue;
    const t = p.presence.t;
    if (typeof t !== "string" || !TABLE_RE.test(t)) continue;
    const e = lobbyTables.get(t) || { names: [], count: 0, w: 0 };
    e.count++;
    const nm = cleanName(p.presence.n);
    if (nm && e.names.length < 5) e.names.push(nm);
    if (Number.isFinite(p.presence.w)) e.w = Math.max(e.w, p.presence.w | 0);
    lobbyTables.set(t, e);
  }
  S.uiDirty = true;
}
export function advertise(w) {
  if (!S.lobby || S.soloMode) return;
  const patch = S.joined && S.tableName ? { t: S.tableName, n: S.myName, w: w | 0 } : { t: null, n: null, w: null };
  const key = JSON.stringify(patch);
  if (key === lastAdvKey) return;
  lastAdvKey = key;
  try { const pr = S.lobby.presence(patch); if (pr && pr.catch) pr.catch(() => {}); } catch (_) {}
}
function runPendingTable() {
  if (pendingTable && pendingTable !== S.tableName && !S.switching) { const n = pendingTable; pendingTable = null; enterTable(n); }
  else pendingTable = null;
}
export async function enterTable(name) {
  if (!S.lobby || S.soloMode) return;
  if (S.switching) { pendingTable = name; return; }
  S.switching = true; S.roomReady = false; S.uiDirty = true;
  if (S.isHost) { stopTicker(); S.isHost = false; S.sim = null; }
  const old = S.room; S.room = null;
  if (old && old !== S.lobby && typeof old.leave === "function") { try { await old.leave(); } catch (_) {} }
  S.cur = null; S.lastState = null; S.latest = null; corr.clear(); sentAt.clear(); S.rttMs = null; seenS.clear(); lastTBy.clear();
  S.queue = []; S.peerList = []; fxPending.length = 0; S.myPres = {};
  S.selCell = -1; S.buildType = -1; S.armedCell = -1;
  let t = null;
  try { t = await S.lobby.join(name); } catch (_) { t = null; }
  S.switching = false;
  if (!t) {
    S.netFailed = name; S.joined = false;
    showJoin();
    updateJoinCard(); S.uiDirty = true;
    if (pendingTable && pendingTable !== name) { S.netFailed = null; runPendingTable(); }
    return;
  }
  S.netFailed = null;
  S.tableName = t.name || name;
  if (hashTable() !== S.tableName) { try { location.hash = S.tableName; } catch (_) {} }
  attachRoom(t, onTableError);
  S.roomReady = true;
  if (S.joined) setPresence(joinPresence());
  advertise(0);
  updateJoinCard(); S.uiDirty = true;
  runPendingTable();
}

function attachRoom(r, onErr) {
  S.room = r;
  r.onPeers(onPeersChange, onErr || onRoomError);
  if (r.onConnection) r.onConnection(c => {
    S.connected = c;
    if (!c && !S.disconnectedSince) S.disconnectedSince = performance.now();
    if (c) S.disconnectedSince = 0;
    if (c && !S.connectedSince) S.connectedSince = performance.now();
    if (!c) S.connectedSince = 0;
    S.uiDirty = true;
  }, onErr || onRoomError);
}

export function goSolo(reason) {
  if (S.isHost) { stopTicker(); if (S.sim) S.lastState = S.sim.serialize(); S.isHost = false; S.sim = null; }
  const old = S.room;
  if (old && old !== S.lobby && typeof old.leave === "function") { try { const pr = old.leave(); if (pr && pr.catch) pr.catch(() => {}); } catch (_) {} }
  S.soloMode = true; S.cur = null; seenS.clear(); S.myPeer = "solo"; S.queue = []; S.peerList = []; S.myPres = {}; S.tableName = null;
  if (S.lastState) S.lastState = { ...S.lastState, ak: [] };
  attachRoom(makeSoloRoom());
  S.roomReady = true;
  if (S.joined) setPresence({ n: S.myName, j: Date.now() });
  if (reason) toast(reason);
  updateJoinCard();
  S.uiDirty = true;
}

/** Sit down at the current table with the given name. */
export function sitDown(name) {
  S.myName = name;
  S.joined = true;
  setPresence(joinPresence());
  setTimeout(decideHost, 60);
  advertise(S.lastState ? S.lastState.w : 0);
  S.uiDirty = true;
}

export async function initNet() {
  setInterval(decideHost, 500);
  document.addEventListener("visibilitychange", () => { if (S.joined) setPresence({ hid: document.hidden ? 1 : null }); });
  S.lobby = makeLobby();
  if (S.lobby.onPeers) S.lobby.onPeers(onLobbyPeers, onRoomError);
  const h = hashTable();
  S.invitedByHash = !!h;
  await enterTable(h || newTableName());
  window.addEventListener("hashchange", () => { const n = hashTable(); if (n && n !== S.tableName && !S.soloMode && !S.switching) { S.invitedByHash = true; enterTable(n); } });
}
