import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeSessionPrompt } from '@shared/conversations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const prompt: ClaudeSessionPrompt = {
  id: 'prompt-1',
  text: 'current path prompt',
  timestamp: null,
  restoreTarget: { kind: 'codex-turn', turnId: 'turn-1' },
};

const mocks = vi.hoisted(() => ({
  settings: {
    dockSessionHistory: true,
    dockSessionHistoryRows: 3,
  },
  update: vi.fn(),
  useSessionPrompts: vi.fn(),
  useSessionPromptTree: vi.fn(),
  restoreCurrentPrompt: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => {
  return {
    useAppSettingsKey: () => ({ value: mocks.settings, update: mocks.update }),
  };
});

vi.mock('@renderer/features/tasks/session-info-panel', () => ({
  useSessionPrompts: (active: boolean) => mocks.useSessionPrompts(active),
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useProvisionedTask: () => ({
    conversations: { conversations: new Map() },
    taskView: {
      tabManager: { openConversation: vi.fn() },
      setFocusedRegion: vi.fn(),
    },
  }),
}));

vi.mock('@renderer/features/tasks/conversations/session-prompt-tree', async () => {
  const { createElement: create } = await import('react');
  return {
    countSessionPromptTreeNodes: () => 4,
    SessionPromptTreeView: () => create('div', { 'data-session-prompt-tree': true }, 'tree path'),
  };
});

vi.mock('@renderer/features/tasks/conversations/use-conversation-prompt-restore', () => ({
  useConversationPromptRestore: () => ({
    restoringPrompt: null,
    requestRestorePrompt: vi.fn(),
  }),
}));

vi.mock('@renderer/features/tasks/conversations/use-session-prompt-tree', () => ({
  useSessionPromptTree: (active: boolean) => mocks.useSessionPromptTree(active),
}));

vi.mock('@renderer/features/tasks/conversations/use-archived-conversations', () => ({
  reopenArchivedConversation: vi.fn(async () => {}),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@renderer/utils/logger', () => ({ log: { warn: vi.fn() } }));

describe('DockedSessionHistory conversation tree menu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.settings = {
      dockSessionHistory: true,
      dockSessionHistoryRows: 3,
    };
    mocks.update.mockClear();
    mocks.restoreCurrentPrompt.mockClear();
    mocks.useSessionPrompts.mockReset().mockReturnValue({
      prompts: [prompt],
      isLoading: false,
      hasPrompts: true,
      hasConversation: true,
      restoringPromptId: null,
      requestRestorePrompt: mocks.restoreCurrentPrompt,
      openPromptsModal: vi.fn(),
    });
    mocks.useSessionPromptTree.mockReset().mockReturnValue({
      tree: { lineageConversations: [{ id: 'branch-1' }] },
      isLoading: false,
      hasConversation: true,
      activeConversationIds: new Set<string>(),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the current path list visible and opens the complete tree from the icon', async () => {
    const { DockedSessionHistory } = await import(
      '@renderer/features/tasks/conversations/session-history-panel'
    );
    await act(async () => root.render(createElement(DockedSessionHistory)));

    expect(host.textContent).toContain('current path prompt');
    expect(host.querySelector('[data-session-prompt-tree]')).toBeNull();
    expect(mocks.useSessionPrompts).toHaveBeenLastCalledWith(true);
    expect(mocks.useSessionPromptTree).toHaveBeenLastCalledWith(false);

    const currentPrompt = host.querySelector<HTMLButtonElement>(
      'div[title="current path prompt"] > button'
    );
    await act(async () => currentPrompt?.click());
    expect(mocks.restoreCurrentPrompt).toHaveBeenCalledWith(prompt, 1);

    expect(host.querySelector('button[aria-label="tasks.bottomPanel.sessionViewList"]')).toBeNull();
    const viewTree = host.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.bottomPanel.sessionViewTree"]'
    );
    await act(async () => viewTree?.click());

    expect(mocks.update).not.toHaveBeenCalled();
    expect(host.textContent).toContain('current path prompt');
    expect(document.querySelector('[data-session-prompt-tree]')?.textContent).toBe('tree path');
    expect(document.body.textContent).toContain(
      'tasks.bottomPanel.sessionTreeSingleConversationDescription'
    );
    expect(document.body.textContent).toContain('tasks.bottomPanel.sessionTreeSummary');
    expect(mocks.useSessionPrompts).toHaveBeenLastCalledWith(true);
    expect(mocks.useSessionPromptTree).toHaveBeenLastCalledWith(true);
  });

  it('keeps the tree icon available while the current-path list is collapsed', async () => {
    const { DockedSessionHistory } = await import(
      '@renderer/features/tasks/conversations/session-history-panel'
    );
    await act(async () => root.render(createElement(DockedSessionHistory)));

    const collapse = host.querySelector<HTMLButtonElement>('button[aria-expanded="true"]');
    await act(async () => collapse?.click());

    expect(host.textContent).not.toContain('current path prompt');
    const viewTree = host.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.bottomPanel.sessionViewTree"]'
    );
    expect(viewTree).not.toBeNull();
    expect(mocks.useSessionPrompts).toHaveBeenLastCalledWith(false);
    expect(mocks.useSessionPromptTree).toHaveBeenLastCalledWith(false);

    await act(async () => viewTree?.click());

    expect(document.querySelector('[data-session-prompt-tree]')).not.toBeNull();
    expect(mocks.useSessionPromptTree).toHaveBeenLastCalledWith(true);
  });
});
