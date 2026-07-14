import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { forkConversationAtPrompt } from './forkConversationAtPrompt';

const mocks = vi.hoisted(() => ({
  deleteClaudeTranscript: vi.fn(),
  deleteCodexThread: vi.fn(),
  emit: vi.fn(),
  forkClaudeTranscript: vi.fn(),
  forkCodexThread: vi.fn(),
  getClaudeSessionContext: vi.fn(),
  getCodexSessionContext: vi.fn(),
  getRuntimeConfig: vi.fn(),
  mapConversationRowToConversation: vi.fn(),
  resolveTask: vi.fn(),
  startSession: vi.fn(),
  selectChain: {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
  insertChain: {
    values: vi.fn(),
    returning: vi.fn(),
  },
  updateChain: {
    set: vi.fn(),
    where: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => mocks.selectChain),
    insert: vi.fn(() => mocks.insertChain),
    update: vi.fn(() => mocks.updateChain),
  },
}));

vi.mock('../projects/utils', () => ({ resolveTask: mocks.resolveTask }));
vi.mock('../settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: mocks.getRuntimeConfig },
}));
vi.mock('./claude-transcript-fork', () => ({
  deleteClaudeTranscript: mocks.deleteClaudeTranscript,
  forkClaudeTranscript: mocks.forkClaudeTranscript,
}));
vi.mock('./codex-thread-fork', () => ({
  deleteCodexThread: mocks.deleteCodexThread,
  forkCodexThread: mocks.forkCodexThread,
}));
vi.mock('./getClaudeSessionContext', () => ({
  getClaudeSessionContext: mocks.getClaudeSessionContext,
}));
vi.mock('./getCodexSessionContext', () => ({
  getCodexSessionContext: mocks.getCodexSessionContext,
}));
vi.mock('./conversation-events', () => ({
  conversationEvents: { _emit: mocks.emit },
}));
vi.mock('./utils', () => ({
  mapConversationRowToConversation: mocks.mapConversationRowToConversation,
}));

const sourceRow = {
  id: 'source-conversation',
  projectId: 'project-1',
  taskId: 'task-1',
  title: 'Source title',
  runtime: 'codex',
  config: '{"permissionMode":"full-auto"}',
  createdAt: '2026-07-14 10:00:00',
};

describe('forkConversationAtPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectChain.from.mockReturnThis();
    mocks.selectChain.where.mockReturnThis();
    mocks.selectChain.limit.mockResolvedValue([sourceRow]);
    mocks.insertChain.values.mockReturnThis();
    mocks.insertChain.returning.mockResolvedValue([
      {
        ...sourceRow,
        id: 'forked-thread',
        title: 'Source title · #1',
        titleSource: 'yoda',
        isInitialConversation: false,
        lastInteractedAt: '2026-07-14T11:00:00.000Z',
      },
    ]);
    mocks.updateChain.set.mockReturnThis();
    mocks.updateChain.where.mockResolvedValue(undefined);
    mocks.resolveTask.mockReturnValue({
      conversations: { taskPath: '/repo', startSession: mocks.startSession },
    });
    mocks.startSession.mockResolvedValue(undefined);
    mocks.getRuntimeConfig.mockImplementation(async (runtimeId: string) =>
      runtimeId === 'claude'
        ? { cli: 'claude', env: { CLAUDE_CONFIG_DIR: '/state/claude' } }
        : { cli: 'codex', env: { CODEX_HOME: '/state/codex' } }
    );
    mocks.deleteClaudeTranscript.mockResolvedValue(undefined);
    mocks.deleteCodexThread.mockResolvedValue(undefined);
    mocks.forkClaudeTranscript.mockResolvedValue('/claude/fork.jsonl');
    mocks.forkCodexThread.mockResolvedValue('forked-thread');
    mocks.getCodexSessionContext.mockResolvedValue({
      threadId: 'source-thread',
      prompts: [
        {
          id: 'prompt-1',
          text: 'Prompt',
          timestamp: null,
          restoreTarget: { kind: 'codex-turn', turnId: 'turn-1' },
        },
      ],
    });
    mocks.getClaudeSessionContext.mockResolvedValue({
      prompts: [
        {
          id: 'prompt-1',
          text: 'Prompt',
          timestamp: null,
          restoreTarget: { kind: 'claude-message', messageId: 'answer-1' },
        },
      ],
    });
    mocks.mapConversationRowToConversation.mockImplementation(
      (row: Record<string, unknown>): Conversation =>
        ({
          ...row,
          runtimeId: row.runtime,
          lastInteractedAt: row.lastInteractedAt ?? null,
        }) as Conversation
    );
  });

  it('forks Codex through the verified turn, persists copied config, and resumes it', async () => {
    const conversation = await forkConversationAtPrompt({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'source-conversation',
      promptIndex: 0,
      target: { kind: 'codex-turn', turnId: 'turn-1' },
      initialSize: { cols: 120, rows: 32 },
    });

    expect(mocks.getCodexSessionContext).toHaveBeenCalledWith(
      '/repo',
      'source-conversation',
      'Source title',
      '2026-07-14 10:00:00',
      { codexHome: '/state/codex' }
    );
    expect(mocks.forkCodexThread).toHaveBeenCalledWith({
      threadId: 'source-thread',
      lastTurnId: 'turn-1',
      cwd: '/repo',
    });
    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'forked-thread',
        title: 'Source title · #1',
        titleSource: 'yoda',
        runtime: 'codex',
        config: '{"permissionMode":"full-auto"}',
        isInitialConversation: false,
      })
    );
    const inserted = mocks.insertChain.values.mock.calls[0]?.[0] as {
      lastInteractedAt: string;
    };
    expect(mocks.updateChain.set).toHaveBeenCalledWith({
      lastInteractedAt: inserted.lastInteractedAt,
    });
    expect(mocks.emit).toHaveBeenCalledWith('conversation:created', conversation);
    expect(mocks.startSession).toHaveBeenCalledWith(conversation, { cols: 120, rows: 32 }, true);
    expect(mocks.startSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.emit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it('creates a new Claude session id and copies through the verified message', async () => {
    mocks.selectChain.limit.mockResolvedValue([{ ...sourceRow, runtime: 'claude' }]);

    await forkConversationAtPrompt({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'source-conversation',
      promptIndex: 0,
      target: { kind: 'claude-message', messageId: 'answer-1' },
    });

    const inserted = mocks.insertChain.values.mock.calls[0]?.[0] as { id: string };
    expect(mocks.forkClaudeTranscript).toHaveBeenCalledWith({
      cwd: '/repo',
      claudeConfigDir: '/state/claude',
      sourceSessionId: 'source-conversation',
      targetSessionId: inserted.id,
      targetMessageId: 'answer-1',
    });
    expect(mocks.getClaudeSessionContext).toHaveBeenCalledWith('/repo', 'source-conversation', {
      claudeConfigDir: '/state/claude',
    });
    expect(inserted.id).not.toBe('source-conversation');
  });

  it('rejects stale or tampered targets before creating a provider fork', async () => {
    await expect(
      forkConversationAtPrompt({
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'source-conversation',
        promptIndex: 0,
        target: { kind: 'codex-turn', turnId: 'other-turn' },
      })
    ).rejects.toThrow('restore target is invalid');

    expect(mocks.forkCodexThread).not.toHaveBeenCalled();
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent forks of the same provider checkpoint', async () => {
    let releaseFork: ((threadId: string) => void) | undefined;
    mocks.forkCodexThread.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        releaseFork = resolve;
      })
    );
    const params = {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'source-conversation',
      promptIndex: 0,
      target: { kind: 'codex-turn' as const, turnId: 'turn-1' },
    };

    const first = forkConversationAtPrompt(params);
    const second = forkConversationAtPrompt(params);

    expect(first).toBe(second);
    await vi.waitFor(() => expect(mocks.forkCodexThread).toHaveBeenCalledTimes(1));
    releaseFork?.('forked-thread');
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.insertChain.values).toHaveBeenCalledTimes(1);
  });

  it('validates prompt indexes independently even when their target ids match', async () => {
    mocks.getCodexSessionContext.mockResolvedValue({
      threadId: 'source-thread',
      prompts: [
        {
          id: 'prompt-1',
          text: 'First prompt',
          timestamp: null,
          restoreTarget: { kind: 'codex-turn', turnId: 'turn-1' },
        },
        {
          id: 'prompt-2',
          text: 'Second prompt',
          timestamp: null,
          restoreTarget: { kind: 'codex-turn', turnId: 'turn-1' },
        },
      ],
    });
    const base = {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'source-conversation',
      target: { kind: 'codex-turn' as const, turnId: 'turn-1' },
    };

    const first = forkConversationAtPrompt({ ...base, promptIndex: 0 });
    const second = forkConversationAtPrompt({ ...base, promptIndex: 1 });

    expect(first).not.toBe(second);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.forkCodexThread).toHaveBeenCalledTimes(2);
  });

  it('keeps a durable fork recoverable when its initial session launch fails', async () => {
    mocks.startSession.mockRejectedValueOnce(new Error('launch failed'));

    const conversation = await forkConversationAtPrompt({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'source-conversation',
      promptIndex: 0,
      target: { kind: 'codex-turn', turnId: 'turn-1' },
    });

    expect(conversation.resume).toBe(true);
    expect(mocks.emit).toHaveBeenCalledWith('conversation:created', conversation);
    expect(mocks.deleteCodexThread).not.toHaveBeenCalled();
  });

  it('deletes the provider fork when database persistence fails', async () => {
    mocks.insertChain.returning.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      forkConversationAtPrompt({
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'source-conversation',
        promptIndex: 0,
        target: { kind: 'codex-turn', turnId: 'turn-1' },
      })
    ).rejects.toThrow('database unavailable');

    expect(mocks.deleteCodexThread).toHaveBeenCalledWith('forked-thread');
    expect(mocks.startSession).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('cleans up a Claude fork from its configured state directory', async () => {
    mocks.selectChain.limit.mockResolvedValue([{ ...sourceRow, runtime: 'claude' }]);
    mocks.insertChain.returning.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      forkConversationAtPrompt({
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'source-conversation',
        promptIndex: 0,
        target: { kind: 'claude-message', messageId: 'answer-1' },
      })
    ).rejects.toThrow('database unavailable');

    const targetSessionId = mocks.forkClaudeTranscript.mock.calls[0]?.[0]?.targetSessionId;
    expect(mocks.deleteClaudeTranscript).toHaveBeenCalledWith({
      cwd: '/repo',
      claudeConfigDir: '/state/claude',
      sessionId: targetSessionId,
    });
  });
});
