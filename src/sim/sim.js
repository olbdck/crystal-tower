// The game simulation. The host runs it and decides; every other player runs an identical copy fed
// with the same inputs (who sits at the table, each player's actions, the passing ticks), so all copies
// stay bit-for-bit equal without sending positions around. Keep it deterministic: no clocks, no
// Math.random, no engine-dependent maths, and iterate Maps and arrays in insertion order.
import {
  BLOCKED, BREAK_TIME, COLS, CRYSTAL, DRIP_EVERY, ENEMIES, GIFT, KILL_SHARE, dripCap, waveBonus, MAX_ENEMIES, MAX_SEATS, MAX_TOWERS, MAX_WAVES, PATHS, ROWS, SEAT_GRACE, NO_OWNER, SLOW_FACTOR, START_GOLD, START_LIVES, SYN_BONUS, TOWERS, enemyTypeAt, hpScale, posAt, sellValue, spawnInterval, synergyAt, towerStats, upgradeCost, waveTotal,
} from "./rules.js";
import { HAND_MAX, SPELLS, SPELL_BASE, SP, buildCost, cardWave, drawOffer, has, isSpellCode, sellFor, towerStatsFor, upCost } from "./cards.js";

const F64 = new Float64Array(1), W32 = new Uint32Array(F64.buffer);
// FNV-1a over the exact bits of a number
function mix(h, x) { F64[0] = x; h = Math.imul(h ^ W32[0], 16777619); return Math.imul(h ^ W32[1], 16777619); }

export class Sim {
  constructor() {
    this.e = 1; this.t = 0; this.ak = new Map(); this.gone = new Map(); this.onFx = null; this.roster = [];
    this.reset(["", "", "", "", ""]);
  }
  reset(seats) {
    this.ph = 1; this.w = 0; this.l = START_LIVES; this.tm = -1; this.sp = 0; this.sc = 0; this.pc = 1; this.hs = 1; this.wt = 0;
    this.bk = START_GOLD; this.u = 0; this.pz = 0; // pz: seat+1 of the player who paused the game, 0 = running
    this.seats = seats.slice();
    this.gold = [0, 0, 0, 0, 0].map(() => START_GOLD);
    this.kills = [0, 0, 0, 0, 0];
    this.ready = [false, false, false, false, false];
    // cards: passive bitmask, spells in hand, the pick on offer (card codes), gold rush seconds left
    this.pv = [0, 0, 0, 0, 0]; this.hand = [[], [], [], [], []]; this.offer = [[], [], [], [], []]; this.gr = [0, 0, 0, 0, 0];
    for (let i = 0; i < MAX_SEATS; i++) if (this.seats[i]) this.u |= 1 << i;
    this.towers = new Map(); this.enemies = []; this.nid = 1; this.syn = new Map(); this.tv = (this.tv || 0) + 1;
  }
  /** Players sitting at the table right now, in joining order. Changes come from the host as inputs. */
  setRoster(labels) { this.roster = labels.slice(); this.assignSeats(this.roster); }
  /** One player's action, with acknowledgement; ignored (but acknowledged) for players without a seat. */
  applyFrom(label, it) {
    const seat = this.seats.indexOf(label);
    if (seat >= 0) this.apply(seat, it);
    this.ak.set(label, it[0]);
  }
  occupied() { const r = []; for (let i = 0; i < MAX_SEATS; i++) if (this.seats[i]) r.push(i); return r; }
  /**
   * Seats players who are at the table, in joining order. Someone who drops out keeps their seat
   * (with gold, towers and acknowledged actions) for SEAT_GRACE ticks and gets it back on return.
   * After that the seat is freed: their towers stay on the board without an owner and the next
   * player in that seat starts fresh.
   */
  assignSeats(joinedSorted) {
    const present = new Set(joinedSorted);
    for (const p of [...this.gone.keys()]) if (present.has(p)) this.gone.delete(p);
    for (const p of [...this.seats.filter(Boolean), ...this.ak.keys()]) if (!present.has(p) && !this.gone.has(p)) this.gone.set(p, this.t);
    const expired = p => this.gone.has(p) && this.t - this.gone.get(p) > SEAT_GRACE;
    for (let i = 0; i < MAX_SEATS; i++) if (this.seats[i] && expired(this.seats[i])) this.freeSeat(i);
    for (const peer of joinedSorted) {
      if (this.seats.includes(peer)) continue;
      const free = this.seats.indexOf("");
      if (free < 0) break;
      this.seats[free] = peer; this.ready[free] = false;
      if (!(this.u & (1 << free))) {
        this.u |= 1 << free;
        this.gold[free] = this.w > 0 ? Math.max(START_GOLD, Math.round(this.bk * 0.6)) : START_GOLD;
        this.kills[free] = 0; this.clearCards(free);
      }
    }
    for (const k of [...this.ak.keys()]) if (expired(k)) this.ak.delete(k);
    for (const k of [...this.gone.keys()]) if (expired(k)) this.gone.delete(k);
  }
  clearCards(i) {
    if (this.pz === i + 1) this.pz = 0; // a pause by a player who is gone for good ends
    const had = this.pv[i];
    this.pv[i] = 0; this.hand[i] = []; this.offer[i] = []; this.gr[i] = 0;
    if (had) this.recomputeSyn();
  }
  freeSeat(i) {
    this.seats[i] = ""; this.ready[i] = false; this.clearCards(i);
    this.u &= ~(1 << i);
    let changed = false;
    for (const tw of this.towers.values()) if (tw.o === i) { tw.o = NO_OWNER; changed = true; }
    if (changed) { this.recomputeSyn(); this.tv++; }
  }
  /** Seats whose player is at the table right now (not away). */
  present() { return this.occupied().filter(i => !this.gone.has(this.seats[i])); }
  recomputeSyn() {
    this.syn = new Map();
    for (const tw of this.towers.values()) this.syn.set(tw.c, synergyAt(this.towers, tw, tw.o >= 0 && has(this.pv[tw.o], "unity")));
  }
  apply(seat, it) {
    const code = it[1];
    if (code === "p") { if (this.ph <= 2) this.pz = it[2] ? seat + 1 : 0; return; }
    // a paused wave stands still: no building, upgrading, selling or spells until it goes on
    if (this.pz && this.ph === 2 && (code === "b" || code === "u" || code === "s" || code === "m")) return;
    if (code === "b") {
      const cell = it[2], ty = it[3];
      if (!Number.isInteger(cell) || cell < 0 || cell >= COLS * ROWS || !Number.isInteger(ty) || ty < 0 || ty >= TOWERS.length) return;
      if (this.ph > 2 || BLOCKED[cell] || this.towers.has(cell) || this.towers.size >= MAX_TOWERS) return;
      const cost = buildCost(this.pv[seat], ty);
      if (this.gold[seat] < cost) return;
      this.gold[seat] -= cost;
      this.towers.set(cell, { c: cell, ty, lv: 1, o: seat, cd: 0, bt: 0 }); this.tv++;
      this.recomputeSyn();
    } else if (code === "u") {
      const tw = this.towers.get(it[2]);
      if (!tw || tw.lv >= 3 || this.ph > 2) return;
      const cost = upCost(this.pv[seat], tw.ty, tw.lv);
      if (this.gold[seat] < cost) return;
      this.gold[seat] -= cost; tw.lv++; this.tv++;
    } else if (code === "s") {
      const tw = this.towers.get(it[2]);
      if (!tw || tw.o !== seat || this.ph > 2) return;
      this.gold[seat] += sellFor(this.pv[seat], tw.ty, tw.lv);
      this.towers.delete(tw.c); this.recomputeSyn(); this.tv++;
    } else if (code === "r") {
      // a card on offer must be picked before getting ready
      if (this.ph === 1) this.ready[seat] = !!it[2] && !this.offer[seat].length;
    } else if (code === "g") {
      const to = it[2];
      if (!Number.isInteger(to) || to < 0 || to >= MAX_SEATS || to === seat || !this.seats[to]) return;
      if (this.gold[seat] < GIFT) return;
      this.gold[seat] -= GIFT; this.gold[to] += GIFT;
    } else if (code === "n") {
      if (this.ph >= 3) this.reset(this.seats);
    } else if (code === "k") {
      this.pick(seat, it[2]);
    } else if (code === "m") {
      this.cast(seat, it[2], it[3]);
    }
  }
  /** Takes card number `slot` of the three on offer. A fourth spell pushes the oldest out of the hand. */
  pick(seat, slot) {
    const offer = this.offer[seat], code = offer[slot];
    if (!Number.isInteger(slot) || code === undefined) return;
    if (isSpellCode(code)) {
      this.hand[seat].push(code - SPELL_BASE);
      if (this.hand[seat].length > HAND_MAX) this.hand[seat].shift();
    } else { this.pv[seat] |= 1 << code; this.recomputeSyn(); }
    this.offer[seat] = [];
  }
  /** Casts spell number `idx` from the hand; `target` is a cell for spells that need one. Only during a wave. */
  cast(seat, idx, target) {
    const hand = this.hand[seat], id = hand[idx];
    if (this.ph !== 2 || !Number.isInteger(idx) || id === undefined) return;
    const sp = SPELLS[id];
    if (this.gold[seat] < sp.cost) return;
    if (sp.target && (!Number.isInteger(target) || target < 0 || target >= COLS * ROWS)) return;
    const tx = target % COLS + 0.5, ty = ((target / COLS) | 0) + 0.5;
    if (id === SP.fire) {
      const r2 = sp.radius * sp.radius, dmg = sp.dmg * this.hs;
      for (const e of this.enemies) { const dx = e.x - tx, dy = e.y - ty; if (dx * dx + dy * dy <= r2) this.hit(e, dmg, seat); }
      this.fx(6, tx, ty, id, sp.radius * 10);
    } else if (id === SP.storm) {
      if (!this.enemies.length) return;
      for (const e of this.enemies) { e.sl = Math.max(e.sl, sp.slow); this.fx(6, e.x, e.y, id, 6); }
    } else if (id === SP.quake) {
      if (!this.enemies.length) return;
      for (const e of this.enemies) {
        e.d = Math.max(0, e.d - sp.push); e.pd = e.d;
        const p = posAt(e.ln, e.d); e.x = p[0]; e.y = p[1];
        this.fx(6, e.x, e.y, id, 6);
      }
    } else if (id === SP.heal) {
      if (this.l >= START_LIVES) return;
      this.l = Math.min(START_LIVES, this.l + sp.lives);
      this.fx(6, CRYSTAL.x + 0.5, CRYSTAL.y + 0.5, id, 14);
    } else if (id === SP.surge) {
      const tw = this.towers.get(target);
      if (!tw) return;
      tw.bt = sp.time;
      this.fx(6, tx, ty, id, 8);
    } else if (id === SP.rush) {
      this.gr[seat] = sp.time;
      this.fx(6, CRYSTAL.x + 0.5, CRYSTAL.y + 0.5, id, 10);
    }
    this.gold[seat] -= sp.cost;
    hand.splice(idx, 1);
  }
  step(dt) {
    this.t++;
    // a seat held for a player who dropped out is released when the wait runs out
    if (this.gone.size && this.t % 30 === 0) this.assignSeats(this.roster);
    if (this.pz) { for (const e of this.enemies) e.pd = e.d; return; } // paused: time stands still
    if (this.ph === 1) {
      const occ = this.present();
      if (occ.length && occ.every(i => this.ready[i])) this.startWave();
      else if (this.tm > 0) { this.tm -= dt; if (this.tm <= 0) this.startWave(); }
    } else if (this.ph === 2) this.waveTick(dt);
  }
  startWave() {
    this.w++; this.ph = 2; this.sp = 0; this.sc = 0.5; this.tm = 0; this.wt = 0;
    this.pc = Math.max(1, this.occupied().length);
    this.hs = hpScale(this.w, this.pc);
    this.ready.fill(false);
  }
  /** Adds gold, kept to whole cents so shared fractions never show up as 49.999... */
  addGold(i, x) { this.gold[i] = Math.round((this.gold[i] + x) * 100) / 100; }
  waveTick(dt) {
    const total = waveTotal(this.w, this.pc);
    // the crystal's drip: 1 gold a second to every seat, until half of the wave bonus is paid
    this.wt++;
    if (this.wt % DRIP_EVERY === 0 && this.wt / DRIP_EVERY <= dripCap(this.w)) {
      for (const i of this.occupied()) this.gold[i] += 1;
      this.fx(5, CRYSTAL.x + 0.5, CRYSTAL.y + 0.5, 1, 0);
    }
    if (this.sp < total) {
      this.sc -= dt;
      if (this.sc <= 0 && this.enemies.length < MAX_ENEMIES) {
        const ty = enemyTypeAt(this.w, this.sp, this.pc), ln = this.sp % 2, p = posAt(ln, 0);
        this.enemies.push({ id: this.nid, ty, ln, d: 0, pd: 0, hp: ENEMIES[ty].hp * this.hs, sl: 0, x: p[0], y: p[1], dead: false, leak: false, killer: -1 });
        this.nid = (this.nid % 99999) + 1;
        this.sp++;
        this.sc = spawnInterval(this.w, this.pc) * (ty === 3 ? 2.5 : ty === 2 ? 1.3 : 1);
      }
    }
    let leaked = 0;
    for (const e of this.enemies) {
      if (e.dead) continue; // killed by a spell between ticks: paid out below
      e.pd = e.d;
      if (e.sl > 0) e.sl = Math.max(0, e.sl - dt);
      e.d += ENEMIES[e.ty].speed * (e.sl > 0 ? SLOW_FACTOR : 1) * dt;
      if (e.d >= PATHS[e.ln].len) { e.dead = true; e.leak = true; leaked += ENEMIES[e.ty].leak; }
      else { const p = posAt(e.ln, e.d); e.x = p[0]; e.y = p[1]; }
    }
    if (leaked) this.l -= leaked;
    for (let i = 0; i < MAX_SEATS; i++) if (this.gr[i] > 0) this.gr[i] = Math.max(0, this.gr[i] - dt);
    for (const tw of this.towers.values()) { if (tw.bt > 0) tw.bt = Math.max(0, tw.bt - dt); this.fire(tw, dt); }
    const alive = [];
    for (const e of this.enemies) {
      if (e.leak) continue;
      if (e.dead) {
        // half the bounty to whoever landed the kill, half shared by everyone at the table
        const g = ENEMIES[e.ty].gold, team = this.present(), share = team.length ? g * KILL_SHARE / team.length : 0;
        if (e.killer >= 0) { this.addGold(e.killer, g * (1 - KILL_SHARE) * (this.gr[e.killer] > 0 ? 2 : 1)); this.kills[e.killer]++; }
        for (const i of team) this.addGold(i, share);
        this.fx(4, e.x, e.y, e.ty, e.killer + 1, Math.round(share * 100));
        continue;
      }
      alive.push(e);
    }
    this.enemies = alive;
    if (this.l <= 0) { this.l = 0; this.ph = 3; this.enemies = []; this.gr.fill(0); return; }
    if (this.sp >= total && !this.enemies.length) {
      // the rest of the wave bonus (the crystal dripped the first part during the wave)
      const bonus = waveBonus(this.w), dripped = Math.min(dripCap(this.w), Math.floor(this.wt / DRIP_EVERY));
      for (const i of this.occupied()) this.gold[i] += bonus - dripped;
      this.bk += bonus;
      this.gr.fill(0);
      for (const tw of this.towers.values()) tw.bt = 0;
      if (this.w >= MAX_WAVES) this.ph = 4;
      else {
        this.ph = 1; this.tm = BREAK_TIME; this.ready.fill(false);
        if (cardWave(this.w)) for (const i of this.occupied()) this.offer[i] = drawOffer(this.w, i, this.pv[i], this.nid);
      }
    }
  }
  hit(e, dmg, owner) {
    if (e.dead) return;
    e.hp -= dmg;
    if (e.hp <= 0) { e.dead = true; e.killer = owner; }
  }
  fire(tw, dt) {
    if (tw.cd > 0) tw.cd -= dt;
    if (tw.cd > 0) return;
    const s = towerStatsFor(tw.ty, tw.lv, tw.o >= 0 ? this.pv[tw.o] : 0);
    const cx = tw.c % COLS + 0.5, cy = ((tw.c / COLS) | 0) + 0.5, r2 = s.range * s.range;
    let best = null, bestRem = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - cx, dy = e.y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const rem = PATHS[e.ln].len - e.d;
      if (rem < bestRem) { bestRem = rem; best = e; }
    }
    if (!best) { tw.cd = 0; return; }
    tw.cd += tw.bt > 0 ? s.rate / 2 : s.rate;
    const dmg = s.dmg * (1 + SYN_BONUS * (this.syn.get(tw.c) || 0)), o = tw.o;
    if (tw.ty === 0) {
      this.fx(0, cx, cy, best.x, best.y);
      this.hit(best, dmg, o);
    } else if (tw.ty === 1 || tw.ty === 2) {
      const bx = best.x, by = best.y, sr2 = s.splash * s.splash;
      this.fx(tw.ty, cx, cy, bx, by);
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.x - bx, dy = e.y - by;
        if (e !== best && dx * dx + dy * dy > sr2) continue;
        if (tw.ty === 2) e.sl = Math.max(e.sl, s.slowDur);
        this.hit(e, e === best ? dmg : dmg * (tw.ty === 1 ? 0.55 : 0.5), o);
      }
    } else {
      const hitSet = new Set(), cr2 = s.chainRange * s.chainRange;
      let fx0 = cx, fy0 = cy, target = best, k = 0, dd = dmg;
      while (target && k <= s.chain) {
        hitSet.add(target);
        const tx = target.x, ty = target.y;
        this.fx(3, fx0, fy0, tx, ty);
        this.hit(target, dd, o);
        fx0 = tx; fy0 = ty; dd *= 0.75; k++;
        let nb = null, nd = Infinity;
        for (const e of this.enemies) {
          if (e.dead || hitSet.has(e)) continue;
          const dx = e.x - tx, dy = e.y - ty, d2 = dx * dx + dy * dy;
          if (d2 <= cr2 && d2 < nd) { nd = d2; nb = e; }
        }
        target = nb;
      }
    }
  }
  /**
   * An effect for the renderer. Never affects the game.
   * Shots 0-3: [kind, x*10, z*10, target x*10, target z*10]; death 4: [4, x*10, z*10, type, killer+1, shared gold*100];
   * crystal drip 5: [5, x*10, z*10, gold, 0]; spell 6: [6, x*10, z*10, spell id, radius*10].
   */
  fx(kind, a, b, c, d, e = 0) {
    if (!this.onFx) return;
    const raw = kind >= 4;
    this.onFx([kind, Math.round(a * 10), Math.round(b * 10), raw ? c : Math.round(c * 10), raw ? d : Math.round(d * 10), e]);
  }
  /** A checksum of the whole game state. Copies compare it with the host's to catch any divergence. */
  stateHash() {
    let h = 2166136261 | 0;
    for (const x of [this.t, this.ph, this.w, this.l, this.tm, this.sp, this.sc, this.pc, this.hs, this.bk, this.u, this.nid, this.wt, this.pz]) h = mix(h, x);
    for (let i = 0; i < MAX_SEATS; i++) {
      h = mix(h, this.gold[i]); h = mix(h, this.kills[i]); h = mix(h, this.ready[i] ? 1 : 0); h = mix(h, this.pv[i]); h = mix(h, this.gr[i]);
      for (const c of this.hand[i]) h = mix(h, c + 100);
      for (const c of this.offer[i]) h = mix(h, c + 200);
      const st = this.seats[i];
      for (let k = 0; k < st.length; k++) h = Math.imul(h ^ st.charCodeAt(k), 16777619);
    }
    for (const tw of this.towers.values()) { h = mix(h, tw.c); h = mix(h, tw.ty * 4 + tw.lv); h = mix(h, tw.o); h = mix(h, tw.cd); h = mix(h, tw.bt); }
    for (const e of this.enemies) { h = mix(h, e.id); h = mix(h, e.d); h = mix(h, e.hp); h = mix(h, e.sl); }
    return h >>> 0;
  }
}
