import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@shared/events/agentEvents';
import { maybeShowNotification } from './notification';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  getSettings: vi.fn(),
  isSupported: vi.fn(),
  limit: vi.fn(),
  on: vi.fn(),
  show: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('electron', () => {
  class MockNotification {
    static isSupported = mocks.isSupported;

    constructor(public readonly options: unknown) {}

    on = mocks.on;
    show = mocks.show;
  }

  return {
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
    Notification: MockNotification,
  };
});

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: mocks.getSettings },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.limit })),
      })),
    })),
  },
}));

vi.mock('@main/app/window', () => ({ getMainWindow: vi.fn(() => null) }));
vi.mock('@main/lib/events', () => ({ events: { emit: mocks.emit } }));
vi.mock('@main/lib/logger', () => ({ log: { warn: mocks.warn } }));

const defaultSettings = {
  enabled: true,
  sound: true,
  osNotifications: true,
  soundFocusMode: 'unfocused' as const,
};

function makeEvent(type: AgentEvent['type'], payload: AgentEvent['payload'] = {}): AgentEvent {
  return {
    type,
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId: 'conversation-1',
    runtimeId: 'codex',
    timestamp: 1,
    payload,
  };
}

describe('maybeShowNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSupported.mockReturnValue(true);
    mocks.limit.mockResolvedValue([{ name: 'Test task' }]);
    mocks.getSettings.mockResolvedValue(defaultSettings);
  });

  it('shows a completion notification when the window is unfocused', async () => {
    await maybeShowNotification(makeEvent('stop'), false);

    expect(mocks.show).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });

  it('respects the completion focus mode instead of dropping the event', async () => {
    await maybeShowNotification(makeEvent('stop'), true);
    expect(mocks.show).not.toHaveBeenCalled();

    mocks.getSettings.mockResolvedValue({ ...defaultSettings, soundFocusMode: 'always' });
    await maybeShowNotification(makeEvent('stop'), true);
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  it('keeps permission notifications independently configurable', async () => {
    mocks.getSettings.mockResolvedValue({ ...defaultSettings, permissionNotifications: false });
    await maybeShowNotification(
      makeEvent('notification', { notificationType: 'permission_prompt' }),
      false
    );

    expect(mocks.show).not.toHaveBeenCalled();
  });
});
