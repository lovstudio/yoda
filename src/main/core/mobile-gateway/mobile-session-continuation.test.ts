import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureMobileConversationInputSession,
  resolveMobileSessionAvailability,
} from './mobile-session-continuation';

const mocks = vi.hoisted(() => ({
  getActiveSessions: vi.fn(),
  getPty: vi.fn(),
  getTask: vi.fn(),
  provisionTask: vi.fn(),
  resumeConversation: vi.fn(),
}));

vi.mock('@main/core/conversations/resumeConversation', () => ({
  resumeConversation: mocks.resumeConversation,
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: { get: mocks.getPty },
}));

vi.mock('@main/core/tasks/provisionTask', () => ({
  provisionTask: mocks.provisionTask,
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: { getTask: mocks.getTask },
}));

const input = {
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'conversation-1',
};

describe('mobile session availability', () => {
  it('keeps a cold resumable session actionable without reporting it as running', () => {
    expect(
      resolveMobileSessionAvailability(
        { running: false, resumeCommand: 'codex resume conversation-1' },
        false
      )
    ).toEqual({
      running: false,
      acceptsInput: false,
      resumable: true,
    });
  });

  it('reports a registered PTY as live even before session metadata catches up', () => {
    expect(resolveMobileSessionAvailability({ running: false }, true)).toEqual({
      running: true,
      acceptsInput: true,
      resumable: false,
    });
  });
});

describe('ensureMobileConversationInputSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPty.mockReturnValue(undefined);
    mocks.getActiveSessions.mockReturnValue([]);
    mocks.getTask.mockReturnValue({
      conversations: { getActiveSessions: mocks.getActiveSessions },
    });
    mocks.provisionTask.mockResolvedValue({ path: '/workspace', workspaceId: 'workspace-1' });
    mocks.resumeConversation.mockResolvedValue(true);
  });

  it('reuses an already registered PTY without provisioning or resuming', async () => {
    mocks.getPty.mockReturnValue({});

    await expect(ensureMobileConversationInputSession(input)).resolves.toBe(true);

    expect(mocks.provisionTask).not.toHaveBeenCalled();
    expect(mocks.resumeConversation).not.toHaveBeenCalled();
  });

  it('reuses an active provider session without provisioning or resuming', async () => {
    mocks.getActiveSessions.mockReturnValue([{ conversationId: input.conversationId }]);

    await expect(ensureMobileConversationInputSession(input)).resolves.toBe(true);

    expect(mocks.provisionTask).not.toHaveBeenCalled();
    expect(mocks.resumeConversation).not.toHaveBeenCalled();
  });

  it('provisions the task and resumes a cold conversation before input', async () => {
    await expect(ensureMobileConversationInputSession(input)).resolves.toBe(true);

    expect(mocks.provisionTask).toHaveBeenCalledWith(input.taskId);
    expect(mocks.resumeConversation).toHaveBeenCalledWith(
      input.projectId,
      input.taskId,
      input.conversationId
    );
  });

  it('uses a session restored during task provisioning without starting it twice', async () => {
    mocks.provisionTask.mockImplementation(async () => {
      mocks.getActiveSessions.mockReturnValue([{ conversationId: input.conversationId }]);
      return { path: '/workspace', workspaceId: 'workspace-1' };
    });

    await expect(ensureMobileConversationInputSession(input)).resolves.toBe(true);

    expect(mocks.resumeConversation).not.toHaveBeenCalled();
  });

  it('reports a failed cold-session resume', async () => {
    mocks.resumeConversation.mockResolvedValue(false);

    await expect(ensureMobileConversationInputSession(input)).resolves.toBe(false);
  });
});
