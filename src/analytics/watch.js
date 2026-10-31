// Wires the play statistics to the running game: looks at the view with every HUD update (main.js),
// hears our own actions as act() sends them, and reports a game left unfinished when the tab closes.
import { S } from "../state.js";
import { mySeat } from "../game.js";
import { getView } from "../net/view.js";
import { setActionListener, hostDebug } from "../net/session.js";
import { initAnalytics, track } from "./ga.js";
import { GameWatch, actionEvent } from "./events.js";

/** How this tab reaches the others: the weakest of its links. */
function linkKind() {
  if (S.soloMode) return "solo";
  const links = S.room && S.room.links ? Object.values(S.room.links()) : [];
  if (!links.length) return "alone";
  if (links.some(l => l.kind === "server" || l.kind === "connecting")) return "server";
  return links.some(l => l.kind === "turn") ? "relay" : "direct";
}

const watch = new GameWatch({ link: linkKind, resyncs: () => hostDebug().follow.resyncs });
const send = e => { if (e) track(e[0], e[1]); };

export function watchGame(v, now) {
  const evs = watch.observe({
    v, seat: mySeat(v), now, joined: S.joined, host: S.isHost,
    via: S.soloMode ? "solo" : S.invitedByHash ? "invite" : "own",
    blocked: !!S.versionBlock, newer: !!(S.versionBlock && S.versionBlock.newer),
  });
  for (const e of evs) send(e);
}

/** Every drawn frame: counts frame times during waves while the tab is visible. */
export function watchFrame(v, dt) { if (v && v.ph === 2 && !document.hidden) watch.frame(dt); }

export function initStats() {
  initAnalytics();
  setActionListener((code, a1, a2) => { const v = getView(performance.now()); send(actionEvent(v, mySeat(v), code, a1, a2)); });
  addEventListener("pagehide", () => { const now = performance.now(); watchGame(getView(now), now); send(watch.quit(now)); });
}

export { track };
