import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { reconcileConversationPermission } from './reconcile-conversation-permission';

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  getSetting: vi.fn(),
  updateChain: {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  isNull: vi.fn((value: unknown) => ({ isNull: value })),
}));

vi.mock('@main/core/agents-config/agents-config-service', () => ({
  agentsConfigService: { get: mocks.getAgent },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: mocks.getSetting },
}));

vi.mock('@main/db/client', () => ({
  db: {
    update: vi.fn(() => mocks.updateChain),
  },
}));

vi.mock('@main/db/schema', () => ({
  conversations: {
    archivedAt: 'conversation.archivedAt',
    config: 'conversation.config',
    id: 'conversation.id',
    projectId: 'conversation.projectId',
    taskId: 'conversation.taskId',
  },
}));

describe('reconcileConversationPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateChain.set.mockReturnThis();
    mocks.updateChain.where.mockReturnThis();
    mocks.updateChain.returning.mockResolvedValue([{ id: 'conversation-1' }]);
    mocks.getSetting.mockImplementation((key: string) => {
      if (key === 'runtimePermissionModes') return Promise.resolve({});
      if (key === 'runtimeAutoApproveDefaults') return Promise.resolve({});
      throw new Error(`Unexpected setting: ${key}`);
    });
  });

  it('repairs a default session using the current Agent access level', async () => {
    mocks.getAgent.mockResolvedValue({ accessMode: 'full-access' });
    const conversation = {
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      runtimeId: 'codex',
      permissionMode: 'default',
      autoApprove: false,
      agent: { id: 'agent-1', name: 'General Agent' },
    } as Conversation;

    await expect(
      reconcileConversationPermission(
        conversation,
        JSON.stringify({ permissionMode: 'default', autoApprove: false })
      )
    ).resolves.toMatchObject({ permissionMode: 'bypass', autoApprove: true });

    expect(mocks.updateChain.set).toHaveBeenCalledWith({
      config: JSON.stringify({ permissionMode: 'bypass', autoApprove: true }),
    });
  });

  it('keeps an explicit plan session unchanged', async () => {
    const conversation = {
      id: 'conversation-2',
      projectId: 'project-1',
      taskId: 'task-1',
      runtimeId: 'codex',
      permissionMode: 'plan',
      autoApprove: false,
    } as Conversation;

    await expect(
      reconcileConversationPermission(
        conversation,
        JSON.stringify({ permissionMode: 'plan', autoApprove: false })
      )
    ).resolves.toBe(conversation);

    expect(mocks.getSetting).not.toHaveBeenCalled();
    expect(mocks.updateChain.set).not.toHaveBeenCalled();
  });
});
