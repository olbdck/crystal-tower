// Google Analytics 4 for the play statistics. Only the published game loads it (an id is set and the
// page is served from one of ANALYTICS.hosts): never local development, tests or someone else's copy.
// The page address goes out without the table code after "#" and without query parameters. When an ad
// blocker stops the script, events just wait in dataLayer and nothing breaks.
// Add ?gadebug to the address to see your own events live in the GA DebugView.
import { TEST, ANALYTICS } from "../config.js";

let on = false;
const testing = Object.keys(TEST).length > 0;
const log = testing ? [] : null; // e2e tests read what would have been sent

export function initAnalytics() {
  if (on || testing || !ANALYTICS.id || typeof window === "undefined") return;
  if (!ANALYTICS.hosts.includes(location.hostname)) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); }; // gtag.js expects the arguments object
  const opts = { page_location: location.origin + location.pathname, page_title: document.title };
  if (new URLSearchParams(location.search).has("gadebug")) opts.debug_mode = true;
  window.gtag("js", new Date());
  window.gtag("config", ANALYTICS.id, opts);
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ANALYTICS.id);
  document.head.appendChild(s);
  on = true;
}

/** Sends one event: a name from events.js and a few flat parameters (strings and numbers). */
export function track(name, params) {
  if (log) { log.push({ event: name, ...params }); if (log.length > 500) log.shift(); }
  if (!on) return;
  try { window.gtag("event", name, params || {}); } catch (_) {}
}

/** What was tracked so far in a test page (null outside tests). */
export const trackedEvents = () => log;
