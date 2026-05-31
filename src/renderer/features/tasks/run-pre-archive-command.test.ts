import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPreArchiveCommand } from './run-pre-archive-command';

const mocks = vi.hoisted(() => ({
  asProvisioned: vi.fn(),
  getTaskStore: vi.fn(),
  sendInput: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: mocks.asProvisioned,
  getTaskStore: mocks.getTaskStore,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    pty: {
      sendInput: mocks.sendInput,
    },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: {
    warn: mocks.warn,
  },
}));

function makeConversation(providerId: 'codex' | 'claude') {
  const conversation = {
    data: {
      providerId,
      lastInteractedAt: '2026-05-30T00:00:00.000Z',
    },
    session: {
      sessionId: `${providerId}-session`,
    },
    status: 'idle',
    setWorking: vi.fn(() => {
      conversation.status = 'working';
    }),
    clearWorking: vi.fn(() => {
      if (conversation.status === 'working') {
        conversation.status = 'idle';
      }
    }),
  };
  return conversation;
}

function mockProvisionedConversation(conversation: ReturnType<typeof makeConversation>) {
  mocks.getTaskStore.mockReturnValue({});
  mocks.asProvisioned.mockReturnValue({
    conversations: {
      conversations: new Map([['conversation-1', conversation]]),
    },
  });
}

describe('runPreArchiveCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendInput.mockResolvedValue({ ok: true });
  });

  it('submits Codex commands without adding a trailing space', async () => {
    const conversation = makeConversation('codex');
    mockProvisionedConversation(conversation);
    mocks.sendInput.mockImplementation(async (_sessionId: string, data: string) => {
      if (data === '\r') conversation.status = 'completed';
      return { ok: true };
    });

    await runPreArchiveCommand('project-1', 'task-1', 'lovstudio-git-commit-with-context');

    expect(mocks.sendInput.mock.calls).toEqual([
      ['codex-session', '$lovstudio-git-commit-with-context'],
      ['codex-session', '\r'],
    ]);
  });

  it('keeps carriage-return submission for Claude commands', async () => {
    const conversation = makeConversation('claude');
    mockProvisionedConversation(conversation);
    mocks.sendInput.mockImplementation(async (_sessionId: string, data: string) => {
      if (data === '\r') conversation.status = 'completed';
      return { ok: true };
    });

    await runPreArchiveCommand('project-1', 'task-1', 'lovstudio-git-commit-with-context');

    expect(mocks.sendInput.mock.calls).toEqual([
      ['claude-session', '/lovstudio-git-commit-with-context'],
      ['claude-session', '\r'],
    ]);
  });

  it('sends Ctrl-C and clears working state when interrupted', async () => {
    const conversation = makeConversation('codex');
    const abortController = new AbortController();
    mockProvisionedConversation(conversation);
    mocks.sendInput.mockImplementation(async (_sessionId: string, data: string) => {
      if (data === '\r') abortController.abort();
      return { ok: true };
    });

    await runPreArchiveCommand('project-1', 'task-1', 'lovstudio-git-commit-with-context', {
      signal: abortController.signal,
    });

    expect(mocks.sendInput.mock.calls).toEqual([
      ['codex-session', '$lovstudio-git-commit-with-context'],
      ['codex-session', '\r'],
      ['codex-session', '\x03'],
    ]);
    expect(conversation.status).toBe('idle');
  });
});
