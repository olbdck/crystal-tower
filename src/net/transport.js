// Network transport: WebRTC data channels between players, MQTT over WSS for discovery,
// signaling, late joiners and fallback. Exposes a small "room" API (presence + peers) to the session.
import mqtt from "mqtt";
import { NET_CONFIG } from "../config.js";

const PEER_STALE_MS = 60000, MQTT_BG_MS = 2000, LINK_TIMEOUT_MS = 16000, LINK_RETRY_MS = 20000;

export function randLabel() {
  const a = new Uint8Array(10), abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  try { crypto.getRandomValues(a); } catch (_) { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; }
  return Array.from(a, x => abc[x % abc.length]).join("");
}
export function tabLabel() {
  try {
    let v = sessionStorage.getItem("kv-peer");
    if (!/^[a-z0-9]{10}$/.test(v || "")) { v = randLabel(); sessionStorage.setItem("kv-peer", v); }
    return v;
  } catch (_) { return randLabel(); }
}
function brokerFor(name) {
  const letter = name.slice(5, 6);
  return NET_CONFIG.brokers.find(b => b.id === letter) || NET_CONFIG.brokers[0];
}
export const generatedHere = new Set();

let iceCache = null;
async function iceServers() {
  if (iceCache) return iceCache;
  const list = (NET_CONFIG.stun || []).map(u => ({ urls: u }));
  for (const t of NET_CONFIG.turn || []) list.push(t);
  const m = NET_CONFIG.metered || {};
  if (m.app && m.apiKey) {
    try {
      const r = await fetch(`https://${m.app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(m.apiKey)}`);
      if (r.ok) { const extra = await r.json(); if (Array.isArray(extra)) list.push(...extra.slice(0, 3)); }
    } catch (_) {}
  }
  const o = NET_CONFIG.openRelay;
  if (o && o.host && o.secret && window.crypto && crypto.subtle) {
    try {
      const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:crystal`;
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(o.secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username)));
      const credential = btoa(String.fromCharCode(...sig));
      list.push({ urls: [`turn:${o.host}:80`, `turn:${o.host}:443`, `turn:${o.host}:443?transport=tcp`, `turns:${o.host}:443?transport=tcp`], username, credential });
    } catch (_) {}
  }
  return (iceCache = list);
}

export function makeLobby() {
  return {
    onPeers() { return () => {}; },
    presence() { return Promise.resolve(); },
    async join(name) {
      if (!generatedHere.has(name) || NET_CONFIG.brokers.length < 2) return joinTable(name, brokerFor(name));
      // a new table goes to whichever broker answers first from here: usually the closest, and a dead one is skipped
      const rest = name.slice(6);
      const tries = NET_CONFIG.brokers.map(b => { const n = "stil-" + b.id + rest; generatedHere.add(n); return joinTable(n, b); });
      const winner = await Promise.any(tries);
      for (const t of tries) t.then(api => { if (api !== winner) api.leave(); }, () => {});
      return winner;
    },
  };
}

async function joinTable(name, broker) {
  const me = tabLabel();
  const base = `${NET_CONFIG.topicRoot}/${name}/p/`, sigBase = `${NET_CONFIG.topicRoot}/${name}/sig/`;
  const myTopic = base + me, mySig = sigBase + me;
  const p2p = NET_CONFIG.p2p !== false && typeof RTCPeerConnection !== "undefined";
  const ice = p2p ? await iceServers() : [];
  let pres = Object.freeze({}), others = new Map(), handlers = [], connHandlers = [], closed = false, cache = null;
  let flushTimer = 0, lastMqtt = 0, hbTimer = 0, staleTimer = 0, pingTimer = 0, qCount = 0;
  const qBase = Date.now(), lastQ = new Map(), links = new Map();
  const nextQ = () => qBase * 1000 + (++qCount);

  const wrap = (label, p) => Object.freeze({ peer: label, by: null, isMe: label === me, sameTab: label === me, kind: "viewer", guest: false, presence: p, updatedAt: Date.now() });
  function list() {
    if (cache) return cache;
    const arr = [wrap(me, pres)];
    for (const [l, o] of others) arr.push(wrap(l, o.p));
    return (cache = Object.freeze(arr));
  }
  function notify(left) {
    cache = null;
    const ch = { peers: list(), joined: [], left: left || [], updated: [] };
    queueMicrotask(() => { for (const h of handlers.slice()) { try { h(ch); } catch (e) { console.error(e); } } });
  }
  function emitConn(c) { for (const h of connHandlers.slice()) { try { h(c); } catch (_) {} } }

  // one presence message, from either path; the newest wins
  function accept(label, msg) {
    if (!msg || typeof msg.p !== "object" || !msg.p || Array.isArray(msg.p)) return;
    if (typeof msg.q === "number") {
      if (msg.q <= (lastQ.get(label) || 0)) return;
      lastQ.set(label, msg.q);
    }
    others.set(label, { p: Object.freeze(msg.p), at: Date.now() });
    notify();
    ensureLink(label);
  }
  function drop(label) {
    const old = others.get(label);
    closeLink(label);
    lastQ.delete(label);
    if (old) { others.delete(label); notify([wrap(label, old.p)]); }
  }

  /* ---- direct links ---- */
  function closeLink(label) {
    const l = links.get(label);
    if (!l) return;
    links.delete(label);
    try { l.pc.close(); } catch (_) {}
  }
  function failLink(label, l) {
    if (links.get(label) !== l || l.state === "failed") return;
    l.state = "failed"; l.retryAt = Date.now() + LINK_RETRY_MS;
    try { l.pc.close(); } catch (_) {}
  }
  function newLink(label, id) {
    closeLink(label);
    const pc = new RTCPeerConnection({ iceServers: ice });
    const l = { pc, dc: null, state: "connecting", kind: null, rtt: null, id, since: Date.now(), retryAt: 0 };
    links.set(label, l);
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") failLink(label, l);
    });
    setTimeout(() => { if (links.get(label) === l && l.state === "connecting") failLink(label, l); }, LINK_TIMEOUT_MS);
    return l;
  }
  function gathered(pc) {
    return new Promise(res => {
      if (pc.iceGatheringState === "complete") return res();
      const t = setTimeout(res, 3000);
      pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } });
    });
  }
  function setupChannel(label, l, dc) {
    l.dc = dc;
    dc.onopen = () => {
      if (links.get(label) !== l) return;
      l.state = "open";
      try { dc.send(JSON.stringify({ q: nextQ(), p: pres })); } catch (_) {}
      detectKind(l);
      notify();
    };
    dc.onclose = () => { if (links.get(label) === l && l.state === "open") { failLink(label, l); l.retryAt = Date.now() + 1500; } };
    dc.onmessage = e => {
      let m = null;
      try { m = JSON.parse(e.data); } catch (_) { return; }
      if (!m) return;
      if (m.t === "ping") { try { dc.send(JSON.stringify({ t: "pong", at: m.at })); } catch (_) {} return; }
      if (m.t === "pong") { const rtt = performance.now() - m.at; l.rtt = l.rtt == null ? rtt : l.rtt * 0.7 + rtt * 0.3; return; }
      accept(label, m);
    };
  }
  async function detectKind(l) {
    try {
      const stats = await l.pc.getStats();
      let pair = null;
      stats.forEach(r => { if (r.type === "transport" && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
      if (!pair) stats.forEach(r => { if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") pair = r; });
      const loc = pair && stats.get(pair.localCandidateId), rem = pair && stats.get(pair.remoteCandidateId);
      l.kind = (loc && loc.candidateType === "relay") || (rem && rem.candidateType === "relay") ? "turn" : "direct";
    } catch (_) { l.kind = "direct"; }
  }
  function sendSig(to, obj) {
    if (!client.connected) return;
    client.publish(sigBase + to, JSON.stringify({ ...obj, from: me }), { qos: 1, retain: false });
  }
  // the player with the smaller id makes the offer, so the two sides never both offer at once
  async function ensureLink(label) {
    if (!p2p || closed || label === me) return;
    const l = links.get(label);
    if (l && (l.state !== "failed" || Date.now() < l.retryAt)) return;
    if (me > label) return;
    const id = randLabel().slice(0, 8);
    const nl = newLink(label, id);
    try {
      setupChannel(label, nl, nl.pc.createDataChannel("game", { ordered: false }));
      await nl.pc.setLocalDescription(await nl.pc.createOffer());
      await gathered(nl.pc);
      if (links.get(label) !== nl) return;
      sendSig(label, { t: "offer", id, sdp: nl.pc.localDescription.sdp });
    } catch (_) { failLink(label, nl); }
  }
  async function onSignal(msg) {
    const from = msg && msg.from;
    if (!p2p || closed || typeof from !== "string" || !/^[a-z0-9]{6,16}$/.test(from) || typeof msg.sdp !== "string") return;
    try {
      if (msg.t === "offer" && from < me) {
        const l = newLink(from, msg.id);
        l.pc.ondatachannel = e => setupChannel(from, l, e.channel);
        await l.pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        await l.pc.setLocalDescription(await l.pc.createAnswer());
        await gathered(l.pc);
        if (links.get(from) !== l) return;
        sendSig(from, { t: "answer", id: msg.id, sdp: l.pc.localDescription.sdp });
      } else if (msg.t === "answer") {
        const l = links.get(from);
        if (l && l.id === msg.id && l.pc.signalingState === "have-local-offer") await l.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      }
    } catch (_) { const l = links.get(from); if (l) failLink(from, l); }
  }

  /* ---- MQTT ---- */
  const client = mqtt.connect(broker.url, {
    clientId: "ct_" + me + "_" + randLabel().slice(0, 6),
    keepalive: 15, clean: true, reconnectPeriod: 2000, connectTimeout: 15000, resubscribe: true,
    will: { topic: myTopic, payload: "", qos: 0, retain: true },
  });

  function flush() {
    flushTimer = 0;
    if (closed) return;
    const body = JSON.stringify({ q: nextQ(), p: pres });
    let allDirect = true;
    for (const label of others.keys()) {
      const l = links.get(label);
      if (l && l.state === "open" && l.dc && l.dc.readyState === "open") { try { l.dc.send(body); } catch (_) { allDirect = false; } }
      else allDirect = false;
    }
    // the broker gets every update only while someone cannot be reached directly; otherwise a copy every 2 s
    const now = Date.now();
    if (client.connected && (!allDirect || now - lastMqtt >= MQTT_BG_MS)) { lastMqtt = now; client.publish(myTopic, body, { qos: 0, retain: true }); }
  }
  function presence(patch) {
    if (closed) return Promise.reject({ code: "invalid_argument", message: "left" });
    const np = { ...pres };
    for (const k in patch) { if (patch[k] === null) delete np[k]; else np[k] = patch[k]; }
    pres = Object.freeze(np);
    notify();
    if (!flushTimer) flushTimer = setTimeout(flush, 8);
    return Promise.resolve();
  }

  client.on("message", (topic, payload) => {
    if (closed) return;
    let msg = null;
    if (topic === mySig) {
      try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch (_) { return; }
      onSignal(msg);
      return;
    }
    if (!topic.startsWith(base)) return;
    const label = topic.slice(base.length);
    if (label === me || !/^[a-z0-9]{6,16}$/.test(label)) return;
    if (!payload || !payload.length) { drop(label); return; }
    try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch (_) { return; }
    accept(label, msg);
  });
  client.on("connect", () => { if (!closed) { lastMqtt = 0; flush(); emitConn(true); } });
  client.on("close", () => { if (!closed) emitConn(false); });
  client.on("offline", () => { if (!closed) emitConn(false); });
  client.on("error", () => {});

  hbTimer = setInterval(() => { if (!closed && Date.now() - lastMqtt > MQTT_BG_MS) flush(); }, 1000);
  staleTimer = setInterval(() => {
    const now = Date.now();
    for (const [l, o] of others) { if (now - o.at > PEER_STALE_MS) drop(l); else ensureLink(l); }
  }, 2000);
  pingTimer = setInterval(() => {
    for (const l of links.values()) if (l.state === "open" && l.dc && l.dc.readyState === "open") { try { l.dc.send(JSON.stringify({ t: "ping", at: performance.now() })); } catch (_) {} }
  }, 2000);

  const api = {
    name,
    presence,
    peers: () => list(),
    // how each other player is reached: "direct", "turn", "server" (broker fallback) or "connecting"
    links() {
      const out = {};
      for (const label of others.keys()) {
        const l = links.get(label);
        out[label] = !p2p ? { kind: "server" } : !l ? { kind: "connecting" } : l.state === "open" ? { kind: l.kind || "direct", rtt: l.rtt } : l.state === "failed" ? { kind: "server" } : { kind: "connecting" };
      }
      return out;
    },
    onPeers(h) {
      handlers.push(h);
      const peers = list();
      queueMicrotask(() => { try { h({ peers, joined: peers, left: [], updated: [] }); } catch (e) { console.error(e); } });
      return () => { handlers = handlers.filter(x => x !== h); };
    },
    connected: () => client.connected,
    onConnection(h) {
      connHandlers.push(h);
      queueMicrotask(() => { try { h(client.connected); } catch (_) {} });
      return () => { connHandlers = connHandlers.filter(x => x !== h); };
    },
    emit: () => Promise.resolve(),
    on: () => () => {},
    leave() {
      if (closed) return Promise.resolve();
      closed = true; handlers = []; connHandlers = [];
      clearTimeout(flushTimer); clearInterval(hbTimer); clearInterval(staleTimer); clearInterval(pingTimer);
      for (const label of [...links.keys()]) closeLink(label);
      try { if (client.connected) client.publish(myTopic, "", { qos: 0, retain: true }); } catch (_) {}
      try { client.end(false); } catch (_) {}
      return Promise.resolve();
    },
  };
  addEventListener("pagehide", () => { api.leave(); });

  return new Promise((resolve, reject) => {
    let done = false;
    const fail = err => { if (done) return; done = true; clearInterval(t); api.leave(); reject(err || { type: "connect" }); };
    // count only seconds when the page is responsive, so a slow first load does not use up the wait
    let ticks = 0;
    const t = setInterval(() => { if (++ticks >= 20) fail({ type: "timeout" }); }, 1000);
    client.once("connect", () => {
      client.subscribe({ [base + "+"]: { qos: 0 }, [mySig]: { qos: 1 } }, err => {
        if (done) return;
        if (err) { fail(err); return; }
        done = true; clearInterval(t);
        // give retained presences a moment to arrive so the join screen shows who is at the table
        setTimeout(() => resolve(api), 400);
      });
    });
  });
}
