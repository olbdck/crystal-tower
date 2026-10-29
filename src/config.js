/* global __BUILD__ */
// Build id and settings. __BUILD__ is injected by Vite; running the sources without a build reports "src".
export const BUILD = typeof __BUILD__ !== "undefined" ? __BUILD__ : { id: "src", t: 0 };

// Test hooks: e2e tests set window.KV_TEST before the page loads (e.g. { noRender: true }).
export const TEST = (typeof window !== "undefined" && window.KV_TEST) || {};

// Network settings. Tests and self-hosters can override any field with window.KV_NET_CONFIG.
// Players talk directly browser-to-browser over WebRTC data channels, one channel per pair of players.
// A public MQTT broker over WSS is used to find each other, to exchange connection offers (signaling),
// as a slow fallback path when a direct channel cannot be made, and to keep a copy of each player's
// state for whoever joins next.
// ICE: Google STUN finds the public address; when a strict NAT blocks a direct path, a TURN server relays it.
// By default the free shared Open Relay TURN (Metered) is used. For better reliability add your own TURN,
// e.g. ExpressTURN or a Metered API key.
export const NET_CONFIG = Object.assign({
  topicRoot: "crystal-tower/v1",
  brokers: [
    { id: "e", url: "wss://broker.emqx.io:8084/mqtt" },
    { id: "h", url: "wss://broker.hivemq.com:8884/mqtt" },
    { id: "m", url: "wss://test.mosquitto.org:8081" },
  ],
  p2p: true,
  stun: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  // Free shared relay with time-limited credentials derived from a public secret (TURN REST API).
  openRelay: { host: "staticauth.openrelay.metered.ca", secret: "openrelayprojectsecret" },
  // Your own TURN servers, e.g. [{ urls: "turn:YOUR.expressturn.com:3478", username: "...", credential: "..." }]
  turn: [],
  // Optional Metered app: fetches fresh TURN servers nearest to each player.
  metered: { app: "", apiKey: "" },
}, (typeof window !== "undefined" && window.KV_NET_CONFIG) || {});

// Local development: ?broker=ws://127.0.0.1:8888 points the game at your own MQTT broker (npm run dev:broker).
if (typeof location !== "undefined") {
  const broker = new URLSearchParams(location.search).get("broker");
  if (broker && /^wss?:\/\//.test(broker)) NET_CONFIG.brokers = [{ id: "l", url: broker }];
}
