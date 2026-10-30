// Binary messages of the game stream (host -> players). Pure functions, no DOM, so Node tests use them too.
//
// Keyframe: the complete game state, exact to the bit. Sent when a player joins, falls out of step,
//   or the host changes, and kept on the broker for late joiners.
// Batch: what happened since the previous batch, as inputs to the simulation:
//   TICK n          the game advanced n ticks
//   ROSTER labels   who sits at the table now (in joining order)
//   ACT label item  a player's action, e.g. [seq, "b", cell, type]
//   HASH h          state checksum after the last tick, to catch divergence
// Each player applies the same inputs to its own copy of the Sim and gets the same state as the host.
import { Sim } from "../sim/sim.js";
import { HAND_MAX, PASSIVES, SPELLS } from "../sim/cards.js";
import { BLOCKED, COLS, ENEMIES, MAX_SEATS, MAX_WAVES, NO_OWNER, PATHS, ROWS, TOWERS, posAt } from "../sim/rules.js";

export const MSG_KEYFRAME = 1, MSG_BATCH = 2, MSG_REQ = 3, MSG_BUNDLE = 4;
export const OP_TICK = 1, OP_ROSTER = 2, OP_ACT = 3, OP_HASH = 4;
const FORMAT = 8; // 2: wave timer for the crystal's gold drip; 3: cards; 4: the "Єдність" card; 5: pause; 6: finish-wave votes; 7: speed; 8: undo
const MAX_ROSTER = 32, MAX_LABEL = 24, MAX_ARGS = 3;

const te = new TextEncoder(), td = new TextDecoder();

export class Writer {
  constructor(size = 256) { this.buf = new Uint8Array(size); this.dv = new DataView(this.buf.buffer); this.n = 0; }
  need(k) {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b; this.dv = new DataView(b.buffer);
  }
  u8(x) { this.need(1); this.buf[this.n++] = x & 255; }
  u32(x) { this.need(4); this.dv.setUint32(this.n, x >>> 0, true); this.n += 4; }
  f64(x) { this.need(8); this.dv.setFloat64(this.n, x, true); this.n += 8; }
  /** Unsigned integer up to 2^53 in 1-8 bytes. */
  uv(x) {
    x = x > 0 ? Math.floor(x) : 0;
    this.need(8);
    while (x >= 128) { this.buf[this.n++] = (x % 128) | 128; x = Math.floor(x / 128); }
    this.buf[this.n++] = x;
  }
  /** Small signed integer (zigzag). */
  sv(x) { this.uv(x < 0 ? -2 * x - 1 : 2 * x); }
  str(s) { const b = te.encode(s); this.uv(b.length); this.raw(b); }
  raw(b) { this.need(b.length); this.buf.set(b, this.n); this.n += b.length; }
  bytes() { return this.buf.slice(0, this.n); }
}

export class Reader {
  constructor(bytes) { this.b = bytes; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.i = 0; }
  get done() { return this.i >= this.b.length; }
  chk(k) { if (this.i + k > this.b.length) throw new RangeError("message too short"); }
  u8() { this.chk(1); return this.b[this.i++]; }
  u32() { this.chk(4); const x = this.dv.getUint32(this.i, true); this.i += 4; return x; }
  f64() { this.chk(8); const x = this.dv.getFloat64(this.i, true); this.i += 8; return x; }
  uv() {
    let x = 0, m = 1;
    for (let k = 0; k < 8; k++) { const c = this.u8(); x += (c & 127) * m; if (c < 128) return x; m *= 128; }
    throw new RangeError("bad number");
  }
  sv() { const u = this.uv(); return u % 2 ? -(u + 1) / 2 : u / 2; }
  str(max = MAX_LABEL) {
    const n = this.uv();
    if (n > max) throw new RangeError("string too long");
    this.chk(n);
    const s = td.decode(this.b.subarray(this.i, this.i + n)); this.i += n;
    return s;
  }
  raw(n) { this.chk(n); const b = this.b.subarray(this.i, this.i + n); this.i += n; return b; }
}

/** An action as the simulation will see it: [seq, code, ...small integers], or a no-op if malformed. */
export function cleanAction(it) {
  if (!Array.isArray(it) || !Number.isSafeInteger(it[0]) || it[0] < 0) return null;
  const code = typeof it[1] === "string" && /^[a-z]$/.test(it[1]) ? it[1] : "";
  const args = it.slice(2);
  if (!code || args.length > MAX_ARGS || !args.every(a => Number.isInteger(a) && Math.abs(a) < 1e6)) return [it[0], ""];
  return [it[0], code, ...args];
}

/* ---------- keyframes ---------- */
export function encodeKeyframe(sim, { e, seq, build }) {
  const w = new Writer(2048);
  w.u8(MSG_KEYFRAME); w.u8(FORMAT); w.str(build || ""); w.uv(e); w.uv(seq);
  w.uv(sim.t); w.u8(sim.ph); w.u8(sim.w); w.sv(sim.l); w.f64(sim.tm); w.uv(sim.sp); w.f64(sim.sc); w.uv(sim.wt);
  w.u8(sim.pc); w.f64(sim.hs); w.f64(sim.bk); w.u8(sim.u); w.uv(sim.nid);
  let r = 0;
  for (let i = 0; i < MAX_SEATS; i++) if (sim.ready[i]) r |= 1 << i;
  w.u8(r); w.u8(sim.pz); w.u8(sim.sk); w.u8(sim.fw);
  for (let i = 0; i < MAX_SEATS; i++) {
    w.str(sim.seats[i]); w.f64(sim.gold[i]); w.uv(sim.kills[i]);
    w.uv(sim.pv[i]); w.f64(sim.gr[i]);
    w.u8(sim.hand[i].length); for (const c of sim.hand[i]) w.u8(c);
    w.u8(sim.offer[i].length); for (const c of sim.offer[i]) w.u8(c);
  }
  w.uv(sim.roster.length); for (const l of sim.roster) w.str(l);
  w.uv(sim.ak.size); for (const [l, x] of sim.ak) { w.str(l); w.uv(x); }
  w.uv(sim.gone.size); for (const [l, t] of sim.gone) { w.str(l); w.uv(t); }
  w.uv(sim.towers.size);
  for (const tw of sim.towers.values()) { w.u8(tw.c); w.u8(tw.ty); w.u8(tw.lv); w.sv(tw.o); w.f64(tw.cd); w.f64(tw.bt || 0); w.f64(tw.fr || 0); }
  w.uv(sim.enemies.length);
  for (const en of sim.enemies) {
    w.uv(en.id); w.u8(en.ty | (en.ln << 4) | (en.sl ? 128 : 0)); w.f64(en.d); w.f64(en.hp);
    if (en.sl) w.f64(en.sl);
  }
  return w.bytes();
}

/** { e, seq, build, sim } from a keyframe; throws on anything malformed. */
export function decodeKeyframe(bytes) {
  const r = new Reader(bytes);
  if (r.u8() !== MSG_KEYFRAME || r.u8() !== FORMAT) throw new RangeError("not a keyframe");
  const build = r.str(64), e = r.uv(), seq = r.uv();
  const m = new Sim();
  m.e = e; m.t = r.uv(); m.ph = r.u8(); m.w = r.u8(); m.l = r.sv(); m.tm = r.f64(); m.sp = r.uv(); m.sc = r.f64(); m.wt = r.uv();
  m.pc = r.u8(); m.hs = r.f64(); m.bk = r.f64(); m.u = r.u8(); m.nid = r.uv();
  if (![1, 2, 3, 4].includes(m.ph) || m.w > MAX_WAVES || m.pc < 1 || m.pc > MAX_SEATS) throw new RangeError("bad state");
  const rb = r.u8();
  m.pz = r.u8(); m.sk = r.u8(); m.fw = r.u8();
  if (m.pz > MAX_SEATS) throw new RangeError("bad pause");
  const cards = (n, max, limit) => {
    if (n > limit) throw new RangeError("bad cards");
    const out = [];
    for (let k = 0; k < n; k++) { const c = r.u8(); if (c >= max) throw new RangeError("bad card"); out.push(c); }
    return out;
  };
  for (let i = 0; i < MAX_SEATS; i++) {
    m.seats[i] = r.str(); m.gold[i] = r.f64(); m.kills[i] = r.uv(); m.ready[i] = !!(rb & (1 << i));
    m.pv[i] = r.uv(); m.gr[i] = r.f64();
    m.hand[i] = cards(r.u8(), SPELLS.length, HAND_MAX);
    m.offer[i] = cards(r.u8(), PASSIVES.length + SPELLS.length, 3);
  }
  const nr = r.uv();
  if (nr > MAX_ROSTER) throw new RangeError("bad roster");
  m.roster = []; for (let i = 0; i < nr; i++) m.roster.push(r.str());
  const na = r.uv();
  if (na > 256) throw new RangeError("bad acks");
  for (let i = 0; i < na; i++) { const l = r.str(); m.ak.set(l, r.uv()); }
  const ng = r.uv();
  if (ng > 256) throw new RangeError("bad seat holds");
  for (let i = 0; i < ng; i++) { const l = r.str(); m.gone.set(l, r.uv()); }
  const nt = r.uv();
  if (nt > COLS * ROWS) throw new RangeError("bad towers");
  for (let i = 0; i < nt; i++) {
    const c = r.u8(), ty = r.u8(), lv = r.u8(), o = r.sv(), cd = r.f64(), bt = r.f64(), fr = r.f64();
    if (c >= COLS * ROWS || BLOCKED[c] || !TOWERS[ty] || lv < 1 || lv > 3 || !(o === NO_OWNER || (o >= 0 && o < MAX_SEATS))) throw new RangeError("bad tower");
    m.towers.set(c, { c, ty, lv, o, cd, bt, fr });
  }
  const ne = r.uv();
  if (ne > 500) throw new RangeError("bad enemies");
  for (let i = 0; i < ne; i++) {
    const id = r.uv(), k = r.u8(), ty = k & 15, ln = (k >> 4) & 7, d = r.f64(), hp = r.f64(), sl = k & 128 ? r.f64() : 0;
    if (!ENEMIES[ty] || !PATHS[ln] || !Number.isFinite(d)) throw new RangeError("bad enemy");
    const p = posAt(ln, d);
    m.enemies.push({ id, ty, ln, d, pd: d, hp, sl, x: p[0], y: p[1], dead: false, leak: false, killer: -1 });
  }
  m.recomputeSyn();
  return { e, seq, build, sim: m };
}

/* ---------- batches ---------- */
/** Collects the host's inputs between two sends. */
export class BatchBuilder {
  constructor() { this.w = new Writer(256); this.ticks = 0; this.t0 = 0; this.empty = true; }
  begin(t) { this.w.n = 0; this.ticks = 0; this.t0 = t; this.empty = true; }
  endTicks() { if (this.ticks) { this.w.u8(OP_TICK); this.w.uv(this.ticks); this.ticks = 0; } }
  tick() { this.ticks++; this.empty = false; }
  roster(labels) { this.endTicks(); this.w.u8(OP_ROSTER); this.w.uv(labels.length); for (const l of labels) this.w.str(l); this.empty = false; }
  act(label, it) {
    this.endTicks();
    const w = this.w;
    w.u8(OP_ACT); w.str(label); w.uv(it[0]); w.u8(it[1] ? it[1].charCodeAt(0) : 0);
    w.u8(it.length - 2); for (let i = 2; i < it.length; i++) w.sv(it[i]);
    this.empty = false;
  }
  hash(h) { this.endTicks(); this.w.u8(OP_HASH); this.w.u32(h); this.empty = false; }
  /** The batch as bytes; starts the next one at tick t. */
  take(e, seq, t) {
    this.endTicks();
    const out = new Writer(this.w.n + 24);
    out.u8(MSG_BATCH); out.uv(e); out.uv(seq); out.uv(this.t0); out.raw(this.w.buf.subarray(0, this.w.n));
    this.begin(t);
    return out.bytes();
  }
}

/** Type, epoch and sequence number of a stream message without decoding the rest. */
export function peek(bytes) {
  const r = new Reader(bytes), type = r.u8();
  if (type === MSG_BATCH) return { type, e: r.uv(), seq: r.uv() };
  if (type === MSG_KEYFRAME) { r.u8(); r.str(64); return { type, e: r.uv(), seq: r.uv() }; }
  return { type };
}

/** { e, seq, t0, ops } where each op is [OP_TICK, n] | [OP_ROSTER, labels] | [OP_ACT, label, item] | [OP_HASH, h]. */
export function decodeBatch(bytes) {
  const r = new Reader(bytes);
  if (r.u8() !== MSG_BATCH) throw new RangeError("not a batch");
  const e = r.uv(), seq = r.uv(), t0 = r.uv(), ops = [];
  while (!r.done) {
    const op = r.u8();
    if (op === OP_TICK) ops.push([OP_TICK, r.uv()]);
    else if (op === OP_ROSTER) {
      const n = r.uv();
      if (n > MAX_ROSTER) throw new RangeError("bad roster");
      const list = [];
      for (let i = 0; i < n; i++) list.push(r.str());
      ops.push([OP_ROSTER, list]);
    } else if (op === OP_ACT) {
      const label = r.str(), s = r.uv(), c = r.u8(), n = r.u8();
      if (n > MAX_ARGS) throw new RangeError("bad action");
      const it = [s, c ? String.fromCharCode(c) : ""];
      for (let i = 0; i < n; i++) it.push(r.sv());
      ops.push([OP_ACT, label, it]);
    } else if (op === OP_HASH) ops.push([OP_HASH, r.u32()]);
    else throw new RangeError("unknown op " + op);
  }
  return { e, seq, t0, ops };
}

/* ---------- requests and bundles ---------- */
export const REQUEST = Uint8Array.of(MSG_REQ);

/** Several messages in one, for the broker path. */
export function bundle(list) {
  if (list.length === 1) return list[0];
  const w = new Writer(list.reduce((s, b) => s + b.length + 3, 4));
  w.u8(MSG_BUNDLE); w.uv(list.length);
  for (const b of list) { w.uv(b.length); w.raw(b); }
  return w.bytes();
}
export function unbundle(bytes) {
  if (bytes[0] !== MSG_BUNDLE) return [bytes];
  const r = new Reader(bytes); r.u8();
  const n = r.uv(), out = [];
  if (n > 1000) throw new RangeError("bad bundle");
  for (let i = 0; i < n; i++) out.push(r.raw(r.uv()));
  return out;
}
