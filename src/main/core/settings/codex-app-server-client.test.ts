import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestCodexAppServer } from './codex-app-server-client';

const mocks = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: mocks.getRuntimeConfig },
}));

type MockChild = EventEmitter & {
  stdin: { write: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdin = { write: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function writtenMessages(child: MockChild): unknown[] {
  return child.stdin.write.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown);
}

describe('requestCodexAppServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeConfig.mockResolvedValue({ cli: 'codex' });
  });

  it('performs the handshake and opts into experimental fields when requested', async () => {
    const child = createMockChild();
    mocks.spawn.mockReturnValue(child);

    const resultPromise = requestCodexAppServer(
      'thread/fork',
      { threadId: 'source', excludeTurns: true },
      { experimentalApi: true }
    );
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());

    expect(writtenMessages(child)[0]).toEqual({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'yoda', title: 'Yoda', version: '0.15.3' },
        capabilities: { experimentalApi: true },
      },
    });

    child.stdout.emit('data', Buffer.from('{"id":1,"result":{}}\n'));
    expect(writtenMessages(child).slice(1)).toEqual([
      { method: 'initialized', params: {} },
      {
        id: 2,
        method: 'thread/fork',
        params: { threadId: 'source', excludeTurns: true },
      },
    ]);

    child.stdout.emit('data', Buffer.from('{"id":2,"result":{"thread":{"id":"forked"}}}\n'));
    await expect(resultPromise).resolves.toEqual({ thread: { id: 'forked' } });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('uses the configured Codex command prefix and environment', async () => {
    const child = createMockChild();
    mocks.spawn.mockReturnValue(child);
    mocks.getRuntimeConfig.mockResolvedValue({
      cli: '/opt/custom/codex --profile work',
      env: { CODEX_HOME: '/tmp/custom-codex-home' },
    });

    const resultPromise = requestCodexAppServer('thread/fork', { threadId: 'source' });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());

    const [command, args, spawnOptions] = mocks.spawn.mock.calls[0] ?? [];
    expect(command).toBe('/opt/custom/codex');
    expect(args).toEqual(['--profile', 'work', 'app-server', '--stdio']);
    expect(spawnOptions?.env?.CODEX_HOME).toBe('/tmp/custom-codex-home');

    child.stdout.emit('data', Buffer.from('{"id":1,"result":{}}\n'));
    child.stdout.emit('data', Buffer.from('{"id":2,"result":{}}\n'));
    await expect(resultPromise).resolves.toEqual({});
  });

  it('surfaces the provider error message', async () => {
    const child = createMockChild();
    mocks.spawn.mockReturnValue(child);
    const resultPromise = requestCodexAppServer('thread/fork', {});
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());

    child.stdout.emit('data', Buffer.from('{"id":1,"result":{}}\n'));
    child.stdout.emit(
      'data',
      Buffer.from('{"id":2,"error":{"message":"turn is still in progress"}}\n')
    );

    await expect(resultPromise).rejects.toThrow('turn is still in progress');
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
