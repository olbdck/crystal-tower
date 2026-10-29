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

- The whole game is a single `index.html` file. Three.js and PeerJS load from a CDN.
- Players connect directly between browsers over WebRTC. The free [PeerJS Cloud](https://peerjs.com/server/cloud) server only helps them find each other.
- One browser at the table relays data between players, and one (not necessarily the same) runs the simulation. If either leaves, the role passes to another player and the game continues.
- A player who drops out briefly or reloads the tab keeps their seat and gold for 10 seconds.
- When everyone leaves a table, it disappears.

## If someone cannot connect

The usual cause is a strict NAT: mobile data, corporate or hotel networks. A direct connection is not possible there, so a TURN server is needed to relay the traffic.

At the top of the `P2P TRANSPORT` block in `index.html` there is a `NET_CONFIG` setting. Add your TURN server there, for example from the free tier at [Metered](https://www.metered.ca/stun-turn) or your own coturn:

```js
iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "turn:your-turn.example.com:3478", username: "user", credential: "pass" },
],
```

If the public PeerJS Cloud is unavailable, run your own server (`npx peerjs --port 9000`) and set it in `peerServer: { host, port, path, secure }`.

## Running locally

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080` in two tabs and invite yourself with the link.

## Hosting on GitHub Pages

Settings → Pages → *Deploy from a branch* → branch `main`, folder `/ (root)` → Save.
