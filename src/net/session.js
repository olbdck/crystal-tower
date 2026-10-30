// Session: which table we are at, who hosts the game, and how the game reaches everyone.
//
// One player's tab (the host) runs the Sim and decides. It streams the simulation's inputs (ticks,
// who sits where, each action it applied) to the others in small binary batches about 30 times a
// second; every other tab replays them on its own copy of the Sim and gets the same game, effects
// included. A keyframe (the full state) starts a copy: on joining, after a gap, and when the host
// changes. Players send their actions in their presence; the host applies them and the stream
// carries the acknowledgement. If the host leaves or goes silent, the next player takes over from
// its own copy. See src/net/codec.js for the messages and src/net/stream.js for the replay.
import { Sim } from "../sim/sim.js";
import { STEP } from "../sim/rules.js";
import { NET_CONFIG, BUILD } from "../config.js";
import { makeLobby, generatedHere } from "./transport.js";
import { MSG_BATCH, MSG_KEYFRAME, MSG_REQ, decodeBatch, decodeKeyframe, peek, unbundle } from "./codec.js";
import { Follower, Recorder } from "./stream.js";
import { S } from "../state.js";
import { toast } from "../ui/dom.js";
import { updateJoinCard, showJoin, tryRejoin } from "../ui/join.js";

export const STEP_MS = STEP * 1000;
// Take over when the host's stream stops for this long; much sooner once its direct channel closed.
const HOST_STALE_MS = 3500, HOST_STALE_DIRECT_MS = 2000, HOST_GONE_MS = 1200;
const KF_RETAIN_MS = 5000; // how often the host refreshes the keyframe kept on the broker
const KF_REQUEST_MS = 600; // at most one keyframe request per this long
const TERMINAL = new Set(["revoked", "not_granted", "capability_disabled", "capability_removed", "transform_error"]);
const isCoarse = (() => { try { return matchMedia("(pointer: coarse)").matches; } catch (_) { return false; } })();

let quietFx = false;
let ticker = null, hostAcc = 0, lastHostTime = 0, hostLinkLostAt = -1e9, hostSince = 0;
let seq = Math.floor(Date.now() / 10) % 1e11;
const sentAt = new Map();
export const lobbyTables = new Map();

const follower = new Follower(); // replays the host's game while we do not host
let rec = null; // records every change to our Sim while we host
let lastRetain = 0, lastKfRequest = -1e9, lastAck = null;
const kfSentTo = new Map(); // label -> when we last sent them a keyframe on request
const heldKf = new Map(); // label -> { bytes, at }: keyframe from a player whose presence does not say "host" yet
const announcedAt = new Map(); // "label:epoch" -> when we first saw a player announce hosting that game
/** Stream traffic, for tests and the curious: bytes and messages in and out. */
export const netStats = { in: 0, out: 0, inMsgs: 0, outMsgs: 0 };

/** Progress into the current tick, 0..1, for smooth rendering between ticks. */
export function viewAlpha(now) {
  if (S.isHost) return Math.min(1, (hostAcc + Math.max(0, now - lastHostTime)) / STEP_MS);
  return follower.alpha(now);
}

/* ---------- presence ---------- */
export function joinPresence() {
  return { n: S.myName, j: Date.now(), hid: document.hidden ? 1 : null, mob: isCoarse ? 1 : null, v: BUILD.id, vt: BUILD.t };
}

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
    stream: { on: () => () => {}, send() {}, sendTo() {}, retain() {}, request() {} },
  };
}

export const byJ = (a, b) => (a.presence.j - b.presence.j) || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0);
const sat = p => p.kind === "viewer" && p.presence && typeof p.presence.j === "number" && Number.isFinite(p.presence.j);
/** Same build as ours. Players on another build never get a seat or the host role here. */
export const sameBuild = p => p.sameTab || (p.presence && p.presence.v === BUILD.id);
/** Players who sat down at the table on our build, in joining order. */
export function joinedPeers(list) { return list.filter(p => sat(p) && sameBuild(p)).sort(byJ); }
/** The game a player says it hosts (epoch), or null. */
const hostsEpoch = p => (p && p.presence && Number.isInteger(p.presence.H) ? p.presence.H : null);

/* ---------- version check ---------- */
// The table runs the build of its host, or of whoever sat down first when nobody hosts yet.
// A player on another build cannot sit down and is told whose page needs a refresh.
function updateVersionCheck() {
  let block = null;
  const others = S.peerList.filter(p => !p.sameTab && sat(p));
  if (!S.isHost) {
    const host = S.cur && others.find(p => p.peer === S.cur.peer);
    const ref = host || (S.joined ? null : others.slice().sort(byJ)[0]);
    if (ref && !sameBuild(ref) && !others.some(p => sameBuild(p) && hostsEpoch(p) !== null)) {
      block = { newer: (BUILD.t || 0) > (ref.presence.vt || 0), name: cleanName(ref.presence.n) || "Гравець" };
    }
  }
  if (JSON.stringify(block) !== JSON.stringify(S.versionBlock)) { S.versionBlock = block; updateJoinCard(); S.uiDirty = true; }
  // tell the players who sit here that someone on another build is waiting
  for (const p of S.peerList) if (!p.sameTab && p.presence && p.presence.v && !sameBuild(p) && !warnedBuild.has(p.peer) && S.joined) {
    warnedBuild.add(p.peer);
    const nm = cleanName(p.presence.n) || "Гравець";
    toast((p.presence.vt || 0) > (BUILD.t || 0)
      ? `${nm} має новішу версію гри й не може сісти. Оновіть сторінку між партіями`
      : `${nm} має стару версію гри: попросіть оновити сторінку`);
  }
}
const warnedBuild = new Set();

export function cleanName(n) {
  if (typeof n !== "string") return "";
  return n.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "").trim().slice(0, 16);
}
const knownNames = new Map(); // remembers names of players who dropped out, for the party list
export function nameOfPeer(peer) {
  if (peer === S.myPeer) return S.myName || "Ви";
  const p = S.peerList.find(x => x.peer === peer);
  return (p && cleanName(p.presence && p.presence.n)) || knownNames.get(peer) || "Гравець";
}

/* ---------- the game stream (receiving) ---------- */
// Which of two hosted games wins: the newer epoch, then the smaller player id. Everyone picks the same.
function betterStream(peer, e) {
  if (!S.cur) return true;
  if (e !== S.cur.e) return e > S.cur.e;
  return peer < S.cur.peer;
}

function requestKeyframe(label, now) {
  if (!S.room || !S.room.stream || now - lastKfRequest < KF_REQUEST_MS) return;
  lastKfRequest = now;
  S.room.stream.request(label);
}

function onStream(label, bytes) {
  if (!S.room || label === S.myPeer) return;
  netStats.in += bytes.length; netStats.inMsgs++;
  let list;
  try { list = unbundle(bytes); } catch (_) { return; }
  for (const m of list) onStreamMessage(label, m, performance.now());
}

function onStreamMessage(label, m, now) {
  let h;
  try { h = peek(m); } catch (_) { return; }
  if (h.type === MSG_REQ) { if (S.isHost) sendKeyframeTo(label, now); return; }
  const peer = S.peerList.find(p => p.peer === label);
  // only a player whose presence says it hosts this very game is listened to; this also skips
  // keyframes left on the broker by a host that is gone
  const hosting = !!peer && sat(peer) && sameBuild(peer) && hostsEpoch(peer) === h.e;
  if (h.type === MSG_KEYFRAME) {
    // its presence may still be on the way: keep the keyframe a few seconds
    if (!hosting) { if (!peer || sameBuild(peer)) heldKf.set(label, { bytes: m, e: h.e, at: (heldKf.get(label) || { at: now }).at }); return; }
    if (S.cur && S.cur.peer === label && S.cur.e === h.e && !follower.needsKeyframe) { S.lastStateAt = now; return; } // in step already
    let kf;
    try { kf = decodeKeyframe(m); } catch (_) { return; }
    if (kf.build === BUILD.id) takeKeyframe(label, kf, now);
  } else if (h.type === MSG_BATCH) {
    if (S.cur && label === S.cur.peer && h.e === S.cur.e) {
      S.lastStateAt = now;
      let b;
      try { b = decodeBatch(m); } catch (_) { return; }
      follower.push(b, now);
      if (follower.needsKeyframe) requestKeyframe(label, now);
    } else if (hosting && betterStream(label, h.e)) requestKeyframe(label, now);
  }
}

function takeKeyframe(label, kf, now) {
  const same = !!S.cur && S.cur.peer === label && S.cur.e === kf.e;
  if (same) {
    S.lastStateAt = now;
    if (S.isHost || !follower.needsKeyframe || kf.seq + 1 < follower.next) return; // in step, or an older keyframe
  } else if (!betterStream(label, kf.e)) return;
  const hostChanged = !!S.cur && S.cur.peer !== label;
  if (S.isHost) stepDown();
  else if (S.myPres.H != null) setPresence({ H: null }); // we stopped hosting without noticing (a frozen tab)
  S.cur = { peer: label, e: kf.e };
  S.lastStateAt = now;
  follower.load(kf, now, same);
  S.sim = follower.sim;
  heldKf.delete(label);
  if (hostChanged && S.joined) toast(`Гру тепер веде ${nameOfPeer(label)}`);
  S.uiDirty = true;
}

/** A player announced hosting a game we do not follow yet: ask for its keyframe. */
function watchHosts(now) {
  for (const [label, k] of [...heldKf]) {
    const p = S.peerList.find(x => x.peer === label);
    if (now - k.at > 5000) heldKf.delete(label);
    else if (p && sat(p) && sameBuild(p) && hostsEpoch(p) === k.e) { heldKf.delete(label); onStreamMessage(label, k.bytes, now); }
  }
  const hosts = S.peerList.filter(p => !p.sameTab && hostsEpoch(p) !== null && sat(p) && sameBuild(p))
    .sort((a, b) => hostsEpoch(b) - hostsEpoch(a) || (a.peer < b.peer ? -1 : 1));
  const best = hosts[0];
  if (!best) return;
  const e = hostsEpoch(best);
  if (betterStream(best.peer, e) || (S.cur && S.cur.peer === best.peer && S.cur.e === e && follower.needsKeyframe)) requestKeyframe(best.peer, now);
}

function handleAck(x) {
  if (!Number.isFinite(x) || x === lastAck) return;
  lastAck = x;
  const before = S.queue.length, now = performance.now();
  for (const q of S.queue) if (q[0] <= x && sentAt.has(q[0])) { const rtt = now - sentAt.get(q[0]); S.rttMs = S.rttMs === null ? rtt : S.rttMs * 0.7 + rtt * 0.3; }
  for (const k of [...sentAt.keys()]) if (k <= x) sentAt.delete(k);
  S.queue = S.queue.filter(q => q[0] > x);
  if (S.queue.length !== before) setPresence({ a: S.queue.length ? S.queue : null });
}
const ackFromSim = () => { if (S.sim && S.myPeer) handleAck(S.sim.ak.get(S.myPeer)); };

/** Replays the host's stream up to now. Runs from the ticker and before every frame. */
export function pump(now) {
  if (S.isHost || !follower.sim) return;
  follower.advance(now);
  if (follower.changed) { follower.changed = false; ackFromSim(); }
  if (follower.needsKeyframe && S.cur && S.cur.peer !== S.myPeer) requestKeyframe(S.cur.peer, now);
}

function onPeersChange(ch) {
  S.peerList = ch.peers;
  for (const p of ch.peers) {
    if (p.sameTab) S.myPeer = p.peer;
    const nm = p.presence && cleanName(p.presence.n);
    if (nm) knownNames.set(p.peer, nm);
  }
  const now = performance.now();
  watchHosts(now);
  updateVersionCheck();
  if (S.isHost && rec) { if (processActions(ch.peers)) { flushStream(); ackFromSim(); } }
  decideHost();
  S.uiDirty = true;
}

function onRoomError(err) {
  if (err && TERMINAL.has(err.code) && !S.soloMode) goSolo("Кімната недоступна в цьому перегляді, граємо соло");
}

/* ---------- hosting ---------- */
// Who runs the game. The current host keeps the job for as long as its stream keeps arriving, even if its tab
// is in the background (the simulation ticks from a worker, which browsers do not throttle). Only when the host
// leaves, or its stream stops for HOST_STALE_MS, the next player takes over: visible tabs first, then desktops
// before phones, then whoever joined earliest.
const hostRank = p => (p.presence.hid ? 2 : 0) + (p.presence.mob ? 1 : 0);
export function decideHost() {
  if (!S.room || !S.myPeer) return;
  if (!S.joined) { if (S.isHost) stepDown(); return; }
  if (S.isHost) return;
  const now = performance.now();
  const live = joinedPeers(S.peerList);
  let hostPeer = S.cur ? live.find(p => p.peer === S.cur.peer && hostsEpoch(p) === S.cur.e) : null;
  if (!hostPeer) {
    // someone says they host a game we have not received yet: give their keyframe time to arrive
    const ann = live.filter(p => !p.sameTab && hostsEpoch(p) !== null).sort((a, b) => hostsEpoch(b) - hostsEpoch(a) || (a.peer < b.peer ? -1 : 1))[0];
    if (ann) {
      const key = ann.peer + ":" + hostsEpoch(ann);
      if (!announcedAt.has(key)) announcedAt.set(key, now);
      if (now - announcedAt.get(key) < HOST_STALE_MS) { requestKeyframe(ann.peer, now); return; }
      hostPeer = ann; // it never sent anything: treat it as a silent host
    }
  }
  // over a direct channel the host's stream arrives steadily, so silence means trouble sooner;
  // a closed channel to the host (tab closed, connection lost) means trouble right away
  const linkGone = now - hostLinkLostAt < 8000;
  const direct = hostPeer && S.room.links && /^(direct|turn)$/.test((S.room.links()[hostPeer.peer] || {}).kind || "");
  const staleAfter = linkGone ? HOST_GONE_MS : direct ? HOST_STALE_DIRECT_MS : HOST_STALE_MS;
  const following = hostPeer && S.cur && hostPeer.peer === S.cur.peer;
  if (following && now - S.lastStateAt < staleAfter) return;
  // the host looks silent through the broker: make sure it is not our own broker connection that dropped
  if (hostPeer && !linkGone && !direct && (!S.connected || !S.connectedSince || now - S.connectedSince < 5000)) return;
  const pool = live.filter(p => p !== hostPeer).sort((a, b) => hostRank(a) - hostRank(b) || byJ(a, b));
  if (pool.length && pool[0].peer === S.myPeer) becomeHost();
}
/** Internals for tests and debugging. */
export function hostDebug() {
  return { hostLinkLostAt, hostSince, lastStateAt: S.lastStateAt, now: performance.now(), net: { ...netStats }, follow: { ...follower.stats, buffer: follower.buffer, lag: follower.lag } };
}

// One timer drives the game: the host's simulation, or the replay of the host's stream. It runs in a
// worker because browsers throttle timers in background tabs, but not in workers.
function startTicker() {
  if (ticker) return;
  const tick = () => { if (S.isHost) hostLoop(); else pump(performance.now()); };
  try {
    const src = "setInterval(()=>postMessage(0),33);";
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    w.onmessage = tick;
    ticker = w;
  } catch (_) { ticker = setInterval(tick, 33); }
}

let onFx = null;
/** The renderer's handler for effects (shots, explosions, deaths) from the local copy of the game. */
export function setFxHandler(fn) { onFx = fn; follower.onFx = fn; }

function becomeHost() {
  const now = performance.now();
  follower.catchUp(); // start from the newest state we received
  const sim = follower.sim || S.sim || new Sim();
  follower.reset();
  S.sim = sim;
  sim.e = (S.cur ? S.cur.e : 0) + 1;
  sim.onFx = f => { if (onFx && !quietFx) onFx(f); };
  const prev = S.cur;
  S.isHost = true; hostSince = now;
  S.cur = { peer: S.myPeer, e: sim.e };
  rec = new Recorder(sim); kfSentTo.clear();
  hostAcc = 0; lastHostTime = now;
  setPresence({ H: sim.e });
  // everyone switches to our game: a keyframe directly to each player and one kept on the broker
  const kf = makeKeyframe();
  S.room.stream.send(kf); S.room.stream.retain(kf); lastRetain = now;
  countOut(kf);
  if (prev && prev.peer !== S.myPeer && S.joined) toast("Тепер гру ведете ви");
  hostLoop();
  S.uiDirty = true;
}

/** Stop hosting; our copy stays on screen until the other host's keyframe replaces it. */
function stepDown() {
  if (!S.isHost) return;
  S.isHost = false; rec = null;
  setPresence({ H: null });
  if (S.room && S.room.stream) S.room.stream.retain(null);
  S.uiDirty = true;
}

function countOut(bytes) { netStats.out += bytes.length; netStats.outMsgs++; }

function hostLoop() {
  if (!S.isHost || !rec) return;
  const now = performance.now();
  hostAcc += Math.min(now - lastHostTime, 3000); lastHostTime = now;
  const list = S.room.peers();
  syncRoster(list);
  processActions(list);
  let n = 0;
  while (hostAcc >= STEP_MS && n < 90) { rec.step(); hostAcc -= STEP_MS; n++; }
  if (hostAcc >= STEP_MS) hostAcc = 0;
  // everyone voted to finish the wave: play the rest of it at once (a minute of game per loop at most);
  // the other players' copies skip ahead the same way, without effects
  if (S.sim.finishing()) {
    quietFx = true;
    for (let k = 0; k < 30 * 60 && S.sim.finishing(); k++) rec.step();
    quietFx = false;
  }
  flushStream();
  if (now - lastRetain > KF_RETAIN_MS) { lastRetain = now; S.room.stream.retain(makeKeyframe()); }
  ackFromSim();
}

// Every change to the host's Sim goes through the recorder, so the stream carries it to everyone.
function syncRoster(list) { rec.roster(joinedPeers(list).map(p => p.peer)); }

function processActions(list) {
  let applied = 0;
  for (const p of list) {
    if (p.kind !== "viewer") continue;
    const a = p.presence && p.presence.a;
    if (!Array.isArray(a)) continue;
    const items = a.filter(x => Array.isArray(x) && Number.isSafeInteger(x[0])).sort((x, y) => x[0] - y[0]);
    for (const it of items) if (rec.act(p.peer, it)) applied++;
  }
  return applied;
}

/** Sends the inputs collected since the last batch. */
function flushStream() {
  if (!S.isHost || !rec) return;
  const bytes = rec.batch();
  if (!bytes) return;
  S.room.stream.send(bytes);
  countOut(bytes);
}
function makeKeyframe() {
  flushStream();
  return rec.keyframe(BUILD.id);
}
function sendKeyframeTo(label, now) {
  if (now - (kfSentTo.get(label) || -1e9) < 300) return;
  kfSentTo.set(label, now);
  const kf = makeKeyframe();
  S.room.stream.sendTo(label, kf);
  countOut(kf);
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

export function newTableName() {
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
  S.isHost = false; rec = null; S.sim = null; follower.reset();
  const old = S.room; S.room = null;
  if (old && old !== S.lobby && typeof old.leave === "function") { try { await old.leave(); } catch (_) {} }
  S.cur = null; sentAt.clear(); S.rttMs = null; S.versionBlock = null; lastAck = null;
  heldKf.clear(); kfSentTo.clear(); announcedAt.clear();
  S.queue = []; S.peerList = []; S.myPres = {};
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
  // our build is visible even before we sit down, so players on another build can be told early
  setPresence(S.joined ? joinPresence() : { v: BUILD.id, vt: BUILD.t });
  advertise(0);
  updateJoinCard(); S.uiDirty = true;
  if (!S.joined && wasSeatedHere(S.tableName)) setTimeout(tryRejoin, 350);
  runPendingTable();
}

function attachRoom(r, onErr) {
  S.room = r;
  r.onPeers(onPeersChange, onErr || onRoomError);
  if (r.stream) r.stream.on(onStream);
  // the host's tab closed or lost its connection: check again as soon as its state should have arrived
  if (r.onLinkLost) r.onLinkLost(label => {
    if (!S.cur || label !== S.cur.peer || S.isHost) return;
    hostLinkLostAt = performance.now();
    setTimeout(decideHost, HOST_GONE_MS + 50);
  });
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
  // keep playing the game we were in, now alone
  follower.catchUp();
  if (follower.sim) S.sim = follower.sim;
  follower.reset();
  S.isHost = false; rec = null;
  const old = S.room;
  if (old && old !== S.lobby && typeof old.leave === "function") { try { const pr = old.leave(); if (pr && pr.catch) pr.catch(() => {}); } catch (_) {} }
  S.soloMode = true; S.cur = null; S.myPeer = "solo"; S.queue = []; S.peerList = []; S.myPres = {}; S.tableName = null; lastAck = null;
  if (S.sim) { S.sim.ak = new Map(); S.sim.roster = []; }
  attachRoom(makeSoloRoom());
  S.roomReady = true;
  if (S.joined) setPresence({ n: S.myName, j: Date.now() });
  if (reason) toast(reason);
  updateJoinCard();
  S.uiDirty = true;
}

// Remember where we sat, so a reload or reopening the link puts us back in our seat.
const SEAT_MEMORY_MS = 10 * 60 * 1000;
function rememberSeat() {
  if (!S.joined || !S.tableName || S.soloMode) return;
  try { localStorage.setItem("kv-seat", JSON.stringify({ t: S.tableName, at: Date.now() })); } catch (_) {}
}
/** True if we sat at this table within the last minutes and should sit down again by ourselves. */
export function wasSeatedHere(table) {
  try {
    const m = JSON.parse(localStorage.getItem("kv-seat") || "null");
    return !!m && m.t === table && Date.now() - m.at < SEAT_MEMORY_MS;
  } catch (_) { return false; }
}

/** Sit down at the current table with the given name. */
export function sitDown(name) {
  if (S.versionBlock) return;
  S.myName = name;
  S.joined = true;
  rememberSeat();
  setPresence(joinPresence());
  setTimeout(decideHost, 60);
  advertise(S.sim ? S.sim.w : 0);
  S.uiDirty = true;
}

export async function initNet() {
  startTicker();
  setInterval(() => { watchHosts(performance.now()); decideHost(); }, 500);
  setInterval(rememberSeat, 20000);
  document.addEventListener("visibilitychange", () => { if (S.joined) setPresence({ hid: document.hidden ? 1 : null }); });
  S.lobby = makeLobby();
  if (S.lobby.onPeers) S.lobby.onPeers(onLobbyPeers, onRoomError);
  const h = hashTable();
  S.invitedByHash = !!h;
  await enterTable(h || newTableName());
  window.addEventListener("hashchange", () => { const n = hashTable(); if (n && n !== S.tableName && !S.soloMode && !S.switching) { S.invitedByHash = true; enterTable(n); } });
}
