// Both ends of the game stream. Pure logic, no DOM or network, so Node tests drive it directly.
//
// Recorder (host): every change to the host's Sim goes through it, so each one is also written into
// the next batch: who sits at the table, each action, each tick, and a checksum every second.
//
// Follower (everyone else): replays those batches on its own copy of the Sim. Batches are played
// at real-time pace a couple of ticks behind the newest one, so enemies move smoothly even when
// packets arrive unevenly. The buffer grows after a stall and shrinks again when the connection is
// steady. If a batch is missing, or the copy's checksum differs from the host's, the copy asks for a
// keyframe and starts over from it.
import { STEP } from "../sim/rules.js";
import { BatchBuilder, OP_ACT, OP_HASH, OP_ROSTER, OP_TICK, cleanAction, encodeKeyframe } from "./codec.js";

export const HASH_EVERY = 30; // ticks between checksums

const STEP_MS = STEP * 1000;
const MIN_BUFFER = 2, MAX_BUFFER = 10; // ticks kept in hand before playing
const SKIP_AHEAD = 45; // this many ticks behind: jump instead of playing them all
const GAP_WAIT_MS = 400; // a missing batch may still be on its way (another path, out of order) this long

export class Recorder {
  constructor(sim) { this.sim = sim; this.b = new BatchBuilder(); this.b.begin(sim.t); this.seq = 0; }
  /** Who sits at the table, in joining order. */
  roster(labels) {
    const cur = this.sim.roster;
    if (labels.length === cur.length && labels.every((l, i) => l === cur[i])) return false;
    this.sim.setRoster(labels); this.b.roster(labels);
    return true;
  }
  /** A player's action from their presence; repeats and malformed ones are skipped. */
  act(label, raw) {
    const it = cleanAction(raw);
    if (!it || it[0] <= (this.sim.ak.get(label) || 0)) return false;
    this.sim.applyFrom(label, it); this.b.act(label, it);
    return true;
  }
  step() {
    this.sim.step(STEP); this.b.tick();
    if (this.sim.t % HASH_EVERY === 0) this.b.hash(this.sim.stateHash());
  }
  /** The inputs since the last batch as a numbered batch, or null if nothing happened. */
  batch() { return this.b.empty ? null : this.b.take(this.sim.e, ++this.seq, this.sim.t); }
  /** The full state after the last batch. Take the pending batch first. */
  keyframe(build) {
    if (!this.b.empty) throw new Error("take the pending batch before a keyframe");
    return encodeKeyframe(this.sim, { e: this.sim.e, seq: this.seq, build });
  }
}

export class Follower {
  constructor() {
    this.sim = null; this.onFx = null;
    this.stats = { batches: 0, keyframes: 0, resyncs: 0, hashChecks: 0, stalls: 0 };
    this.reset();
  }
  reset() {
    this.sim = null; this.queue = []; this.ticksQueued = 0; this.next = 0; this.pending = new Map();
    this.acc = 0; this.last = 0; this.buffer = MIN_BUFFER; this.buffering = true; this.calmSince = 0;
    this.broken = false; this.gapSince = 0; this.gapTooLong = false; this.quiet = false; this.changed = false;
  }
  /**
   * Start over from a keyframe: { sim, seq }. With sameStream, batches already received after it are kept;
   * a keyframe from a new host starts a new numbering, so everything older goes.
   */
  load(kf, now, sameStream = false) {
    const keep = sameStream ? [...this.pending.values()].filter(b => b.seq > kf.seq) : [];
    const buffer = this.buffer;
    this.reset();
    this.buffer = buffer;
    this.sim = kf.sim;
    this.sim.onFx = f => { if (!this.quiet && this.onFx) this.onFx(f); };
    this.next = kf.seq + 1; this.last = now; this.calmSince = now;
    this.stats.keyframes++;
    for (const b of keep) this.push(b, now);
    this.changed = true;
  }
  /** True while the copy needs a keyframe to continue. */
  get needsKeyframe() { return !this.sim || this.broken || this.gapTooLong; }
  /** A decoded batch from the host, in any order. */
  push(b, now) {
    if (b.seq < this.next) return;
    if (b.seq > this.next || !this.sim || this.broken) {
      // something is missing: keep what arrived; if the gap does not fill soon, a keyframe bridges it
      if (this.pending.size < 300) this.pending.set(b.seq, b);
      if (this.sim && !this.broken && !this.gapSince) this.gapSince = now;
      this.checkGap(now);
      return;
    }
    this.enqueue(b);
    while (this.pending.has(this.next)) { const nb = this.pending.get(this.next); this.pending.delete(this.next); this.enqueue(nb); }
    for (const s of this.pending.keys()) if (s < this.next) this.pending.delete(s);
    this.gapSince = this.pending.size ? now : 0; this.gapTooLong = false;
  }
  checkGap(now) {
    if (!this.gapSince || this.gapTooLong) return;
    let first = Infinity;
    for (const s of this.pending.keys()) if (s < first) first = s;
    // a long gap is not going to fill (a keyframe from long ago, a lost bundle): ask right away
    if (now - this.gapSince > GAP_WAIT_MS || first - this.next > 15) this.gapTooLong = true;
  }
  enqueue(b) {
    let n = 0;
    for (const op of b.ops) if (op[0] === OP_TICK) n += op[1];
    this.queue.push({ ops: b.ops, i: 0, left: -1, t0: b.t0, started: false });
    this.ticksQueued += n; this.next = b.seq + 1; this.stats.batches++;
  }
  /** The copy no longer matches the host: stop and wait for a keyframe. */
  desync() {
    this.broken = true; this.queue = []; this.ticksQueued = 0; this.stats.resyncs++;
  }
  /**
   * Runs queued inputs: everything up to `ticks` more ticks, then any inputs that come before the next tick.
   * Returns the number of ticks played.
   */
  play(ticks) {
    let played = 0;
    while (this.queue.length && !this.broken) {
      const b = this.queue[0];
      if (!b.started) {
        b.started = true;
        if (b.t0 !== this.sim.t) { this.desync(); break; }
      }
      if (b.i >= b.ops.length) { this.queue.shift(); continue; }
      const op = b.ops[b.i];
      if (op[0] === OP_TICK) {
        if (b.left < 0) b.left = op[1];
        if (b.left === 0) { b.left = -1; b.i++; continue; }
        if (played >= ticks) break;
        this.sim.step(STEP); b.left--; this.ticksQueued--; played++;
        continue;
      }
      if (op[0] === OP_ROSTER) this.sim.setRoster(op[1]);
      else if (op[0] === OP_ACT) this.sim.applyFrom(op[1], op[2]);
      else if (op[0] === OP_HASH) {
        this.stats.hashChecks++;
        if (this.sim.stateHash() !== op[1]) { this.desync(); break; }
      }
      b.i++;
      this.changed = true;
    }
    if (played) this.changed = true;
    return played;
  }
  /** Plays inputs for the time that passed since the last call. */
  advance(now) {
    if (!this.sim) return;
    let dt = now - this.last;
    this.last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 1000) dt = 1000;
    this.checkGap(now);
    if (this.broken) return;
    if (this.ticksQueued > SKIP_AHEAD + this.buffer) {
      // far behind (a hidden tab, a burst after a hiccup): catch up at once, without the effects
      this.quiet = true; this.play(this.ticksQueued - this.buffer); this.quiet = false;
      this.acc = 0; this.buffering = false;
    }
    // at double speed (everyone asked for it) ticks are played twice as fast and the buffer holds twice as many
    const sp = this.sim.speed();
    if (this.buffering) {
      this.play(0);
      if (this.ticksQueued < this.buffer * sp) return;
      this.buffering = false; this.acc = STEP_MS;
    }
    this.acc += dt * sp;
    let due = Math.floor(this.acc / STEP_MS);
    if (due > 0 && this.ticksQueued > this.buffer * sp + 3) due++; // a little ahead of the buffer: speed up gently
    const played = this.play(due);
    this.acc -= played * STEP_MS;
    if (this.acc < 0) this.acc = 0;
    if (played < due && !this.ticksQueued && !this.broken) {
      // ran dry: wait until the buffer fills again, and keep a bigger one from now on
      this.stats.stalls++;
      this.acc = STEP_MS; this.buffering = true; this.calmSince = now;
      this.buffer = Math.min(MAX_BUFFER, this.buffer + 1);
    } else if (now - this.calmSince > 10000) {
      this.calmSince = now;
      if (this.buffer > MIN_BUFFER) this.buffer--;
    }
    this.play(0);
  }
  /** Plays everything received so far at once (before taking over as host). */
  catchUp() {
    if (!this.sim || this.broken) return;
    this.quiet = true; this.play(Infinity); this.quiet = false;
  }
  /** Progress into the current tick, 0..1, for drawing between ticks. */
  alpha(now) {
    if (!this.sim || this.buffering || this.broken) return 1;
    return Math.min(1, (this.acc + Math.max(0, now - this.last) * this.sim.speed()) / STEP_MS);
  }
  /** How far behind the newest received tick the shown game is, in ticks. */
  get lag() { return this.ticksQueued; }
}
