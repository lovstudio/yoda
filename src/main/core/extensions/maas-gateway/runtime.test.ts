import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaasGatewayHostMessage, MaasGatewayWorkerMessage } from './protocol';
import { MaasGatewayExtensionRuntime } from './runtime';

vi.mock('electron', () => ({
  utilityProcess: { fork: vi.fn() },
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn() },
}));

class FakeUtilityProcess extends EventEmitter {
  readonly messages: MaasGatewayHostMessage[] = [];
  readonly kill = vi.fn(() => true);
  readonly pid: number;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  postMessage(message: MaasGatewayHostMessage): void {
    this.messages.push(message);
  }

  emitWorkerMessage(message: MaasGatewayWorkerMessage): void {
    this.emit('message', message);
  }
}

describe('MaaS Gateway extension runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the local admission token stable while supervising a crash restart', async () => {
    const children: FakeUtilityProcess[] = [];
    const runtime = new MaasGatewayExtensionRuntime(
      (() => {
        const child = new FakeUtilityProcess(1000 + children.length);
        children.push(child);
        return child;
      }) as never,
      '/fixture/maas-gateway.js'
    );

    const firstStart = runtime.start();
    const firstChild = children[0];
    if (!firstChild) throw new Error('Expected the first Gateway process.');
    firstChild.emit('spawn');
    const firstStartMessage = firstChild.messages[0];
    expect(firstStartMessage?.type).toBe('start');
    if (firstStartMessage?.type !== 'start') throw new Error('Expected a start message.');
    firstChild.emitWorkerMessage({ type: 'ready', port: 15721 });
    await firstStart;

    const configurePromise = runtime.configure({
      providerId: 'zenmux',
      endpoint: 'https://maas.example.test/v1',
      apiKey: 'upstream-secret',
    });
    await Promise.resolve();
    const configureMessage = firstChild.messages.find((message) => message.type === 'configure');
    if (configureMessage?.type !== 'configure') {
      throw new Error('Expected a configure message.');
    }
    firstChild.emitWorkerMessage({
      type: 'configured',
      requestId: configureMessage.requestId,
      providerId: 'zenmux',
    });
    await configurePromise;

    firstChild.emit('exit', 1);
    await vi.advanceTimersByTimeAsync(1_000);
    const restartedChild = children[1];
    if (!restartedChild) throw new Error('Expected the supervised Gateway restart.');
    restartedChild.emit('spawn');
    const restartedStartMessage = restartedChild.messages[0];
    expect(restartedStartMessage).toEqual(
      expect.objectContaining({
        type: 'start',
        admissionToken: firstStartMessage.admissionToken,
      })
    );
    restartedChild.emitWorkerMessage({ type: 'ready', port: 15722 });
    await Promise.resolve();
    const replayMessage = restartedChild.messages.find((message) => message.type === 'configure');
    if (replayMessage?.type !== 'configure') {
      throw new Error('Expected the provider configuration to be replayed.');
    }
    restartedChild.emitWorkerMessage({
      type: 'configured',
      requestId: replayMessage.requestId,
      providerId: 'zenmux',
    });

    const stopPromise = runtime.stop();
    restartedChild.emit('exit', 0);
    await stopPromise;
    expect(runtime.getStatus().state).toBe('stopped');
  });
});
