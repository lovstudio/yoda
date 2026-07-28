import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChildrenProps = { children?: ReactNode };
const mocks = vi.hoisted(() => {
  const pageLoad = vi.fn();
  const localLoad = vi.fn();
  const remoteLoad = vi.fn();
  const save = vi.fn();
  const runProjectQuickAction = vi.fn();
  const navigate = vi.fn();
  const translate = (key: string) => key;
  const mountedProject = {
    data: {
      id: 'project-1',
      name: 'Example project',
      type: 'local' as const,
      path: '/tmp/example-project',
    },
    repository: {
      localData: { load: localLoad },
      remoteData: { load: remoteLoad },
      defaultBranch: { type: 'local' as const, branch: 'main' },
    },
  };
  const settingsStore = {
    pageData: { load: pageLoad },
    settings: {
      scripts: {},
      quickActions: [] as Array<{
        id: string;
        label: string;
        command: string;
        kind: 'agent' | 'shell';
        sourceIntent?: string;
      }>,
      composerDefaults: undefined,
    },
    save,
  };

  return {
    pageLoad,
    localLoad,
    remoteLoad,
    save,
    runProjectQuickAction,
    navigate,
    translate,
    mountedProject,
    projectStore: { mountedProject },
    settingsStore,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}));

vi.mock('@shared/task-name', () => ({
  taskNameFromPrompt: () => 'start-project',
}));

vi.mock('@renderer/features/projects/run-project-quick-action', () => ({
  runProjectQuickAction: mocks.runProjectQuickAction,
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  asMounted: () => mocks.mountedProject,
  getProjectSettingsStore: () => mocks.settingsStore,
  getProjectStore: () => mocks.projectStore,
  getRepositoryStore: () => mocks.mountedProject.repository,
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: undefined }),
}));

vi.mock('@renderer/features/tasks/conversations/use-effective-runtime', () => ({
  useEffectiveRuntime: () => ({ runtimeId: 'codex', createDisabled: false }),
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@renderer/lib/ui/confirm-button', async () => {
  const { createElement: create } = await import('react');
  return {
    ConfirmButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
      create('button', props, children),
  };
});

vi.mock('@renderer/lib/ui/dialog', async () => {
  const { createElement: create } = await import('react');
  const element = (tag: 'div' | 'h2', slot: string) =>
    function MockDialogElement({ children }: ChildrenProps) {
      return create(tag, { 'data-slot': slot }, children);
    };

  return {
    DialogContentArea: element('div', 'dialog-content-area'),
    DialogFooter: element('div', 'dialog-footer'),
    DialogHeader: element('div', 'dialog-header'),
    DialogTitle: element('h2', 'dialog-title'),
  };
});

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
  throw new Error(message);
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setValue?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CaptureProjectAutomationModal', () => {
  let host: HTMLDivElement;
  let root: Root;
  let onSuccess: (result: void) => void;
  let onClose: () => void;

  beforeEach(() => {
    mocks.pageLoad.mockReset().mockResolvedValue(undefined);
    mocks.localLoad.mockReset().mockResolvedValue(undefined);
    mocks.remoteLoad.mockReset().mockResolvedValue(undefined);
    mocks.save.mockReset();
    mocks.runProjectQuickAction
      .mockReset()
      .mockResolvedValue({ kind: 'agent', taskId: 'quick-action-task' });
    mocks.navigate.mockReset();
    mocks.settingsStore.settings = {
      scripts: {},
      quickActions: [
        {
          id: 'existing',
          label: 'Existing action',
          command: 'existing command',
          kind: 'agent',
        },
      ],
      composerDefaults: undefined,
    };
    onSuccess = vi.fn((_result: void) => {});
    onClose = vi.fn(() => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderModal(): Promise<void> {
    const { CaptureProjectAutomationModal } = await import(
      '@renderer/features/projects/components/capture-project-automation-modal'
    );
    await act(async () => {
      root.render(
        createElement(CaptureProjectAutomationModal, {
          projectId: 'project-1',
          projectName: 'Example project',
          onSuccess,
          onClose,
        })
      );
    });
    await waitFor(
      () => mocks.pageLoad.mock.calls.length > 0 && primaryButton()?.disabled === true,
      'quick-action modal did not load'
    );
  }

  function primaryButton(): HTMLButtonElement | undefined {
    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button');
    return buttons.item(buttons.length - 1) || undefined;
  }

  function intentTextarea(): HTMLTextAreaElement {
    const textarea = host.querySelector<HTMLTextAreaElement>('#quick-action-intent');
    if (!textarea) throw new Error('natural-language operation input was not rendered');
    return textarea;
  }

  async function enterIntentAndSubmit(intent: string): Promise<void> {
    await act(async () => setTextareaValue(intentTextarea(), intent));
    const submit = primaryButton();
    if (!submit) throw new Error('quick-action submit button was not rendered');
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toContain('sidebar.captureAutomation.saveAndRun');
    await act(async () => submit.click());
  }

  it('saves an Agent action and opens its inspectable task', async () => {
    mocks.save.mockResolvedValue({ success: true });
    await renderModal();

    await enterIntentAndSubmit('Start this project and verify the local URL.');
    await waitFor(
      () => mocks.runProjectQuickAction.mock.calls.length === 1,
      'saved quick action was not executed'
    );

    expect(mocks.localLoad).toHaveBeenCalledTimes(1);
    expect(mocks.remoteLoad).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const savedSettings = mocks.save.mock.calls[0]?.[0] as {
      quickActions: Array<{
        id: string;
        label: string;
        command: string;
        kind: 'agent' | 'shell';
        sourceIntent?: string;
      }>;
    };
    expect(savedSettings.quickActions[0]).toEqual({
      id: 'existing',
      label: 'Existing action',
      command: 'existing command',
      kind: 'agent',
    });
    const savedAction = savedSettings.quickActions[1];
    expect(savedAction).toMatchObject({
      label: 'start-project',
      command: expect.stringContaining('Start this project and verify the local URL.'),
      kind: 'agent',
      sourceIntent: 'Start this project and verify the local URL.',
    });
    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project: mocks.mountedProject,
      action: savedAction,
      runtimeId: 'codex',
      defaultBranch: { type: 'local', branch: 'main' },
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('task', {
      projectId: 'project-1',
      taskId: 'quick-action-task',
    });
  });

  it('keeps the form focused on the operation instead of exposing execution internals', async () => {
    await renderModal();

    expect(host.querySelector('#quick-action-label')).toBeNull();
    expect(host.querySelector('#quick-action-command')).toBeNull();
    expect(host.textContent).not.toContain('sidebar.captureAutomation.quickActionTarget');
    expect(host.textContent).not.toContain('sidebar.captureAutomation.runScriptTarget');
    expect(host.textContent).not.toContain('sidebar.captureAutomation.skillTarget');
    expect(host.querySelector('[aria-label="sidebar.captureAutomation.workflowLabel"]')).toBeNull();

    await act(async () => setTextareaValue(intentTextarea(), 'Start this project.'));

    expect(host.querySelector('#quick-action-label')).not.toBeNull();
    expect(host.querySelector('#quick-action-command')).toBeNull();
    expect(primaryButton()?.textContent).toContain('sidebar.captureAutomation.saveAndRun');
  });

  it('does not execute or navigate when saving the quick action fails', async () => {
    mocks.save.mockResolvedValue({ success: false });
    await renderModal();

    await enterIntentAndSubmit('Start this project.');
    await waitFor(() => mocks.save.mock.calls.length === 1, 'quick action was not saved');
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.runProjectQuickAction).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(host.textContent).toContain('projects.settings.saveFailed');
  });
});
