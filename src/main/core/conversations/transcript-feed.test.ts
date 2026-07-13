import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeConversationTranscriptChanges } from './transcript-feed';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  getCodexSessionContext: vi.fn(),
  stat: vi.fn(async (_filePath: string) => ({})),
  watch: vi.fn(),
  watchCallback: null as ((eventType: string) => void) | null,
}));

vi.mock('node:fs', () => ({
  watch: (...args: unknown[]) => mocks.watch(...args),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => ''),
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
vi.mock('../projects/utils', () => ({
  resolveTask: () => ({ conversations: { taskPath: '/workspace' } }),
}));
vi.mock('./claude-transcript-locator', () => ({
  findClaudeTranscriptPathBySessionId: vi.fn(),
}));
vi.mock('./getCodexSessionContext', () => ({
  getCodexSessionContext: (...args: unknown[]) => mocks.getCodexSessionContext(...args),
}));
vi.mock('./utils', () => ({ mapConversationRowToConversation: (row: unknown) => row }));
vi.mock('@main/core/session-title/claude-title-source', () => ({
  resolveClaudeTranscriptPath: vi.fn(),
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
    mocks.getCodexSessionContext
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ rolloutPath: '/tmp/codex-rollout.jsonl' });
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

    listener.mockClear();
    mocks.watchCallback?.('change');
    await vi.advanceTimersByTimeAsync(250);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
