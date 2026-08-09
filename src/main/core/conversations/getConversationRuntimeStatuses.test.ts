import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConversationRunStatus } from './getConversationRuntimeStatuses';

const mocks = vi.hoisted(() => ({
  findClaudeTranscriptPathBySessionId: vi.fn(),
  getClaudeSessionActivity: vi.fn(),
  getProviderConfig: vi.fn(),
  getRuntimeStatus: vi.fn(),
  isInterruptedSinceLastPrompt: vi.fn(),
  monitorRegistryGet: vi.fn(),
  ptyGet: vi.fn(),
  readClaudeTurnVerdictFile: vi.fn(),
  readCodexTurnVerdict: vi.fn(),
  resolveTask: vi.fn(),
  setRuntimeStatus: vi.fn(),
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    get: mocks.ptyGet,
  },
}));

vi.mock('@main/core/session-title/claude-title-source', () => ({
  resolveClaudeTranscriptPath: (_cwd: string, sessionId: string) =>
    `/transcripts/${sessionId}.jsonl`,
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: {
    getItem: mocks.getProviderConfig,
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('./agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    getStatus: mocks.getRuntimeStatus,
    setStatus: mocks.setRuntimeStatus,
  },
}));

vi.mock('./claude-run-state-source', () => ({
  readClaudeTurnVerdictFile: mocks.readClaudeTurnVerdictFile,
}));

vi.mock('./claude-session-activity-source', () => ({
  getClaudeSessionActivity: mocks.getClaudeSessionActivity,
}));

vi.mock('./claude-transcript-locator', () => ({
  findClaudeTranscriptPathBySessionId: mocks.findClaudeTranscriptPathBySessionId,
}));

vi.mock('./codex-run-state-source', () => ({
  readCodexTurnVerdict: mocks.readCodexTurnVerdict,
}));

vi.mock('./interrupt-marker', () => ({
  isInterruptedSinceLastPrompt: mocks.isInterruptedSinceLastPrompt,
}));

vi.mock('./runtime-status-monitor-registry', () => ({
  runtimeStatusMonitorRegistry: {
    get: mocks.monitorRegistryGet,
  },
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

function mountedTask(activeConversationIds: string[] = []) {
  return {
    conversations: {
      taskPath: '/repo',
      getActiveSessions: () =>
        activeConversationIds.map((conversationId) => ({ conversationId, pid: 4321 })),
    },
  };
}

async function readStatus(conversationId = 'conv-1') {
  return getConversationRunStatus({
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId,
    provider: 'claude',
    cwd: '/repo',
  });
}

async function readCodexStatus(conversationId = 'conv-1') {
  return getConversationRunStatus({
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId,
    provider: 'codex',
    cwd: '/repo',
  });
}

describe('getConversationRunStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeStatus.mockReturnValue('idle');
    mocks.getProviderConfig.mockResolvedValue(undefined);
    mocks.getClaudeSessionActivity.mockResolvedValue(null);
    mocks.isInterruptedSinceLastPrompt.mockReturnValue(false);
    mocks.monitorRegistryGet.mockReturnValue(undefined);
    mocks.ptyGet.mockReturnValue(undefined);
  });

  it('derives Claude working directly from the active PID activity record', async () => {
    mocks.resolveTask.mockReturnValue(mountedTask(['conv-1']));
    mocks.getClaudeSessionActivity.mockResolvedValue({
      pid: 4321,
      sessionId: 'native-session',
      cwd: '/repo',
      status: 'busy',
      waitingFor: null,
      updatedAt: Date.now(),
    });

    await expect(readStatus()).resolves.toBe('working');
    expect(mocks.getClaudeSessionActivity).toHaveBeenCalledWith(
      expect.objectContaining({ processPid: 4321 })
    );
  });

  it('derives Claude awaiting-input from activity waiting state', async () => {
    mocks.resolveTask.mockReturnValue(mountedTask(['conv-1']));
    mocks.getClaudeSessionActivity.mockResolvedValue({
      pid: 4321,
      sessionId: 'conv-1',
      cwd: '/repo',
      status: 'waiting',
      waitingFor: 'AskUserQuestion',
      updatedAt: Date.now(),
    });

    await expect(readStatus()).resolves.toBe('awaiting-input');
  });

  it('uses the selected Claude transcript monitor when configured', async () => {
    mocks.resolveTask.mockReturnValue(mountedTask(['conv-1']));
    mocks.getProviderConfig.mockResolvedValue({ statusMonitor: 'transcript' });
    mocks.readClaudeTurnVerdictFile.mockResolvedValue({
      state: 'working',
      interrupted: false,
      lastUserAt: Date.now(),
    });

    await expect(readStatus()).resolves.toBe('working');
    expect(mocks.readClaudeTurnVerdictFile).toHaveBeenCalledWith('/transcripts/conv-1.jsonl');
    expect(mocks.getClaudeSessionActivity).not.toHaveBeenCalled();
  });

  it('uses the monitor fixed for the live session over a later settings change', async () => {
    mocks.resolveTask.mockReturnValue(mountedTask(['conv-1']));
    mocks.monitorRegistryGet.mockReturnValue('transcript');
    mocks.getProviderConfig.mockResolvedValue({ statusMonitor: 'activity' });
    mocks.readClaudeTurnVerdictFile.mockResolvedValue({
      state: 'working',
      interrupted: false,
      lastUserAt: Date.now(),
    });

    await expect(readStatus()).resolves.toBe('working');
    expect(mocks.getProviderConfig).not.toHaveBeenCalled();
  });

  it('gates cached working when no provider truth or live PTY remains', async () => {
    mocks.getRuntimeStatus.mockReturnValue('working');
    mocks.resolveTask.mockReturnValue(mountedTask());

    await expect(readStatus()).resolves.toBe('idle');
    expect(mocks.setRuntimeStatus).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1', conversationId: 'conv-1' },
      'idle'
    );
  });

  it('trusts Codex rollout working verdicts instead of Claude interrupt markers', async () => {
    mocks.resolveTask.mockReturnValue(mountedTask(['conv-1']));
    mocks.readCodexTurnVerdict.mockResolvedValue({
      state: 'working',
      lastStartedAt: Date.parse('2026-06-10T00:00:05.000Z'),
    });
    mocks.isInterruptedSinceLastPrompt.mockReturnValue(true);

    await expect(readCodexStatus()).resolves.toBe('working');
    expect(mocks.isInterruptedSinceLastPrompt).not.toHaveBeenCalled();
  });

  it('surfaces Codex request_user_input as awaiting-input for active sessions', async () => {
    mocks.resolveTask.mockReturnValue(mountedTask(['conv-1']));
    mocks.readCodexTurnVerdict.mockResolvedValue({
      state: 'awaiting-input',
      lastStartedAt: Date.parse('2026-06-10T00:00:05.000Z'),
    });

    await expect(readCodexStatus()).resolves.toBe('awaiting-input');
  });

  it('preserves live Codex approval state while rollout still reports working', async () => {
    mocks.resolveTask.mockReturnValue(mountedTask(['conv-1']));
    mocks.getRuntimeStatus.mockReturnValue('awaiting-input');
    mocks.readCodexTurnVerdict.mockResolvedValue({
      state: 'working',
      lastStartedAt: Date.parse('2026-06-10T00:00:05.000Z'),
    });

    await expect(readCodexStatus()).resolves.toBe('awaiting-input');
    expect(mocks.setRuntimeStatus).not.toHaveBeenCalled();
  });

  it('does not downgrade a live completed status when the monitor reports idle', async () => {
    mocks.getRuntimeStatus.mockReturnValue('completed');
    mocks.resolveTask.mockReturnValue(mountedTask());
    mocks.getClaudeSessionActivity.mockResolvedValue({
      pid: 4321,
      sessionId: 'conv-1',
      cwd: '/repo',
      status: 'idle',
      waitingFor: null,
      updatedAt: Date.now(),
    });

    await expect(readStatus()).resolves.toBe('completed');
    expect(mocks.setRuntimeStatus).not.toHaveBeenCalled();
  });
});
