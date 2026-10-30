# Crystal Tower: notes for working on the code

Co-op 3D tower defense in the browser for up to 5 players. Plain ES modules, Three.js r128, MQTT.js,
WebRTC, bundled with Vite. Live at https://olbdck.github.io/crystal-tower/ (deployed by GitHub Actions).

## Language

- The game's interface text is Ukrainian. Keep new UI strings in Ukrainian, in the same tone.
- Everything else is English: code comments, README, this file, commit messages, PR texts, issue texts.

## Commands

```bash
npm run dev          # http://localhost:5173, live reload, public brokers
npm run dev:broker   # local MQTT broker; then open http://localhost:5173/?broker=ws://127.0.0.1:8888
npm test             # unit tests + build + Playwright e2e (run before every commit)
npm run test:unit    # node --test, fast
npm run test:e2e     # needs a build (npm run build) and Chromium
npm run balance      # seeded bots play full games with 1-5 players (average wave, wins); -- 32 for more games
npm run netstats     # bytes per second of the game stream
PERF=1 npx playwright test tests/e2e/perf.spec.js   # render benchmark (draw calls, ms per frame)
```

## Map

| Path | Role |
|---|---|
| `src/sim/rules.js` | Board, paths, towers, enemies, waves, prices. Pure data and functions. |
| `src/sim/sim.js` | The deterministic simulation (`Sim`): seats, actions, ticks, combat, cards, `stateHash()`. |
| `src/sim/cards.js` | Passive cards and spells: data, stat/price modifiers, the deterministic draw of offers. |
| `src/net/transport.js` | WebRTC mesh + MQTT: presence (JSON, channel "game") and the game stream (binary, channel "ev"). |
| `src/net/codec.js` | Binary format: keyframes (full state) and batches of inputs (TICK, ROSTER, ACT, HASH). |
| `src/net/stream.js` | `Recorder` (host: every Sim change goes through it) and `Follower` (replays batches with a playout buffer). |
| `src/net/session.js` | Tables, who hosts, keyframe requests, host handover, version check, rejoin, actions queue. |
| `src/net/view.js` | `getView(now)`: what the renderer and HUD draw, interpolated between ticks. |
| `src/render/` | Scene, models, instancing (towers/enemies as InstancedMesh), pooled effects, overlay, portraits. |
| `src/audio/` | Synthesised sound effects (`sound.js`) and which game moment plays which (`cues.js`). |
| `src/ui/` | HUD, input, join screen, modals, cards (`ui/cards.js`: the pick dialog, spells in hand, passive icons), pause (`ui/pause.js`, with the rule facts; keep them true when rules change). |
| `src/state.js` | Shared runtime state `S` of the tab. |
| `tests/unit/` | Rules, simulation, stream (host vs copy stays identical), balance. |
| `tests/e2e/` | Several browser contexts play together through a local aedes broker. |

## How the multiplayer works (keep these invariants)

1. One tab hosts: it runs the `Sim` at 30 ticks/s from a Web Worker timer. All other tabs, seated or not,
   run their own copy fed by the host's stream. There is no separate server.
2. **The simulation must stay deterministic.** Every copy must compute bit-identical numbers:
   - no `Math.random`, `Date`, `performance.now` or other clocks inside `src/sim/`;
   - no engine-dependent maths in anything that affects state (`Math.pow`, `Math.hypot`, `Math.sin`,
     `Math.exp`, ...); `+ - * /`, `Math.sqrt`, `Math.floor/round/min/max/abs` are safe;
   - iterate Maps and arrays in insertion order (keyframes keep the order);
   - effects (`fx`) are output only and must never change state.
3. **On the host, every change to the Sim goes through `Recorder`** (`roster`, `act`, `step`) so that the
   stream carries it. Never mutate `S.sim` directly on the host.
4. When adding state to `Sim`, add it to `encodeKeyframe`/`decodeKeyframe` in `codec.js` and to
   `stateHash()`. When changing the binary layout, bump `FORMAT` in `codec.js`.
5. A new player action: send it with `act("x", ...)` (up to 3 small integer arguments, see `cleanAction`)
   and handle it in `Sim.apply`. Validate everything in `apply`: actions come from other players' browsers.
6. Presence fields (JSON, small): `n` name, `j` join time, `hid` tab hidden, `mob` touch device,
   `v`/`vt` build id/time, `a` unacknowledged actions, `h`/`y` hovered cell and selected card, `H` epoch of
   the game this player hosts. The host is whoever announces `H` and streams that epoch; the highest epoch
   wins, ties go to the smaller player id.
7. Players at one table must run the same build (`BUILD` from the git commit). Do not weaken the version
   check: different builds would simulate differently.

## Rendering

- Towers and enemies are drawn with `InstancedMesh` buckets (`render/instancing.js`); effects come from
  pools (`render/fx.js`). Avoid allocating objects per frame in render loops.
- Shadows update only when something static changes (`takeShadowDirty`).
- `window.KV_TEST = { noRender: true }` skips WebGL in tests.

## Tests

- Add a unit test for rule or simulation changes, and keep `tests/unit/stream.test.js` green: it checks
  that a copy replaying the stream ends identical to the host over whole games.
- e2e tests drive the game through `window.__kv` (exists only when `window.KV_TEST` is set). Use
  `waitView` with polling (background pages throttle animation frames).
- Free cells for test towers: 104, 105, 106, 124, 125, 126 (cells 83-85 are on the path).

## Commits

Small, focused commits with an English imperative subject line ("Add ...", "Fix ..."). CI runs all tests on
push and deploys `main` to GitHub Pages.
