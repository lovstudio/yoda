import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildConversationSections } from '@renderer/app/app-tab-context-menu';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {},
  events: { on: vi.fn(() => () => undefined), emit: vi.fn() },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    appTabs: { visibleTabs: [], activeTabId: null },
    sidePane: {},
  },
}));

vi.mock('@renderer/features/tasks/components/task-context-menu', () => ({
  copyTaskLink: vi.fn(),
  TaskContextMenu: () => null,
  TaskContextMenuItems: () => null,
}));

vi.mock('@renderer/features/tasks/components/use-task-menu-actions', () => ({
  useTaskMenuActions: () => null,
}));

describe('conversation tab context menu', () => {
  it('includes the shared move-to-task submenu', () => {
    const provisioned = {
      conversations: {
        conversations: new Map([
          [
            'conversation-1',
            {
              data: {
                id: 'conversation-1',
                runtimeId: 'codex',
                title: 'Session',
              },
            },
          ],
        ]),
      },
    } as unknown as ProvisionedTask;

    const [management] = buildConversationSections(
      provisioned,
      'project-1',
      'task-1',
      'conversation-1',
      ((key: string) => key) as Parameters<typeof buildConversationSections>[4]
    );

    expect(management.some((item) => isValidElement(item) && item.key === 'move')).toBe(true);
  });
});
