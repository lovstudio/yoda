import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChildrenProps = { children?: ReactNode };
type MockComposerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const mocks = vi.hoisted(() => {
  const load = vi.fn();
  const save = vi.fn();
  const compile = vi.fn();
  const runProjectQuickAction = vi.fn();
  const translate = (key: string) => key;
  const mountedProject = {
    data: {
      id: 'project-1',
      name: 'Example project',
      type: 'local' as const,
      path: '/tmp/example-project',
    },
    repository: {
      localData: { load },
      remoteData: { load },
      defaultBranch: { type: 'local' as const, branch: 'main' },
    },
  };
  const settingsStore = {
    pageData: { load },
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
    load,
    save,
    compile,
    runProjectQuickAction,
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

vi.mock('@renderer/app/composer-prompt-input', async () => {
  const { createElement: create } = await import('react');
  return {
    ComposerPromptInput: ({ value, onChange, disabled }: MockComposerProps) =>
      create('textarea', {
        'aria-label': 'natural-language-operation',
        value,
        disabled,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          onChange(event.currentTarget.value),
      }),
  };
});

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

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    quickActions: {
      compile: mocks.compile,
    },
  },
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
    mocks.load.mockReset().mockResolvedValue(undefined);
    mocks.save.mockReset();
    mocks.compile.mockReset().mockResolvedValue({
      label: 'Start project',
      command: 'pnpm run dev',
      explanation: 'package.json defines the dev script',
    });
    mocks.runProjectQuickAction.mockReset().mockResolvedValue({ kind: 'shell' });
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
      () => mocks.load.mock.calls.length > 0 && primaryButton()?.disabled === true,
      'quick-action modal did not load'
    );
  }

  function primaryButton(): HTMLButtonElement | undefined {
    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button');
    return buttons.item(buttons.length - 1) || undefined;
  }

  function intentTextarea(): HTMLTextAreaElement {
    const textarea = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="natural-language-operation"]'
    );
    if (!textarea) throw new Error('natural-language operation input was not rendered');
    return textarea;
  }

  async function enterIntentCompileAndSubmit(intent: string): Promise<void> {
    await act(async () => setTextareaValue(intentTextarea(), intent));
    const generate = primaryButton();
    if (!generate) throw new Error('quick-action primary button was not rendered');
    expect(generate.disabled).toBe(false);
    expect(generate.textContent).toContain('sidebar.captureAutomation.generateCommand');
    await act(async () => generate.click());
    await waitFor(
      () =>
        host.querySelector<HTMLTextAreaElement>('textarea:not([aria-label])')?.value ===
        'pnpm run dev',
      'compiled command was not rendered'
    );
    const submit = primaryButton();
    if (!submit) throw new Error('quick-action submit button was not rendered');
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toContain('sidebar.captureAutomation.saveAndRun');
    await act(async () => submit.click());
  }

  it('compiles natural language, saves a shell action, and executes the command directly', async () => {
    mocks.save.mockResolvedValue({ success: true });
    await renderModal();

    await enterIntentCompileAndSubmit('Start this project and verify the local URL.');
    await waitFor(
      () => mocks.runProjectQuickAction.mock.calls.length === 1,
      'saved quick action was not executed'
    );

    expect(mocks.compile).toHaveBeenCalledWith({
      projectId: 'project-1',
      intent: 'Start this project and verify the local URL.',
      runtimeId: 'codex',
    });
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
      label: 'Start project',
      command: 'pnpm run dev',
      kind: 'shell',
      sourceIntent: 'Start this project and verify the local URL.',
    });
    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project: mocks.mountedProject,
      action: savedAction,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('turns the primary action into recompile when the operation changes', async () => {
    await renderModal();

    await act(async () => setTextareaValue(intentTextarea(), 'Start this project.'));
    const generate = primaryButton();
    if (!generate) throw new Error('quick-action primary button was not rendered');
    await act(async () => generate.click());
    await waitFor(
      () => primaryButton()?.textContent?.includes('sidebar.captureAutomation.saveAndRun') === true,
      'save-and-run action was not shown after compilation'
    );

    await act(async () => setTextareaValue(intentTextarea(), 'Start and verify this project.'));

    const recompile = primaryButton();
    expect(recompile?.disabled).toBe(false);
    expect(recompile?.textContent).toContain('sidebar.captureAutomation.regenerateCommand');
    expect(host.textContent).toContain('sidebar.captureAutomation.commandNeedsRefresh');
    expect(
      host.querySelector<HTMLElement>(
        '[aria-label="sidebar.captureAutomation.workflowLabel"] [aria-current="step"]'
      )?.textContent
    ).toContain('sidebar.captureAutomation.stepReviewCommand');

    await act(async () => recompile?.click());
    await waitFor(
      () => mocks.compile.mock.calls.length === 2,
      'changed operation was not compiled again'
    );
    expect(mocks.compile).toHaveBeenLastCalledWith({
      projectId: 'project-1',
      intent: 'Start and verify this project.',
      runtimeId: 'codex',
    });
    expect(primaryButton()?.textContent).toContain('sidebar.captureAutomation.saveAndRun');
  });

  it('does not execute or navigate when saving the quick action fails', async () => {
    mocks.save.mockResolvedValue({ success: false });
    await renderModal();

    await enterIntentCompileAndSubmit('Start this project.');
    await waitFor(() => mocks.save.mock.calls.length === 1, 'quick action was not saved');
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.runProjectQuickAction).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(host.textContent).toContain('projects.settings.saveFailed');
  });
});
