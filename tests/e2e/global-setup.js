import { startBroker } from "../support/broker.js";

export default async function globalSetup() {
  const broker = await startBroker(8888);
  return async () => { await broker.close(); };
}
