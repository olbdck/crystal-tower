// Local MQTT broker over WebSocket for tests and offline development.
// Usage: node tests/support/broker.js [port]   (default 8888)
import { Aedes } from "aedes";
import { createServer } from "aedes-server-factory";

export async function startBroker(port = 8888, host = "127.0.0.1") {
  const broker = await Aedes.createBroker();
  const server = createServer(broker, { ws: true });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  return {
    url: `ws://${host}:${port}`,
    close: () => new Promise(resolve => { server.close(() => broker.close(resolve)); }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = +(process.argv[2] || 8888);
  const b = await startBroker(port);
  console.log(`MQTT broker on ${b.url}. Open the game with ?broker=${b.url} or set window.KV_NET_CONFIG.`);
}
