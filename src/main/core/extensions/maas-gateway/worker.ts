import type { MaasGatewayHostMessage, MaasGatewayWorkerMessage } from './protocol';
import { createMaasGatewayServer, type MaasGatewayServer } from './proxy-server';

const parentPort = process.parentPort;
let server: MaasGatewayServer | null = null;

function send(message: MaasGatewayWorkerMessage): void {
  parentPort.postMessage(message);
}

parentPort.on('message', (event: { data: MaasGatewayHostMessage }) => {
  void handleMessage(event.data).catch((error) => {
    send({
      type: 'error',
      requestId:
        event.data.type === 'configure' || event.data.type === 'clear'
          ? event.data.requestId
          : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});

async function handleMessage(message: MaasGatewayHostMessage): Promise<void> {
  switch (message.type) {
    case 'start': {
      if (server) {
        send({ type: 'ready', port: server.port });
        return;
      }
      server = await createMaasGatewayServer({
        admissionToken: message.admissionToken,
        port: message.port,
      });
      send({ type: 'ready', port: server.port });
      return;
    }
    case 'configure': {
      if (!server) throw new Error('MaaS Gateway has not started.');
      server.setConfiguration(message.configuration);
      send({
        type: 'configured',
        requestId: message.requestId,
        providerId: message.configuration.providerId,
      });
      return;
    }
    case 'clear': {
      if (!server) throw new Error('MaaS Gateway has not started.');
      server.setConfiguration(null);
      send({ type: 'configured', requestId: message.requestId, providerId: null });
      return;
    }
    case 'shutdown': {
      await server?.close();
      server = null;
      send({ type: 'stopped' });
      process.exit(0);
    }
  }
}
