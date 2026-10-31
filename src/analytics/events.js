// Which moments of a game become play statistics. Plain functions of the game view, so they are
// tested without a browser (tests/unit/analytics.test.js). Every player reports their own game the
// same way, host or not. Tower and card names go out in Ukrainian, as players see them.
// Never add player names, table codes or anything typed by players.
import { TOWERS } from "../sim/rules.js";
import { SPELLS, PASSIVES, cardOf } from "../sim/cards.js";

const FEATURES = { p: "pause", x: "speed_x2", f: "finish_wave", g: "gift", n: "new_game" };
const seatedCount = v => v.seats.filter(Boolean).length;
const bits = n => { let c = 0; for (; n; n &= n - 1) c++; return c; };
const validCard = code => Number.isInteger(code) && code >= 0 && code < PASSIVES.length + SPELLS.length;

/**
 * The event for one of our own actions as we send it (before the host applies it, see act() in
 * net/session.js), as [name, params], or null for actions that are not counted.
 */
export function actionEvent(v, seat, code, a1, a2) {
  if (!v || seat < 0) return null;
  const wave = v.w;
  if (code === "b") return TOWERS[a2] ? ["tower_build", { tower: TOWERS[a2].name, wave }] : null;
  if (code === "u" || code === "s") {
    const tw = v.tmap.get(a1);
    if (!tw || !TOWERS[tw.ty]) return null;
    if (code === "u") return tw.lv < 3 ? ["tower_upgrade", { tower: TOWERS[tw.ty].name, level: tw.lv + 1, wave }] : null;
    // undo: a tower built in this break comes back for its full price
    return ["tower_sell", { tower: TOWERS[tw.ty].name, level: tw.lv, undo: v.ph === 1 && tw.fr > 0 && tw.o === seat ? 1 : 0, wave }];
  }
  if (code === "k") {
    const offer = v.offer[seat] || [];
    if (!validCard(offer[a1])) return null;
    const c = cardOf(offer[a1]);
    return ["card_pick", { card: c.name, kind: c.spell ? "spell" : "passive", wave, offered: offer.filter(validCard).map(x => cardOf(x).name).join(", ") }];
  }
  if (code === "m") {
    const sp = SPELLS[(v.hand[seat] || [])[a1]];
    return sp ? ["spell_cast", { spell: sp.name, wave }] : null;
  }
  // pause, double speed and finishing a wave count when turned on; gifts and new games always
  if (FEATURES[code] && (code === "g" || code === "n" || a1 === 1)) return ["feature_use", { feature: FEATURES[code], wave }];
  return null;
}

/**
 * Follows one tab's view of the game (a few times a second) and returns the events of what changed:
 * sitting down at a table, a game starting, ending or being left, taking over as host, a table that runs
 * another build. net gives { link(), resyncs() } for the connection summary at the end of a game.
 */
export class GameWatch {
  constructor(net = {}) {
    this.net = net;
    this.joined = false; this.blocked = false;
    this.game = null; // the game we sit in, once its first wave started
    this.lastW = -1; // the wave at our previous look while seated (0: we saw the game before it started)
  }

  /** o: { v, seat, now (ms), joined, via, host, blocked, newer }; returns a list of [name, params]. */
  observe(o) {
    const out = [], v = o.v;
    if (o.blocked && !this.blocked) out.push(["version_mismatch", { mine: o.newer ? "newer" : "older" }]);
    this.blocked = !!o.blocked;
    if (o.joined && !this.joined) out.push(["table_join", { via: o.via || "own" }]);
    this.joined = !!o.joined;
    if (!v || o.seat < 0) { this.game = null; this.lastW = -1; return out; }

    const players = seatedCount(v), role = o.host ? "host" : "guest";
    let g = this.game;
    if (g && v.w === 0) g = this.game = null; // a new game at the same table
    if (!g && v.w >= 1 && v.ph <= 2) {
      const late = this.lastW === 0 ? 0 : 1; // sat down (or reloaded) in the middle of it
      g = this.game = { start: o.now, late, role, players, wave: v.w, ended: false, frames: 0, ms: 0, resyncs: this.resyncs() };
      out.push(["game_start", { players, role, late, wave: v.w }]);
    }
    this.lastW = v.w;
    if (!g) return out;
    if (!g.ended && g.role === "guest" && role === "host") out.push(["host_takeover", { wave: v.w, players }]);
    g.role = role; g.players = players; g.wave = v.w;
    if (!g.ended && v.ph >= 3) {
      g.ended = true;
      out.push(["game_end", {
        result: v.ph === 4 ? "win" : "lose", wave: v.w, players, role, late: g.late, minutes: this.minutes(o.now),
        lives: v.l, passives: bits(v.pv[o.seat]), spells_cast: v.casts[o.seat], towers_built: v.built[o.seat],
        fps: this.fps(), link: this.net.link ? this.net.link() : "", resyncs: this.resyncs() - g.resyncs,
      }]);
    }
    return out;
  }

  /** A frame drawn during a wave, dt in ms: for the average frame rate in game_end. */
  frame(dt) { const g = this.game; if (g && !g.ended && dt > 0 && dt < 250) { g.frames++; g.ms += dt; } }

  /** The tab is closing: the event for a game left unfinished, or null. */
  quit(now) {
    const g = this.game;
    if (!g || g.ended) return null;
    g.ended = true;
    return ["game_quit", { wave: g.wave, players: g.players, role: g.role, late: g.late, minutes: this.minutes(now) }];
  }

  minutes(now) { return this.game ? Math.round((now - this.game.start) / 6000) / 10 : 0; }
  fps() { const g = this.game; return g && g.ms > 0 ? Math.round((1000 * g.frames) / g.ms) : 0; }
  resyncs() { return this.net.resyncs ? this.net.resyncs() : 0; }
}
