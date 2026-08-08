import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTeamScripts } from './team-at-script';

vi.mock('@main/core/projects/utils', () => ({ resolveTask: vi.fn() }));
vi.mock('@main/lib/logger', () => ({ log: { warn: vi.fn() } }));

const execFileAsync = promisify(execFile);
const servers: ReturnType<typeof createServer>[] = [];
const tempHomes: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
      )
  );
  await Promise.all(tempHomes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('buildTeamScripts', () => {
  it('posts team hand-offs directly to Yoda even when proxy variables are set', async () => {
    const requests: Array<{
      body: string;
      eventType: string | undefined;
      ptyId: string | undefined;
    }> = [];
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        requests.push({
          body,
          eventType: request.headers['x-yoda-event-type'] as string | undefined,
          ptyId: request.headers['x-yoda-pty-id'] as string | undefined,
        });
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('team-at: delivered to @worker');
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test hook server has no port');

    const home = await mkdtemp(join(tmpdir(), 'yoda-team-at-'));
    tempHomes.push(home);
    await mkdir(join(home, '.yoda'));
    await writeFile(
      join(home, '.yoda', 'hook-endpoint.json'),
      JSON.stringify({ port: address.port, token: 'test-token' })
    );
    const scriptPath = join(home, 'team-at');
    await writeFile(scriptPath, buildTeamScripts('codex-conv-1')['team-at'], { mode: 0o755 });

    const { stdout } = await execFileAsync(scriptPath, ['@worker', 'inspect the hand-off'], {
      env: {
        ...process.env,
        HOME: home,
        HTTP_PROXY: 'http://127.0.0.1:1',
        HTTPS_PROXY: 'http://127.0.0.1:1',
        ALL_PROXY: 'socks5://127.0.0.1:1',
        http_proxy: 'http://127.0.0.1:1',
        https_proxy: 'http://127.0.0.1:1',
        all_proxy: 'socks5://127.0.0.1:1',
        NO_PROXY: '',
        no_proxy: '',
      },
    });

    expect(stdout.trim()).toBe('team-at: delivered to @worker');
    expect(requests).toEqual([
      {
        body: '{"to": ["@worker"], "message": "inspect the hand-off"}',
        eventType: 'team-at',
        ptyId: 'codex-conv-1',
      },
    ]);
  });
});
