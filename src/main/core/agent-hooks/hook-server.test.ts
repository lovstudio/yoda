import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HookServer } from './hook-server';

const servers: HookServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

describe('HookServer acknowledgements', () => {
  it('returns the handler status and diagnostic body to the caller', async () => {
    const server = new HookServer(testEndpointPath());
    servers.push(server);
    await server.start(async () => ({ status: 409, body: 'team-at: no matching teammate' }));

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/hook`, {
      method: 'POST',
      headers: {
        'X-Yoda-Token': server.getToken(),
        'X-Yoda-Pty-Id': 'codex:test',
        'X-Yoda-Event-Type': 'team-at',
      },
      body: '{}',
    });

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toBe('team-at: no matching teammate');
  });

  it('does not remove an endpoint that a newer server owns', async () => {
    const endpointPath = testEndpointPath();
    const older = new HookServer(endpointPath);
    const newer = new HookServer(endpointPath);
    servers.push(older, newer);
    await older.start(async () => undefined);
    await newer.start(async () => undefined);

    older.stop();

    expect(JSON.parse(readFileSync(endpointPath, 'utf8'))).toEqual({
      port: newer.getPort(),
      token: newer.getToken(),
    });
  });
});

function testEndpointPath(): string {
  return join(tmpdir(), `yoda-hook-endpoint-${randomUUID()}.json`);
}
