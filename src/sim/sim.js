// Authoritative game simulation. Only the host runs it; everyone else shows the state it publishes.
import {
  BLOCKED, BREAK_TIME, COLS, ENEMIES, GIFT, MAX_ENEMIES, MAX_SEATS, MAX_TOWERS, MAX_WAVES, PATHS, ROWS, SEAT_GRACE, SLOW_FACTOR, START_GOLD, START_LIVES, SYN_BONUS, TOWERS, enemyTypeAt, hpScale, posAt, sellValue, spawnInterval, synergyAt, towerStats, upgradeCost, waveTotal,
} from "./rules.js";

export class Sim {
  constructor() {
    this.e = 1; this.t = 0; this.ak = new Map(); this.gone = new Map(); this.onFx = null; this.fxOut = [];
    this.reset(["", "", "", "", ""]);
  }
  reset(seats) {
    this.ph = 1; this.w = 0; this.l = START_LIVES; this.tm = -1; this.sp = 0; this.sc = 0; this.pc = 1; this.hs = 1;
    this.bk = START_GOLD; this.u = 0;
    this.seats = seats.slice();
    this.gold = [0, 0, 0, 0, 0].map(() => START_GOLD);
    this.kills = [0, 0, 0, 0, 0];
    this.ready = [false, false, false, false, false];
    for (let i = 0; i < MAX_SEATS; i++) if (this.seats[i]) this.u |= 1 << i;
    this.towers = new Map(); this.enemies = []; this.nid = 1; this.syn = new Map(); this.tv = (this.tv || 0) + 1;
  }
  occupied() { const r = []; for (let i = 0; i < MAX_SEATS; i++) if (this.seats[i]) r.push(i); return r; }
  assignSeats(joinedSorted) {
    const present = new Set(joinedSorted);
    // a player who drops out keeps the seat (and their acked actions) for SEAT_GRACE ticks, so short reconnects change nothing
    for (const p of [...this.gone.keys()]) if (present.has(p)) this.gone.delete(p);
    for (const p of [...this.seats.filter(Boolean), ...this.ak.keys()]) if (!present.has(p) && !this.gone.has(p)) this.gone.set(p, this.t);
    const expired = p => this.gone.has(p) && this.t - this.gone.get(p) > SEAT_GRACE;
    for (let i = 0; i < MAX_SEATS; i++) if (this.seats[i] && expired(this.seats[i])) { this.seats[i] = ""; this.ready[i] = false; }
    for (const peer of joinedSorted) {
      if (this.seats.includes(peer)) continue;
      const free = this.seats.indexOf("");
      if (free < 0) break;
      this.seats[free] = peer; this.ready[free] = false;
      if (!(this.u & (1 << free))) {
        this.u |= 1 << free;
        if (this.w > 0) this.gold[free] = Math.max(this.gold[free], Math.round(this.bk * 0.6));
      }
    }
    for (const k of [...this.ak.keys()]) if (expired(k)) this.ak.delete(k);
    for (const k of [...this.gone.keys()]) if (expired(k)) this.gone.delete(k);
  }
  recomputeSyn() {
    this.syn = new Map();
    for (const tw of this.towers.values()) this.syn.set(tw.c, synergyAt(this.towers, tw));
  }
  apply(seat, it) {
    const code = it[1];
    if (code === "b") {
      const cell = it[2], ty = it[3];
      if (!Number.isInteger(cell) || cell < 0 || cell >= COLS * ROWS || !Number.isInteger(ty) || ty < 0 || ty >= TOWERS.length) return;
      if (this.ph > 2 || BLOCKED[cell] || this.towers.has(cell) || this.towers.size >= MAX_TOWERS) return;
      const cost = TOWERS[ty].cost;
      if (this.gold[seat] < cost) return;
      this.gold[seat] -= cost;
      this.towers.set(cell, { c: cell, ty, lv: 1, o: seat, cd: 0 }); this.tv++;
      this.recomputeSyn();
    } else if (code === "u") {
      const tw = this.towers.get(it[2]);
      if (!tw || tw.lv >= 3 || this.ph > 2) return;
      const cost = upgradeCost(tw.ty, tw.lv);
      if (this.gold[seat] < cost) return;
      this.gold[seat] -= cost; tw.lv++; this.tv++;
    } else if (code === "s") {
      const tw = this.towers.get(it[2]);
      if (!tw || tw.o !== seat || this.ph > 2) return;
      this.gold[seat] += sellValue(tw.ty, tw.lv);
      this.towers.delete(tw.c); this.recomputeSyn(); this.tv++;
    } else if (code === "r") {
      if (this.ph === 1) this.ready[seat] = !!it[2];
    } else if (code === "g") {
      const to = it[2];
      if (!Number.isInteger(to) || to < 0 || to >= MAX_SEATS || to === seat || !this.seats[to]) return;
      if (this.gold[seat] < GIFT) return;
      this.gold[seat] -= GIFT; this.gold[to] += GIFT;
    } else if (code === "n") {
      if (this.ph >= 3) this.reset(this.seats);
    }
  }
  step(dt) {
    this.t++;
    if (this.ph === 1) {
      const occ = this.occupied();
      if (occ.length && occ.every(i => this.ready[i])) this.startWave();
      else if (this.tm > 0) { this.tm -= dt; if (this.tm <= 0) this.startWave(); }
    } else if (this.ph === 2) this.waveTick(dt);
  }
  startWave() {
    this.w++; this.ph = 2; this.sp = 0; this.sc = 0.5; this.tm = 0;
    this.pc = Math.max(1, this.occupied().length);
    this.hs = hpScale(this.w, this.pc);
    this.ready.fill(false);
  }
  waveTick(dt) {
    const total = waveTotal(this.w, this.pc);
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
      e.pd = e.d;
      if (e.sl > 0) e.sl = Math.max(0, e.sl - dt);
      e.d += ENEMIES[e.ty].speed * (e.sl > 0 ? SLOW_FACTOR : 1) * dt;
      if (e.d >= PATHS[e.ln].len) { e.dead = true; e.leak = true; leaked += ENEMIES[e.ty].leak; }
      else { const p = posAt(e.ln, e.d); e.x = p[0]; e.y = p[1]; }
    }
    if (leaked) this.l -= leaked;
    for (const tw of this.towers.values()) this.fire(tw, dt);
    const alive = [];
    for (const e of this.enemies) {
      if (e.leak) continue;
      if (e.dead) {
        if (e.killer >= 0) { this.gold[e.killer] += ENEMIES[e.ty].gold; this.kills[e.killer]++; }
        this.fx(4, e.x, e.y, e.ty, e.killer + 1);
        continue;
      }
      alive.push(e);
    }
    this.enemies = alive;
    if (this.l <= 0) { this.l = 0; this.ph = 3; this.enemies = []; return; }
    if (this.sp >= total && !this.enemies.length) {
      const bonus = 20 + 4 * this.w;
      for (const i of this.occupied()) this.gold[i] += bonus;
      this.bk += bonus;
      if (this.w >= MAX_WAVES) this.ph = 4;
      else { this.ph = 1; this.tm = BREAK_TIME; this.ready.fill(false); }
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
    const s = towerStats(tw.ty, tw.lv);
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
    tw.cd += s.rate;
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
  fx(kind, a, b, c, d) {
    const f = [kind, Math.round(a * 10), Math.round(b * 10), kind === 4 ? c : Math.round(c * 10), kind === 4 ? d : Math.round(d * 10)];
    this.fxOut.push(f);
    if (this.fxOut.length > 40) this.fxOut.shift();
    if (this.onFx) this.onFx(f);
  }
  serialize() {
    const T = [], E = [], F = [], ak = [];
    for (const tw of this.towers.values()) T.push(tw.c, tw.ty, tw.lv, tw.o);
    for (const e of this.enemies) E.push(e.id, e.ty, e.ln, Math.round(e.d * 100), Math.max(1, Math.ceil(e.hp)), Math.round(e.sl * 10));
    for (const f of this.fxOut) F.push(f[0], f[1], f[2], f[3], f[4]);
    this.fxOut = [];
    for (const [k, v] of this.ak) ak.push(k, v);
    let r = 0;
    this.ready.forEach((x, i) => { if (x) r |= 1 << i; });
    return {
      v: 1, e: this.e, t: this.t, ph: this.ph, w: this.w, l: this.l, tm: Math.round(this.tm * 10), sp: this.sp,
      sc: Math.round(this.sc * 100), pc: this.pc, hs: Math.round(this.hs * 1000), bk: Math.round(this.bk), u: this.u,
      st: this.seats.slice(), g: this.gold.map(x => Math.floor(x)), k: this.kills.slice(), r, T, E, F, ak, n: this.nid,
    };
  }
  static fromSnapshot(s) {
    const m = new Sim();
    const num = (x, d) => (typeof x === "number" && Number.isFinite(x) ? x : d);
    m.e = num(s.e, 1); m.t = num(s.t, 0);
    m.ph = [1, 2, 3, 4].includes(s.ph) ? s.ph : 1;
    m.w = Math.max(0, Math.min(MAX_WAVES, num(s.w, 0) | 0));
    m.l = num(s.l, START_LIVES); m.tm = num(s.tm, -10) / 10; m.sp = num(s.sp, 0); m.sc = num(s.sc, 0) / 100;
    m.pc = Math.max(1, Math.min(MAX_SEATS, num(s.pc, 1) | 0)); m.hs = num(s.hs, 1000) / 1000;
    m.bk = num(s.bk, START_GOLD); m.u = num(s.u, 0) | 0; m.nid = num(s.n, 1);
    for (let i = 0; i < MAX_SEATS; i++) {
      m.seats[i] = Array.isArray(s.st) && typeof s.st[i] === "string" ? s.st[i] : "";
      m.gold[i] = Array.isArray(s.g) ? num(s.g[i], START_GOLD) : START_GOLD;
      m.kills[i] = Array.isArray(s.k) ? num(s.k[i], 0) : 0;
      m.ready[i] = !!(num(s.r, 0) & (1 << i));
    }
    if (Array.isArray(s.T)) for (let i = 0; i + 3 < s.T.length; i += 4) {
      const c = s.T[i], ty = s.T[i + 1], lv = s.T[i + 2], o = s.T[i + 3];
      if (!Number.isInteger(c) || c < 0 || c >= COLS * ROWS || BLOCKED[c] || !TOWERS[ty] || !(lv >= 1 && lv <= 3) || !(o >= 0 && o < MAX_SEATS)) continue;
      m.towers.set(c, { c, ty, lv, o, cd: 0 });
    }
    if (Array.isArray(s.E)) for (let i = 0; i + 5 < s.E.length; i += 6) {
      const ty = s.E[i + 1], ln = s.E[i + 2];
      if (!ENEMIES[ty] || !PATHS[ln]) continue;
      const d = num(s.E[i + 3], 0) / 100, p = posAt(ln, d);
      m.enemies.push({ id: s.E[i], ty, ln, d, pd: d, hp: num(s.E[i + 4], 1), sl: num(s.E[i + 5], 0) / 10, x: p[0], y: p[1], dead: false, leak: false, killer: -1 });
    }
    if (Array.isArray(s.ak)) for (let i = 0; i + 1 < s.ak.length; i += 2) if (typeof s.ak[i] === "string" && Number.isFinite(s.ak[i + 1])) m.ak.set(s.ak[i], s.ak[i + 1]);
    m.recomputeSyn();
    return m;
  }
}
