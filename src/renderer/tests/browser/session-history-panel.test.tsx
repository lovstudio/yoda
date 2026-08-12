import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
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
  copyTextToClipboard: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' },
  }),
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
  useRequireProvisionedTask: () => ({
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

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: vi.fn(),
  copyTextToClipboard: mocks.copyTextToClipboard,
}));
vi.mock('@renderer/utils/logger', () => ({ log: { warn: vi.fn() } }));

async function waitForElementToDisappear(selector: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (!document.querySelector(selector)) return;
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
  throw new Error(`Element did not disappear: ${selector}`);
}

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
    mocks.copyTextToClipboard.mockReset().mockResolvedValue(undefined);
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
    document.querySelectorAll('[data-slot="tooltip-content"]').forEach((node) => node.remove());
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

    const currentPrompt = host
      .querySelector<HTMLButtonElement>('button [data-slot="tooltip-trigger"]')
      ?.closest('button');
    await act(async () => currentPrompt?.click());
    expect(mocks.restoreCurrentPrompt).toHaveBeenCalledWith(prompt, 1);

    expect(host.querySelector('button[aria-label="tasks.bottomPanel.sessionViewList"]')).toBeNull();
    const viewTree = host.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.bottomPanel.sessionViewTree"]'
    );
    expect(viewTree?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => viewTree?.click());

    expect(viewTree?.getAttribute('aria-expanded')).toBe('true');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(host.textContent).toContain('current path prompt');
    expect(document.querySelector('[data-session-prompt-tree]')?.textContent).toBe('tree path');
    expect(document.body.textContent).toContain(
      'tasks.bottomPanel.sessionTreeSingleConversationDescription'
    );
    expect(document.body.textContent).toContain('tasks.bottomPanel.sessionTreeSummary');
    expect(mocks.useSessionPrompts).toHaveBeenLastCalledWith(true);
    expect(mocks.useSessionPromptTree).toHaveBeenLastCalledWith(true);

    await act(async () => viewTree?.click());

    expect(viewTree?.getAttribute('aria-expanded')).toBe('false');
    await waitForElementToDisappear('[data-session-prompt-tree]');
    expect(document.querySelector('[data-session-prompt-tree]')).toBeNull();
    expect(mocks.useSessionPromptTree).toHaveBeenLastCalledWith(false);
  });

  it('keeps cold transcript loading paused until its owner activates it', async () => {
    const { DockedSessionHistory } = await import(
      '@renderer/features/tasks/conversations/session-history-panel'
    );
    await act(async () => root.render(createElement(DockedSessionHistory, { active: false })));

    expect(mocks.useSessionPrompts).toHaveBeenLastCalledWith(false);
    expect(host.textContent).toContain('current path prompt');

    await act(async () => root.render(createElement(DockedSessionHistory, { active: true })));

    expect(mocks.useSessionPrompts).toHaveBeenLastCalledWith(true);
  });

  it('shows the complete prompt in a tooltip when hovering a truncated row', async () => {
    const fullPrompt =
      'This is the complete prompt text that stays available even when the docked row truncates it.';
    const promptTimestamp = '2026-07-15T08:30:00.000Z';
    const secondPrompt = {
      id: 'prompt-2',
      text: 'second path prompt',
      timestamp: '2026-08-01T08:30:00.000Z',
      restoreTarget: { kind: 'codex-turn' as const, turnId: 'turn-2' },
    };
    mocks.useSessionPrompts.mockReturnValue({
      prompts: [{ ...prompt, text: fullPrompt, timestamp: promptTimestamp }, secondPrompt],
      isLoading: false,
      hasPrompts: true,
      hasConversation: true,
      restoringPromptId: null,
      requestRestorePrompt: mocks.restoreCurrentPrompt,
      openPromptsModal: vi.fn(),
    });

    const { DockedSessionHistory } = await import(
      '@renderer/features/tasks/conversations/session-history-panel'
    );
    await act(async () => root.render(createElement(DockedSessionHistory)));

    const promptText = host.querySelector<HTMLElement>('[data-slot="tooltip-trigger"]');
    expect(promptText?.textContent).toBe(fullPrompt);

    await act(async () => userEvent.hover(promptText!));

    await vi.waitFor(async () => {
      const preview = document.querySelector<HTMLElement>('[data-session-prompt-preview]');
      const createdAt = preview?.querySelector('time');
      expect(preview?.textContent).toContain(fullPrompt);
      expect(createdAt?.getAttribute('dateTime')).toBe(new Date(promptTimestamp).toISOString());
      expect(createdAt?.textContent).toMatch(/前$/);
      expect(preview?.textContent).toContain('tasks.bottomPanel.sessionBranchFromHere');
      expect(preview?.textContent).not.toContain('tasks.sessionInfo.restoreContextAtPrompt');

      const historyBars = document.querySelectorAll<HTMLButtonElement>(
        '[data-session-prompt-history-bar]'
      );
      expect(historyBars).toHaveLength(2);
      expect(historyBars[0]?.getAttribute('data-session-prompt-history-bar-active')).toBe('true');
      expect(historyBars[1]?.getAttribute('data-session-prompt-history-bar-active')).toBe('false');

      const copyButton = document.querySelector<HTMLButtonElement>('[data-session-prompt-copy]');
      expect(copyButton?.getAttribute('aria-label')).toBe('common.copy');
      await act(async () => copyButton?.click());
      expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(fullPrompt);
      expect(copyButton?.getAttribute('aria-label')).toBe('common.copied');
    });

    const historyBars = document.querySelectorAll<HTMLButtonElement>(
      '[data-session-prompt-history-bar]'
    );
    const initialBarWidth = Number.parseFloat(
      historyBars[0]?.querySelector('span')?.style.width ?? '0'
    );
    await act(async () => userEvent.hover(historyBars[0]!));
    await vi.waitFor(() => {
      const magnifiedBarWidth = Number.parseFloat(
        historyBars[0]?.querySelector('span')?.style.width ?? '0'
      );
      expect(magnifiedBarWidth).toBeGreaterThan(initialBarWidth);
    });

    await act(async () => userEvent.click(historyBars[1]!));

    await vi.waitFor(() => {
      const preview = document.querySelector<HTMLElement>('[data-session-prompt-preview]');
      const createdAt = preview?.querySelector('time');
      expect(preview?.textContent).toContain(secondPrompt.text);
      expect(preview?.textContent).not.toContain(fullPrompt);
      expect(createdAt?.getAttribute('dateTime')).toBe(
        new Date(secondPrompt.timestamp).toISOString()
      );
      expect(historyBars[0]?.getAttribute('data-session-prompt-history-bar-active')).toBe('false');
      expect(historyBars[1]?.getAttribute('data-session-prompt-history-bar-active')).toBe('true');
    });

    const forkButton = document.querySelector<HTMLButtonElement>(
      '[data-session-prompt-preview] button[aria-label="tasks.sessionInfo.restoreContextAtPrompt"]'
    );
    expect(forkButton?.textContent).toContain('tasks.bottomPanel.sessionBranchFromHere');
    await act(async () => forkButton?.click());
    expect(mocks.restoreCurrentPrompt).toHaveBeenCalledWith(secondPrompt, 2);
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
