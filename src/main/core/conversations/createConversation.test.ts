import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { withConversationOperation } from './conversation-operation-lock';
import { createConversation } from './createConversation';

const mocks = vi.hoisted(() => ({
  clearPendingInitialPrompt: vi.fn(),
  emitConversationCreated: vi.fn(),
  insertValues: vi.fn(),
  resolveTask: vi.fn(),
  runtimeConfigGet: vi.fn(),
  selectLimit: vi.fn(),
  startSession: vi.fn(),
  telemetryCapture: vi.fn(),
  updateSet: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from() {
        return this;
      },
      where() {
        return this;
      },
      limit: mocks.selectLimit,
    })),
    insert: vi.fn(() => ({ values: mocks.insertValues })),
    update: vi.fn(() => ({ set: mocks.updateSet })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  },
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: mocks.runtimeConfigGet },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn() },
}));

vi.mock('@main/core/skills/SkillsService', () => ({
  skillsService: { resolveSessionPolicy: vi.fn() },
}));

vi.mock('./local-agent-session-catalog-instance', () => ({
  localAgentSessionCatalog: { validateSource: vi.fn() },
}));

vi.mock('./conversation-events', () => ({
  conversationEvents: { _emit: mocks.emitConversationCreated },
}));

vi.mock('./pending-initial-prompt-store', () => ({
  clearPendingInitialPrompt: mocks.clearPendingInitialPrompt,
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.telemetryCapture },
}));

describe('createConversation', () => {
  const sessionId = makePtySessionId('project-1', 'task-1', 'conversation-1');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectLimit.mockResolvedValue([]);
    mocks.runtimeConfigGet.mockResolvedValue(undefined);
    mocks.startSession.mockResolvedValue(undefined);
    mocks.resolveTask.mockReturnValue({
      conversations: {
        taskPath: '/workspace',
        startSession: mocks.startSession,
        waitsForInitialPromptSessionBinding: (runtimeId: string) => runtimeId === 'codex',
      },
    });
    mocks.insertValues.mockImplementation((values: Record<string, unknown>) => ({
      returning: vi.fn().mockResolvedValue([
        {
          ...values,
          createdAt: '2026-08-11T12:22:02.000Z',
          updatedAt: '2026-08-11T12:22:02.000Z',
          archivedAt: null,
          forkedFromConversationId: null,
          forkedFromPromptIndex: null,
        },
      ]),
    }));
    mocks.updateSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    ptySessionRegistry.unregister(sessionId);
  });

  it('passes the durable pending prompt to provider startup without exposing it to renderer events', async () => {
    const created = await createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Link interaction',
      runtime: 'codex',
      permissionMode: 'bypass',
      initialPrompt: 'Open recognized links with one click',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
    });

    const startupConversation = mocks.startSession.mock.calls[0]?.[0];
    expect(startupConversation).toEqual(
      expect.objectContaining({
        id: 'conversation-1',
        pendingInitialPrompt: {
          prompt: 'Open recognized links with one click',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'ultra',
        },
      })
    );
    expect(mocks.startSession).toHaveBeenCalledWith(
      startupConversation,
      undefined,
      false,
      'Open recognized links with one click',
      undefined,
      undefined,
      { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' }
    );
    expect(mocks.emitConversationCreated).toHaveBeenCalledWith(
      'conversation:created',
      expect.not.objectContaining({ pendingInitialPrompt: expect.anything() })
    );
    expect(created.pendingInitialPrompt).toBeUndefined();
    expect(mocks.clearPendingInitialPrompt).not.toHaveBeenCalled();
  });

  it('holds the lifecycle lock from persistence through provider startup', async () => {
    let finishStart!: () => void;
    mocks.startSession.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishStart = resolve;
      })
    );

    const creating = createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Locked creation',
      runtime: 'codex',
      permissionMode: 'bypass',
      initialPrompt: 'Keep creation atomic with lifecycle operations',
    });
    await vi.waitFor(() => expect(mocks.startSession).toHaveBeenCalledOnce());

    let lifecycleEntered = false;
    const lifecycle = withConversationOperation(
      { id: 'conversation-1', projectId: 'project-1' },
      async () => {
        lifecycleEntered = true;
      }
    );
    await Promise.resolve();
    expect(lifecycleEntered).toBe(false);

    finishStart();
    await creating;
    await lifecycle;
    expect(lifecycleEntered).toBe(true);
  });
});
