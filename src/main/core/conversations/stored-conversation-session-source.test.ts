import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStoredConversationSessionSource,
  storeConversationSessionSource,
} from './stored-conversation-session-source';

const mocks = vi.hoisted(() => ({
  getReservedCodexThreadIds: vi.fn(),
  select: vi.fn(),
  sqlitePrepare: vi.fn(),
  sqliteRun: vi.fn(),
}));

vi.mock('./codex-thread-reservations', () => ({
  getReservedCodexThreadIds: mocks.getReservedCodexThreadIds,
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.select,
  },
  sqlite: { prepare: mocks.sqlitePrepare },
}));

const source = {
  catalogId: 'catalog-1',
  runtimeId: 'codex' as const,
  sessionId: 'thread-1',
  stateRoot: '/tmp/codex-home',
};
const owner = { projectId: 'project-1', taskId: 'task-1' };

function selectChain(result: unknown[]) {
  return {
    from() {
      return this;
    },
    where() {
      return this;
    },
    limit: vi.fn(async () => result),
  };
}

describe('stored conversation session source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReservedCodexThreadIds.mockResolvedValue(new Set());
    mocks.sqliteRun.mockReturnValue({ changes: 1 });
    mocks.sqlitePrepare.mockReturnValue({ run: mocks.sqliteRun });
  });

  it('preserves existing conversation config while storing a Codex binding', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          runtime: 'codex',
          config: JSON.stringify({
            autoApprove: true,
            permissionMode: 'bypass',
            pendingInitialPrompt: { prompt: 'Deliver me once' },
          }),
        },
      ])
    );

    await expect(storeConversationSessionSource('conversation-1', source, owner)).resolves.toBe(
      true
    );

    expect(mocks.sqlitePrepare).toHaveBeenCalledWith(expect.stringContaining('NOT EXISTS'));
    const [config] = mocks.sqliteRun.mock.calls[0] as [string];
    expect(JSON.parse(config)).toEqual({
      autoApprove: true,
      permissionMode: 'bypass',
      sessionSource: source,
    });
  });

  it('accepts an identical binding without rewriting it', async () => {
    mocks.select.mockReturnValue(
      selectChain([{ runtime: 'codex', config: JSON.stringify({ sessionSource: source }) }])
    );

    await expect(storeConversationSessionSource('conversation-1', source, owner)).resolves.toBe(
      true
    );
    expect(mocks.sqlitePrepare).not.toHaveBeenCalled();
  });

  it('finishes an interrupted atomic acknowledgement for an identical binding', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          runtime: 'codex',
          config: JSON.stringify({
            sessionSource: source,
            pendingInitialPrompt: { prompt: 'Deliver me once' },
          }),
        },
      ])
    );

    await expect(storeConversationSessionSource('conversation-1', source, owner)).resolves.toBe(
      true
    );

    const [config] = mocks.sqliteRun.mock.calls[0] as [string];
    expect(JSON.parse(config)).toEqual({ sessionSource: source });
    expect(mocks.getReservedCodexThreadIds).not.toHaveBeenCalled();
  });

  it('does not persist a Codex thread reserved by another conversation', async () => {
    mocks.select.mockReturnValue(
      selectChain([{ runtime: 'codex', config: JSON.stringify({ autoApprove: true }) }])
    );
    mocks.getReservedCodexThreadIds.mockResolvedValueOnce(new Set(['thread-1']));

    await expect(storeConversationSessionSource('conversation-1', source, owner)).resolves.toBe(
      false
    );

    expect(mocks.getReservedCodexThreadIds).toHaveBeenCalledWith('conversation-1');
    expect(mocks.sqlitePrepare).not.toHaveBeenCalled();
  });

  it('rejects a stale binding callback from an earlier delivery attempt', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          runtime: 'codex',
          config: JSON.stringify({
            pendingInitialPrompt: { prompt: 'Deliver me once', attemptStartedAtMs: 200 },
          }),
        },
      ])
    );

    await expect(
      storeConversationSessionSource('conversation-1', source, {
        ...owner,
        expectedPendingAttemptStartedAtMs: 100,
      })
    ).resolves.toBe(false);

    expect(mocks.sqlitePrepare).not.toHaveBeenCalled();
  });

  it('reads the stored binding', async () => {
    mocks.select.mockReturnValue(
      selectChain([{ config: JSON.stringify({ sessionSource: source }) }])
    );

    await expect(getStoredConversationSessionSource('conversation-1')).resolves.toEqual(source);
  });
});
