import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLD_CONVERSATION_STATUS_CONCURRENCY,
  resolveColdConversationReclamationStatuses,
  type ColdConversationReclamationCandidate,
} from './cold-conversation-reclamation';

const mocks = vi.hoisted(() => ({
  findClaudeTranscript: vi.fn(),
  getClaudeActivity: vi.fn(),
  getRuntimeConfig: vi.fn(),
  readClaudeVerdict: vi.fn(),
  readCodexVerdict: vi.fn(),
  readCodexRolloutPaths: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: mocks.getRuntimeConfig },
}));

vi.mock('@main/core/session-title/claude-title-source', () => ({
  resolveClaudeTranscriptPath: vi.fn(
    (cwd: string, sessionId: string) => `${cwd}/${sessionId}.jsonl`
  ),
}));

vi.mock('@main/core/session-title/codex-title-source', () => ({
  readCodexThreadRolloutPaths: mocks.readCodexRolloutPaths,
  resolveCodexStatePath: vi.fn((root?: string) => `${root ?? '/codex'}/state.sqlite`),
}));

vi.mock('./claude-session-activity-source', () => ({
  getClaudeSessionActivity: mocks.getClaudeActivity,
}));

vi.mock('./claude-cold-turn-verdict', () => ({
  readClaudeColdTurnVerdictFile: mocks.readClaudeVerdict,
}));

vi.mock('./claude-transcript-locator', () => ({
  findClaudeTranscriptPathBySessionId: mocks.findClaudeTranscript,
}));

vi.mock('./codex-run-state-source', () => ({
  readCodexTurnVerdictFile: mocks.readCodexVerdict,
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: mocks.warn },
}));

function candidate(
  conversationId: string,
  overrides: Partial<ColdConversationReclamationCandidate> = {}
): ColdConversationReclamationCandidate {
  return {
    sessionId: `project-1:task-1:${conversationId}`,
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId,
    runtimeId: 'codex',
    cwd: '/repo/worktree',
    title: 'Agent',
    createdAt: '2026-08-01T00:00:00.000Z',
    config: JSON.stringify({
      sessionSource: {
        catalogId: `catalog-${conversationId}`,
        runtimeId: 'codex',
        sessionId: `thread-${conversationId}`,
        stateRoot: '/codex-home',
      },
    }),
    processPid: 123,
    markerCreatedAtMs: 100,
    ...overrides,
  };
}

describe('cold conversation reclamation status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeConfig.mockResolvedValue({ statusMonitor: 'rollout' });
    mocks.readCodexRolloutPaths.mockImplementation(
      (_statePath: string, threadIds: string[]) =>
        new Map(threadIds.map((threadId) => [threadId, `/rollouts/${threadId}.jsonl`]))
    );
    mocks.readCodexVerdict.mockResolvedValue({ state: 'idle', lastStartedAt: 1 });
    mocks.findClaudeTranscript.mockResolvedValue('/claude/session.jsonl');
    mocks.getClaudeActivity.mockResolvedValue(null);
    mocks.readClaudeVerdict.mockResolvedValue({
      state: 'idle',
      lastUserAt: 1,
      interrupted: false,
    });
  });

  it('derives an idle Codex session from its rollout without starting a provider', async () => {
    await expect(
      resolveColdConversationReclamationStatuses([candidate('conversation-1')])
    ).resolves.toEqual(new Map([['project-1:task-1:conversation-1', 'idle']]));

    expect(mocks.readCodexRolloutPaths).toHaveBeenCalledWith('/codex-home/state.sqlite', [
      'thread-conversation-1',
    ]);
    expect(mocks.readCodexVerdict).toHaveBeenCalledWith('/rollouts/thread-conversation-1.jsonl');
  });

  it('keeps missing or unsupported durable evidence fail-closed', async () => {
    mocks.readCodexVerdict.mockResolvedValue(null);

    await expect(
      resolveColdConversationReclamationStatuses([
        candidate('missing'),
        candidate('unbound', { config: null }),
      ])
    ).resolves.toEqual(new Map());
  });

  it('does not infer an unbound Codex thread from cwd, title, or timestamps', async () => {
    await expect(
      resolveColdConversationReclamationStatuses([candidate('unbound', { config: null })])
    ).resolves.toEqual(new Map());

    expect(mocks.readCodexRolloutPaths).not.toHaveBeenCalled();
    expect(mocks.readCodexVerdict).not.toHaveBeenCalled();
  });

  it('requires Claude activity to match the exact tmux pane process', async () => {
    mocks.getRuntimeConfig.mockResolvedValue({ statusMonitor: 'activity' });
    mocks.getClaudeActivity
      .mockResolvedValueOnce({
        pid: 999,
        sessionId: 'stale-activity',
        cwd: '/repo/worktree',
        status: 'idle',
        waitingFor: null,
        updatedAt: 200,
      })
      .mockResolvedValueOnce({
        pid: 123,
        sessionId: 'exact-activity',
        cwd: '/repo/worktree',
        status: 'idle',
        waitingFor: null,
        updatedAt: 200,
      });
    const claude = { runtimeId: 'claude' } as const;

    await expect(
      resolveColdConversationReclamationStatuses([
        candidate('stale-activity', claude),
        candidate('exact-activity', claude),
      ])
    ).resolves.toEqual(new Map([['project-1:task-1:exact-activity', 'idle']]));
  });

  it.each([
    ['session id', { sessionId: 'another-session' }],
    ['cwd', { cwd: '/another/worktree' }],
    ['activity timestamp', { updatedAt: 99 }],
    ['activity timestamp presence', { updatedAt: null }],
  ])('rejects Claude idle activity with mismatched %s evidence', async (_label, mismatch) => {
    mocks.getRuntimeConfig.mockResolvedValue({ statusMonitor: 'activity' });
    mocks.getClaudeActivity.mockResolvedValue({
      pid: 123,
      sessionId: 'claude-idle',
      cwd: '/repo/worktree',
      status: 'idle',
      waitingFor: null,
      updatedAt: 200,
      ...mismatch,
    });

    await expect(
      resolveColdConversationReclamationStatuses([
        candidate('claude-idle', { runtimeId: 'claude' }),
      ])
    ).resolves.toEqual(new Map());
  });

  it('reads a configured Claude transcript and preserves a working verdict', async () => {
    mocks.getRuntimeConfig.mockResolvedValue({ statusMonitor: 'transcript' });
    mocks.readClaudeVerdict.mockResolvedValue({
      state: 'working',
      lastUserAt: 1,
      interrupted: false,
    });

    await expect(
      resolveColdConversationReclamationStatuses([
        candidate('claude-working', { runtimeId: 'claude' }),
      ])
    ).resolves.toEqual(new Map([['project-1:task-1:claude-working', 'working']]));
  });

  it('bounds concurrent durable artifact reads', async () => {
    let active = 0;
    let maxActive = 0;
    mocks.readCodexVerdict.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { state: 'idle', lastStartedAt: 1 };
    });
    const candidates = Array.from(
      { length: COLD_CONVERSATION_STATUS_CONCURRENCY * 2 + 1 },
      (_, index) => candidate(`conversation-${index}`)
    );

    const statuses = await resolveColdConversationReclamationStatuses(candidates);

    expect(statuses.size).toBe(candidates.length);
    expect(maxActive).toBe(COLD_CONVERSATION_STATUS_CONCURRENCY);
  });

  it('loads each runtime monitor setting once per bulk scan', async () => {
    await resolveColdConversationReclamationStatuses([
      candidate('codex-1'),
      candidate('codex-2'),
      candidate('claude-1', { runtimeId: 'claude' }),
      candidate('claude-2', { runtimeId: 'claude' }),
    ]);

    expect(
      mocks.getRuntimeConfig.mock.calls.filter(([runtime]) => runtime === 'codex')
    ).toHaveLength(1);
    expect(
      mocks.getRuntimeConfig.mock.calls.filter(([runtime]) => runtime === 'claude')
    ).toHaveLength(1);
  });

  it('reuses one Codex state DB read for conversations sharing a state root', async () => {
    await resolveColdConversationReclamationStatuses([
      candidate('codex-1'),
      candidate('codex-2'),
      candidate('codex-3'),
    ]);

    expect(mocks.readCodexRolloutPaths).toHaveBeenCalledTimes(1);
    expect(mocks.readCodexRolloutPaths).toHaveBeenCalledWith('/codex-home/state.sqlite', [
      'thread-codex-1',
      'thread-codex-2',
      'thread-codex-3',
    ]);
  });

  it('keeps a new or unflushed Codex rollout protected without turn evidence', async () => {
    mocks.readCodexVerdict.mockResolvedValue({ state: 'idle', lastStartedAt: null });

    await expect(
      resolveColdConversationReclamationStatuses([candidate('unflushed')])
    ).resolves.toEqual(new Map());
  });
});
