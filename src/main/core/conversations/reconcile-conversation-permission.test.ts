import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { reconcileConversationPermission } from './reconcile-conversation-permission';

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  getSetting: vi.fn(),
  updateChain: {
    set: vi.fn(),
    where: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
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
  conversations: { id: 'conversation.id' },
}));

describe('reconcileConversationPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateChain.set.mockReturnThis();
    mocks.updateChain.where.mockResolvedValue(undefined);
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
