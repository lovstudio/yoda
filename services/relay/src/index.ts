import { loadRelayConfig } from './config.js';
import { createRelayServer } from './relay-server.js';

const config = loadRelayConfig();
const relay = createRelayServer({ config });
const address = await relay.listen();

console.info(`Yoda Relay listening on ${address.host}:${address.port}`);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await relay.close();
    process.exitCode = 0;
  } catch (error) {
    console.error('Failed to shut down Yoda Relay', error);
    process.exitCode = 1;
  }
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
