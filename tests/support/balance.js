// Prints how bot teams of 1 to 5 players fare over several seeds: npm run balance [-- games]
import { playGame } from "./bot.js";

const GAMES = Number(process.argv[2]) || 12;
const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
function report(label, n, opts = {}) {
  const rs = Array.from({ length: GAMES }, (_, i) => playGame(n, { ...opts, seed: i + 1 }));
  const waves = rs.map(r => r.wave), wins = rs.filter(r => r.won);
  console.log(`${label.padEnd(18)} wave ${avg(waves).toFixed(1).padStart(4)} (${Math.min(...waves)}-${Math.max(...waves)})` +
    `  wins ${String(wins.length).padStart(2)}/${GAMES}` + (wins.length ? `  lives left when winning ${avg(wins.map(r => r.lives)).toFixed(1)}` : ""));
}
for (const n of [1, 2, 3, 4, 5]) report(`${n} player${n > 1 ? "s" : ""}`, n);
report("3, archers only", 3, { archersOnly: true });
