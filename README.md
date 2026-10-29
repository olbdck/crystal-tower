# Crystal Tower

A cooperative 3D tower defense game for the browser, for up to 5 players at one table. Shadow pieces march along two paths toward your crystal, and the team builds towers together. A tower hits harder when another player's tower stands next to it.

No sign-up needed: open the link, enter a name, and play.

**Play:** https://olbdck.github.io/crystal-tower/

The in-game interface is in Ukrainian.

## Playing together

- Open the game and press the button to open your own table. A table code appears in the address, for example `#stil-k3m9qa`.
- Press **«Запросити»** (Invite) on any empty seat in the player list. A link to your table is copied; send it to your friends.
- You can also just tell friends the table code, shown in the top-left corner. They enter it in the table-code field on the start screen.
- Up to 5 players per table. Anyone else watches and takes a seat when one frees up.
- A wave starts when everyone is ready, or after a 20-second break. There are 20 waves; every fifth one brings a boss.

Keys: `1–4` towers, `U` upgrade, `S` sell, `R` ready, `Esc` cancel.

## Synergy

A tower deals +15% damage for every *other* player whose tower stands on one of the 8 cells around it (diagonals count), up to +60%. Several towers of the same player count once, and your own towers do not count. The bonus is mutual: building next to a friend's tower strengthens theirs too.

- While choosing a spot, the label above the tower preview shows the bonus it would get and its boosted damage, and the towers it would strengthen are marked underneath.
- Towers with a bonus have a golden aura that gets brighter as the bonus grows; selecting a tower highlights the towers that boost it.
- The bonus multiplies damage for every tower type: each arrow, the cannon blast and its splash, frost damage (slow duration stays the same), and every lightning jump.

## How it works

- The game is plain JavaScript modules bundled with Vite; Three.js and MQTT.js come from npm.
- Players talk directly browser-to-browser over WebRTC data channels (a full mesh, at most 5 players). Typical round trips are tens of milliseconds instead of seconds through a relay.
- To find each other, players use a public MQTT broker over a secure WebSocket (WSS). The broker carries the connection offers (signaling), keeps a copy of each player's state for whoever joins next, and acts as a slow fallback if a direct channel cannot be made.
- NAT traversal: Google STUN servers find each player's public address. When a strict NAT (mobile data, some home routers) blocks a direct path, traffic goes through a TURN relay. By default the free shared [Open Relay](https://www.metered.ca/tools/openrelay/) TURN is used.
- The party list shows how each player is reached: `пряме` (direct), `TURN` (relayed), or `через сервер` (broker fallback, slow), with the measured round trip.
- The first letter of the table code tells which broker the table uses (`e` = EMQX, `h` = HiveMQ, `m` = Mosquitto). A new table goes to whichever broker answers first.
- One player's browser (the host) runs the simulation and sends a snapshot about 10 times a second. The host keeps the job even when its tab is in the background, because the simulation ticks from a Web Worker. If the host leaves or its updates stop for 3.5 seconds, the next player takes over (visible tabs and desktops are preferred over phones) and the game continues.
- Between snapshots every client moves enemies forward on its own (they walk fixed paths at known speeds), and small corrections are blended in, so movement stays smooth even when the network is uneven.
- Actions such as building are applied by the host as soon as they arrive and confirmed in the next snapshot. The top-left plaque shows this round trip in milliseconds.
- A player who drops out briefly or reloads the tab keeps their seat and gold for 10 seconds.
- When everyone leaves a table, it disappears.

Note: public brokers are open, so anyone who knows a table code could read that table's game messages. The game sends nothing beyond player names and game state.

## Network settings

At the top of the `NETWORK TRANSPORT` block in `index.html` there is a `NET_CONFIG` setting.

For more reliable relaying, add your own TURN server, for example the free tier of [ExpressTURN](https://www.expressturn.com/) (1000 GB/month) or a [Metered](https://www.metered.ca/tools/openrelay/) app key, which returns the TURN servers nearest to each player:

```js
turn: [{ urls: "turn:YOUR-SERVER.expressturn.com:3478", username: "...", credential: "..." }],
metered: { app: "your-app", apiKey: "..." },
```

To use your own MQTT broker, list it first in `brokers`:

```js
brokers: [
  { id: "x", url: "wss://mqtt.example.com:8084/mqtt" },
  { id: "e", url: "wss://broker.emqx.io:8084/mqtt" },
],
```

Rendering adapts to the device: resolution is capped at 1.5× and lowers itself if the frame rate drops.

## Development

Requirements: Node.js 22.12 or newer.

```bash
npm install
npm run dev            # game at http://localhost:5173 with live reload
npm run dev:broker     # optional: local MQTT broker, then open http://localhost:5173/?broker=ws://127.0.0.1:8888
npm test               # unit tests, build, end-to-end multiplayer tests
npm run balance        # bot teams of 1-5 players play full games and report how far they got
```

Code layout:

| Path | What it holds |
|---|---|
| `src/sim/` | Game rules and the simulation. Pure JavaScript, no DOM, tested in Node. |
| `src/net/` | Network transport (WebRTC + MQTT), the session (tables, host, actions) and the view the UI draws. |
| `src/render/` | Three.js scene, models, effects, 2D overlay and card portraits. |
| `src/ui/` | HUD, input, join screen and dialogs. |
| `src/main.js` | Boot and the frame loop. |
| `tests/unit/` | `node --test` tests for rules, simulation and balance. |
| `tests/e2e/` | Playwright tests: several browser tabs play together through a local broker. |

GitHub Actions runs all tests on every push and pull request, and deploys `main` to GitHub Pages
(Settings → Pages → Source: **GitHub Actions**).

The sources also run without a build from any static server (`python3 -m http.server`), using the import map in `index.html`.
