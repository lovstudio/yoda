import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConversationRunStatus } from './getConversationRuntimeStatuses';

const state = vi.hoisted(() => ({
  transcriptDir: '',
}));

const mocks = vi.hoisted(() => ({
  findClaudeTranscriptPathBySessionId: vi.fn(),
  getRuntimeStatus: vi.fn(),
  isInterruptedSinceLastPrompt: vi.fn(),
  ptyGet: vi.fn(),
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
    `${state.transcriptDir}/${sessionId}.jsonl`,
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

vi.mock('./claude-transcript-locator', () => ({
  findClaudeTranscriptPathBySessionId: mocks.findClaudeTranscriptPathBySessionId,
}));

vi.mock('./codex-run-state-source', () => ({
  readCodexTurnVerdict: mocks.readCodexTurnVerdict,
}));

vi.mock('./interrupt-marker', () => ({
  isInterruptedSinceLastPrompt: mocks.isInterruptedSinceLastPrompt,
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

function writeTranscript(conversationId: string): void {
  const rows = [
    { type: 'system', subtype: 'stop_hook_summary' },
    {
      type: 'user',
      timestamp: '2026-06-10T00:00:05.000Z',
      message: { role: 'user', content: 'continue' },
    },
  ];
  writeFileSync(
    join(state.transcriptDir, `${conversationId}.jsonl`),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
  );
}

function mountedTask(activeConversationIds: string[] = []) {
  return {
    conversations: {
      taskPath: '/repo',
      getActiveSessions: () => activeConversationIds.map((conversationId) => ({ conversationId })),
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
    state.transcriptDir = mkdtempSync(join(tmpdir(), 'yoda-runtime-status-'));
    vi.clearAllMocks();
    mocks.getRuntimeStatus.mockReturnValue('idle');
    mocks.isInterruptedSinceLastPrompt.mockReturnValue(false);
    mocks.ptyGet.mockReturnValue(undefined);
  });

  afterEach(() => {
    rmSync(state.transcriptDir, { recursive: true, force: true });
  });

  it('gates a mounted transcript-only working verdict when no session is active', async () => {
    writeTranscript('conv-1');
    mocks.resolveTask.mockReturnValue(mountedTask());

    await expect(readStatus()).resolves.toBe('idle');
    expect(mocks.setRuntimeStatus).not.toHaveBeenCalled();
  });

  it('keeps transcript-derived working for cold-load tasks without a mounted provider', async () => {
    writeTranscript('conv-1');
    mocks.resolveTask.mockReturnValue(undefined);

    await expect(readStatus()).resolves.toBe('working');
    expect(mocks.setRuntimeStatus).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1', conversationId: 'conv-1' },
      'working'
    );
  });

  it('keeps transcript-derived working when the mounted provider still has an active session', async () => {
    writeTranscript('conv-1');
    mocks.resolveTask.mockReturnValue(mountedTask(['conv-1']));

    await expect(readStatus()).resolves.toBe('working');
    expect(mocks.setRuntimeStatus).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1', conversationId: 'conv-1' },
      'working'
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
    expect(mocks.setRuntimeStatus).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1', conversationId: 'conv-1' },
      'working'
    );
  });

  it('surfaces Codex request_user_input as awaiting-input for active sessions', async () => {
    mocks.resolveTask.mockReturnValue(mountedTask(['conv-1']));
    mocks.readCodexTurnVerdict.mockResolvedValue({
      state: 'awaiting-input',
      lastStartedAt: Date.parse('2026-06-10T00:00:05.000Z'),
    });

    await expect(readCodexStatus()).resolves.toBe('awaiting-input');
    expect(mocks.setRuntimeStatus).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1', conversationId: 'conv-1' },
      'awaiting-input'
    );
  });

  it('does not downgrade a live completed status when the rollout classifier reports idle', async () => {
    mocks.getRuntimeStatus.mockReturnValue('completed');
    mocks.resolveTask.mockReturnValue(mountedTask());
    mocks.readCodexTurnVerdict.mockResolvedValue({
      state: 'idle',
      lastStartedAt: Date.parse('2026-06-10T00:00:05.000Z'),
    });

    await expect(readCodexStatus()).resolves.toBe('completed');
    expect(mocks.setRuntimeStatus).not.toHaveBeenCalled();
  });
});
