import { serve } from '@hono/node-server';
import { createApp } from './api/app.js';
import { createContainer } from './container.js';

const container = createContainer();
container.startWorkers();

const app = createApp(container);
const port = container.config.getNumber('server.port', 8787);
const host = container.config.getString('server.host', '0.0.0.0');

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  container.telemetry.info('server.listening', {
    host: info.address,
    port: info.port,
  });
  console.log(`Bloom engine listening on http://${info.address}:${info.port}`);
});

async function shutdown(): Promise<void> {
  await container.stop();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
