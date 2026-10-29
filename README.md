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

## How it works

- The whole game is a single `index.html` file. Three.js and MQTT.js load from a CDN.
- Players exchange game state through a public MQTT broker over a secure WebSocket (WSS). Because nothing connects browser-to-browser, it works from any network, including mobile data and strict home routers.
- The first letter of the table code tells which broker the table uses (`e` = EMQX, `h` = HiveMQ, `m` = Mosquitto). If the first broker is down when a table is created, the next one is used automatically.
- One player's browser runs the simulation. If that player leaves, another takes over and the game continues.
- A player who drops out briefly or reloads the tab keeps their seat and gold for 10 seconds.
- When everyone leaves a table, it disappears.

Note: public brokers are open, so anyone who knows a table code could read that table's game messages. The game sends nothing beyond player names and game state.

## Using your own broker

At the top of the `NETWORK TRANSPORT` block in `index.html` there is a `NET_CONFIG` setting. Put your broker first in `brokers`, for example a free managed MQTT service or your own Mosquitto/EMQX with WebSockets enabled:

```js
brokers: [
  { id: "x", url: "wss://mqtt.example.com:8084/mqtt" },
  { id: "e", url: "wss://broker.emqx.io:8084/mqtt" },
],
```

Rendering adapts to the device: resolution is capped at 1.5× and lowers itself if the frame rate drops.

## Running locally

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080` in two tabs and invite yourself with the link.

## Hosting on GitHub Pages

Settings → Pages → *Deploy from a branch* → branch `main`, folder `/ (root)` → Save.
