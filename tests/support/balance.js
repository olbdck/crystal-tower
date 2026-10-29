// Prints how bot teams of 1 to 5 players fare: npm run balance
import { playGame } from "./bot.js";
for (const n of [1, 2, 3, 4, 5]) console.log(JSON.stringify(playGame(n)));
console.log("archers only, 3 players:", JSON.stringify(playGame(3, { archersOnly: true })));
