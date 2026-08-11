import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getConversationTranscript,
  subscribeConversationTranscriptChanges,
} from './transcript-feed';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  getCodexSessionRolloutPath: vi.fn(),
  getCodexSessionContext: vi.fn(),
  readIncrementalTranscriptTail: vi.fn(),
  stat: vi.fn(async (_filePath: string) => ({})),
  watch: vi.fn(),
  watchCallback: null as ((eventType: string) => void) | null,
  getReservedCodexThreadIds: vi.fn(async () => new Set(['reserved-thread'])),
}));

vi.mock('node:fs', () => ({
  watch: (...args: unknown[]) => mocks.watch(...args),
}));
vi.mock('node:fs/promises', () => ({
  stat: (filePath: string) => mocks.stat(filePath),
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => true) }));
vi.mock('@main/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              id: 'conversation',
              projectId: 'project',
              taskId: 'task',
              runtimeId: 'codex',
              title: 'Conversation',
              createdAt: '2026-07-11T00:00:00.000Z',
            },
          ],
        }),
      }),
    }),
  },
}));
vi.mock('@main/db/schema', () => ({ conversations: { id: 'id' } }));
vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));
vi.mock('@main/lib/logger', () => ({ log: { warn: vi.fn() } }));
vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: vi.fn(async () => undefined) },
}));
vi.mock('../projects/utils', () => ({
  resolveTask: () => ({ conversations: { taskPath: '/workspace' } }),
}));
vi.mock('./claude-transcript-locator', () => ({
  findClaudeTranscriptPathBySessionId: vi.fn(),
}));
vi.mock('./getCodexSessionContext', () => ({
  getCodexSessionRolloutPath: (...args: unknown[]) => mocks.getCodexSessionRolloutPath(...args),
  getCodexSessionContext: (...args: unknown[]) => mocks.getCodexSessionContext(...args),
}));
vi.mock('./incremental-transcript-tail-reader', () => ({
  readIncrementalTranscriptTail: (...args: unknown[]) =>
    mocks.readIncrementalTranscriptTail(...args),
}));
vi.mock('./codex-thread-reservations', () => ({
  getReservedCodexThreadIds: mocks.getReservedCodexThreadIds,
}));
vi.mock('./utils', () => ({ mapConversationRowToConversation: (row: unknown) => row }));
vi.mock('@main/core/session-title/claude-title-source', () => ({
  resolveClaudeTranscriptPath: vi.fn(),
  resolveClaudeTranscriptPathFromConfigDir: vi.fn(),
}));

describe('transcript feed local subscription', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.watchCallback = null;
  });

  it('retries until a late Codex rollout path exists and then emits changes', async () => {
    vi.useFakeTimers();
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = mocks.close;
    mocks.watch.mockImplementation((_path: string, callback: (eventType: string) => void) => {
      mocks.watchCallback = callback;
      return watcher;
    });
    mocks.getCodexSessionRolloutPath
      .mockResolvedValueOnce(null)
      .mockResolvedValue('/tmp/codex-rollout.jsonl');
    const listener = vi.fn();

    const unsubscribe = await subscribeConversationTranscriptChanges(
      'project',
      'task',
      'conversation',
      listener
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.watch).toHaveBeenCalledWith('/tmp/codex-rollout.jsonl', expect.any(Function));
    expect(mocks.getReservedCodexThreadIds).toHaveBeenCalledWith('conversation');
    expect(mocks.getCodexSessionRolloutPath).toHaveBeenLastCalledWith(
      '/workspace',
      'conversation',
      'Conversation',
      '2026-07-11T00:00:00.000Z',
      { codexHome: '/Users/mark/.codex', reservedThreadIds: new Set(['reserved-thread']) }
    );
    expect(mocks.getCodexSessionContext).not.toHaveBeenCalled();

    listener.mockClear();
    mocks.watchCallback?.('change');
    await vi.advanceTimersByTimeAsync(250);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('reuses the watched path and clears it when the file is renamed', async () => {
    vi.useFakeTimers();
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = mocks.close;
    mocks.watch.mockImplementation((_path: string, callback: (eventType: string) => void) => {
      mocks.watchCallback = callback;
      return watcher;
    });
    mocks.getCodexSessionRolloutPath
      .mockResolvedValueOnce('/tmp/old-rollout.jsonl')
      .mockResolvedValue('/tmp/new-rollout.jsonl');
    mocks.readIncrementalTranscriptTail.mockResolvedValue({ totalLines: 1, lines: ['raw'] });

    const unsubscribe = await subscribeConversationTranscriptChanges(
      'project',
      'task',
      'conversation',
      vi.fn()
    );

    await expect(getConversationTranscript('project', 'task', 'conversation')).resolves.toEqual({
      filePath: '/tmp/old-rollout.jsonl',
      totalLines: 1,
      lines: ['raw'],
    });
    expect(mocks.getCodexSessionRolloutPath).toHaveBeenCalledTimes(1);
    expect(mocks.readIncrementalTranscriptTail).toHaveBeenLastCalledWith('/tmp/old-rollout.jsonl');

    mocks.watchCallback?.('rename');
    await expect(getConversationTranscript('project', 'task', 'conversation')).resolves.toEqual({
      filePath: '/tmp/new-rollout.jsonl',
      totalLines: 1,
      lines: ['raw'],
    });
    expect(mocks.getCodexSessionRolloutPath).toHaveBeenCalledTimes(2);
    expect(mocks.readIncrementalTranscriptTail).toHaveBeenLastCalledWith('/tmp/new-rollout.jsonl');
    expect(mocks.getCodexSessionContext).not.toHaveBeenCalled();

    unsubscribe();
  });
});
