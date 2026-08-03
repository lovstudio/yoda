import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const compile = vi.fn();
  const saveProjectQuickAction = vi.fn();
  const showCreateSkillModal = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  const conversation = {
    data: {
      id: 'conversation-1',
      runtimeId: 'codex' as const,
      lastInteractedAt: '2026-08-01T01:00:00.000Z',
    },
    status: 'completed' as const,
  };
  const taskData = {
    name: 'Review changes',
    quickActionSource: {
      prompt: 'Review the current changes.',
      conversationId: 'conversation-1',
      invokedSkill: false,
    },
  };
  return {
    compile,
    saveProjectQuickAction,
    showCreateSkillModal,
    toastSuccess,
    toastError,
    conversation,
    taskData,
    provisioned: {
      conversations: { conversations: new Map([['conversation-1', conversation]]) },
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/projects/save-project-quick-action', () => ({
  saveProjectQuickAction: mocks.saveProjectQuickAction,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getRegisteredTaskData: () => mocks.taskData,
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useTaskViewContext: () => ({ projectId: 'project-1', taskId: 'task-1' }),
  useRequireProvisionedTask: () => mocks.provisioned,
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { quickActions: { compile: mocks.compile } },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showCreateSkillModal,
}));

vi.mock('@renderer/lib/ui/popover', async () => {
  const { createElement: create } = await import('react');
  return {
    Popover: ({ children }: { children?: ReactNode }) => create('div', null, children),
    PopoverTrigger: ({ render }: { render: ReactNode }) => render,
    PopoverContent: ({ children }: { children?: ReactNode }) =>
      create('div', { 'data-testid': 'suggestion-content' }, children),
  };
});

let interactionSequence = 0;

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
  throw new Error(message);
}

describe('QuickActionSuggestionControl', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    mocks.compile.mockReset().mockResolvedValue({
      kind: 'command',
      label: 'Start project',
      command: 'pnpm run dev',
      explanation: 'The completed task used the existing dev script.',
    });
    mocks.saveProjectQuickAction.mockReset().mockResolvedValue(true);
    mocks.showCreateSkillModal.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.taskData.quickActionSource.invokedSkill = false;
    interactionSequence += 1;
    mocks.conversation.data.lastInteractedAt = `interaction-${interactionSequence}`;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderControl(): Promise<void> {
    const { QuickActionSuggestionControl } = await import(
      '@renderer/features/tasks/quick-action-suggestion-control'
    );
    await act(async () => root.render(createElement(QuickActionSuggestionControl)));
  }

  function buttonWithText(text: string): HTMLButtonElement | undefined {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes(text)
    );
  }

  it('analyzes only after completion and offers the supported command', async () => {
    await renderControl();
    await waitFor(
      () => host.textContent?.includes('tasks.quickActionSuggestion.commandCta') === true,
      'command suggestion did not appear'
    );

    expect(mocks.compile).toHaveBeenCalledWith({
      projectId: 'project-1',
      intent: 'Review the current changes.',
      runtimeId: 'codex',
      taskContext: { taskId: 'task-1', conversationId: 'conversation-1' },
    });
    await act(async () => buttonWithText('tasks.quickActionSuggestion.saveCommand')?.click());
    await waitFor(
      () => mocks.saveProjectQuickAction.mock.calls.length === 1,
      'suggested command was not saved'
    );
    expect(mocks.saveProjectQuickAction).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        label: 'Start project',
        command: 'pnpm run dev',
        kind: 'command',
      })
    );
  });

  it('stays silent when the completed task has no reusable operation', async () => {
    mocks.compile.mockResolvedValue({
      kind: 'none',
      explanation: 'This was a one-off task.',
    });
    await renderControl();
    await waitFor(() => mocks.compile.mock.calls.length === 1, 'task was not analyzed');

    expect(host.textContent).toBe('');
  });

  it('does not offer to create another Skill when the task already invoked one', async () => {
    mocks.taskData.quickActionSource.invokedSkill = true;
    mocks.compile.mockResolvedValue({
      kind: 'skill',
      label: 'Review changes',
      instruction: 'Review the current changes and fix the highest-risk issue.',
      explanation: 'Each run still requires judgment.',
    });
    await renderControl();
    await waitFor(
      () => host.textContent?.includes('tasks.quickActionSuggestion.instructionCta') === true,
      'instruction suggestion did not appear'
    );

    expect(buttonWithText('tasks.quickActionSuggestion.createSkill')).toBeUndefined();
    expect(buttonWithText('tasks.quickActionSuggestion.saveInstruction')).toBeDefined();
  });
});
