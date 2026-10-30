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
- Each player has their own gold. A kill pays half its bounty to the owner of the tower that landed it; the other half is shared equally by everyone at the table, so nobody is left without income. During a wave the crystal also gives everyone 1 gold a second, up to half of the wave bonus; the rest of the bonus comes when the wave is cleared.

Any seated player can pause the game for everyone with the pause button or `P`, and anyone can resume it; while paused, the sign shows a fact from the rules. A paused wave stands still: no building, upgrading, selling or spells until it goes on.

During a wave the round button turns into **«Завершити»** (Finish, key `F`): when everyone at the table agrees, the rest of the wave is played out at once. The result is exactly what waiting would give, just without the wait.

The **×1 / ×2** button (key `X`) asks for double speed; the game runs at ×2 once everyone at the table has asked.

Keys: `F` finish the wave, `X` double speed, `P` pause, `1–4` towers, `5–7` spells, `U` upgrade, `S` sell, `R` ready, `Esc` cancel.

## Cards

After every third wave (3, 6, … 18) each player picks 1 of 3 cards, drawn for them alone. The pick has to be made before pressing ready.

- **Єдність (Unity)** is offered at every pick until you take it: your own towers of different types next to each other give each other synergy (+15% per other type, up to +30%). It matters most when playing alone, where there are no other players' towers to team up with.
- **Passive cards** stay for the rest of the game and act on your own towers or on what you pay: cheaper Archers or upgrades, longer frost, a wider cannon blast, one more lightning jump, +10% range or damage, a better refund when selling. They show as small icons next to your name.
- **Spells** cost gold, are cast once during a wave and then disappear (up to 3 in hand): Fireball, Blizzard (everyone slowed), Earthquake (enemies pushed back), Crystal Power (+3 lives), Overcharge (a tower fires twice as fast for 8 s) and Gold Rush (double kill share for 10 s). Damage grows with the waves.
- Enemies get a little tougher after each card pick, more so with more players, so the cards add choices rather than make the game easy.

## Synergy

A tower deals +15% damage for every *other* player whose tower stands on one of the 8 cells around it (diagonals count), up to +60%. Several towers of the same player count once, and your own towers do not count. The bonus is mutual: building next to a friend's tower strengthens theirs too.

- While choosing a spot, the label above the tower preview shows the bonus it would get and its boosted damage, and the towers it would strengthen are marked underneath.
- Towers with a bonus have a golden aura that gets brighter as the bonus grows; selecting a tower highlights the towers that boost it.
- The bonus multiplies damage for every tower type: each arrow, the cannon blast and its splash, frost damage (slow duration stays the same), and every lightning jump.

## How it works

- The game is plain JavaScript modules bundled with Vite; Three.js and MQTT.js come from npm.
- Players talk directly browser-to-browser over WebRTC data channels (a full mesh, at most 5 players). Typical round trips are tens of milliseconds instead of seconds through a relay.
- To find each other, players use a public MQTT broker over a secure WebSocket (WSS). The broker carries the connection offers (signaling), keeps each player's presence and the latest game keyframe for whoever joins next, and acts as a fallback if a direct channel cannot be made.
- NAT traversal: Google STUN servers find each player's public address. When a strict NAT (mobile data, some home routers) blocks a direct path, traffic goes through a TURN relay. By default the free shared [Open Relay](https://www.metered.ca/tools/openrelay/) TURN is used.
- The party list shows how each player is reached: `пряме` (direct), `TURN` (relayed), or `через сервер` (broker fallback), with the measured round trip.
- The first letter of the table code tells which broker the table uses (`e` = EMQX, `h` = HiveMQ, `m` = Mosquitto). A new table goes to whichever broker answers first.

### One simulation, played everywhere

- One player's browser (the host) runs the simulation and decides. Instead of sending the state of the board, it sends the simulation's *inputs*: ticks, who sits at the table, and each action it applied. Every other browser replays them on its own copy of the simulation, which is deterministic, so all copies stay bit-for-bit identical. Shots, explosions and kills are computed locally too.
- The inputs travel in small binary batches about 30 times a second: a few hundred bytes per second per player, against 9 KB/s on average (up to 26 KB/s in late waves) for the JSON snapshots used before. Check with `npm run netstats`.
- A keyframe (the full state, 1-3 KB) starts a copy: when a player joins, after a lost batch, and when the host changes. Every second the stream also carries a checksum of the host's state; a copy that differs asks for a keyframe and continues from it.
- Each copy plays the batches back at real-time pace a couple of ticks behind the newest one, so enemies move smoothly even when packets arrive unevenly. The buffer grows after a hiccup and shrinks again on a steady connection.
- Actions such as building are applied by the host as soon as they arrive, and the stream carries the confirmation. The top-left plaque shows this round trip in milliseconds.

### When something goes wrong

- The host keeps the job even when its tab is in the background, because the simulation ticks from a Web Worker.
- If the host's tab closes, the next player takes over in about a second; if the host freezes or its stream stops, within 2-3.5 seconds. Visible tabs and desktops are preferred over phones. The new host continues from its own copy, so nothing is lost.
- A player who drops out or reloads keeps their seat, gold and towers for 3 minutes. Within 10 minutes the page sits them back down by itself. After 3 minutes the seat is freed; their towers stay on the board without an owner.
- Everyone at a table must run the same version of the game. A player with an older or newer page cannot sit down and is told whose page needs a refresh.
- When everyone leaves a table, it disappears.

Note: public brokers are open, so anyone who knows a table code could read that table's game messages. The game sends nothing beyond player names and game state.

## Network settings

Network settings live in `NET_CONFIG` in `src/config.js`.

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
npm run balance        # seeded bot teams of 1-5 players play full games; average wave and wins
npm run netstats       # how many bytes per second the game stream sends during a game
```

Code layout:

| Path | What it holds |
|---|---|
| `src/sim/` | Game rules and the simulation. Pure JavaScript, no DOM, tested in Node. |
| `src/net/` | Network transport (WebRTC + MQTT), the session (tables, host, actions), the binary game stream (`codec.js`, `stream.js`) and the view the UI draws. |
| `src/render/` | Three.js scene, models, effects, 2D overlay and card portraits. |
| `src/ui/` | HUD, input, join screen and dialogs. |
| `src/main.js` | Boot and the frame loop. |
| `tests/unit/` | `node --test` tests for rules, simulation, the game stream and balance. |
| `tests/e2e/` | Playwright tests: several browser tabs play together through a local broker. |

GitHub Actions runs all tests on every push and pull request, and deploys `main` to GitHub Pages
(Settings → Pages → Source: **GitHub Actions**).

The sources also run without a build from any static server (`python3 -m http.server`), using the import map in `index.html`.

`CLAUDE.md` describes the architecture and the rules to keep when changing the code.
