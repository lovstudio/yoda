import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import { injectPrompt } from './inject-prompt';
import { injectConversationPrompt } from './injectConversationPrompt';

const mocks = vi.hoisted(() => ({
  ptyGet: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    get: mocks.ptyGet,
  },
}));

vi.mock('@main/core/conversations/agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    setStatus: mocks.setStatus,
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('@main/db/schema', () => ({
  projects: {},
}));

vi.mock('./impl/image-attachments', () => ({
  injectClipboardImagesAndPrompt: vi.fn(),
  substituteImageMentions: vi.fn((prompt: string | undefined) => prompt),
}));

class FakePty implements Pty {
  readonly pid = 1234;
  readonly writes: string[] = [];

  write(data: string): void {
    this.writes.push(data);
  }

  resize(): void {}

  kill(): void {}

  onData(): void {}

  onExit(_handler: (info: PtyExitInfo) => void): void {}
}

const session = {
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'conversation-1',
};

describe('prompt injection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.ptyGet.mockReset();
    mocks.setStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds the Codex command submit suffix before pressing enter', async () => {
    const pty = new FakePty();
    mocks.ptyGet.mockReturnValue(pty);

    const result = injectPrompt(
      'session-1',
      session,
      'codex',
      '$lovstudio-git-commit-with-context'
    );

    expect(pty.writes).toEqual(['$lovstudio-git-commit-with-context', ' ']);

    await vi.advanceTimersByTimeAsync(300);

    await expect(result).resolves.toBe(true);
    expect(pty.writes).toEqual(['$lovstudio-git-commit-with-context', ' ', '\r']);
    expect(mocks.setStatus).toHaveBeenCalledWith(session, 'working');
  });

  it('waits for the deferred conversation PTY before injecting the prompt', async () => {
    const pty = new FakePty();
    let ptyReady = false;
    mocks.ptyGet.mockImplementation(() => (ptyReady ? pty : undefined));

    const result = injectConversationPrompt({
      ...session,
      runtime: 'codex',
      prompt: '$lovstudio-git-commit-with-context',
    });

    await Promise.resolve();
    expect(pty.writes).toEqual([]);

    ptyReady = true;
    await vi.advanceTimersByTimeAsync(400);

    await expect(result).resolves.toBe(true);
    expect(pty.writes).toEqual(['$lovstudio-git-commit-with-context', ' ', '\r']);
  });

  it('returns false when the deferred PTY never starts', async () => {
    mocks.ptyGet.mockReturnValue(undefined);

    const result = injectConversationPrompt({
      ...session,
      runtime: 'codex',
      prompt: '$lovstudio-git-commit-with-context',
    });

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBe(false);
  });
});
