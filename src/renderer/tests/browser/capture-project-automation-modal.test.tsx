import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChildrenProps = { children?: ReactNode };

const mocks = vi.hoisted(() => {
  const pageLoad = vi.fn();
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
  const runtime: { runtimeId: 'codex' | null; createDisabled: boolean } = {
    runtimeId: 'codex',
    createDisabled: false,
  };

  return {
    pageLoad,
    save,
    compile,
    runProjectQuickAction,
    translate,
    mountedProject,
    projectStore: { mountedProject },
    settingsStore,
    runtime,
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
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: undefined }),
}));

vi.mock('@renderer/features/tasks/conversations/use-effective-runtime', () => ({
  useEffectiveRuntime: () => mocks.runtime,
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
    mocks.pageLoad.mockReset().mockResolvedValue(undefined);
    mocks.save.mockReset();
    mocks.compile.mockReset().mockResolvedValue({
      label: 'Start project',
      command: 'pnpm run dev',
      explanation: 'package.json defines the dev script',
    });
    mocks.runProjectQuickAction.mockReset().mockResolvedValue({ kind: 'shell' });
    mocks.runtime.runtimeId = 'codex';
    mocks.runtime.createDisabled = false;
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

  function buttonWithText(text: string): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
      item.textContent?.includes(text)
    );
    if (!button) throw new Error(`button was not rendered: ${text}`);
    return button;
  }

  function intentTextarea(): HTMLTextAreaElement {
    const textarea = host.querySelector<HTMLTextAreaElement>('#quick-action-intent');
    if (!textarea) throw new Error('natural-language operation input was not rendered');
    return textarea;
  }

  function commandTextarea(): HTMLTextAreaElement {
    const textarea = host.querySelector<HTMLTextAreaElement>('#quick-action-command');
    if (!textarea) throw new Error('command input was not rendered');
    return textarea;
  }

  async function generateCommand(intent: string): Promise<void> {
    await act(async () => setTextareaValue(intentTextarea(), intent));
    const generate = primaryButton();
    expect(generate?.disabled).toBe(false);
    expect(generate?.textContent).toContain('sidebar.captureAutomation.generateCommand');
    await act(async () => generate?.click());
    await waitFor(
      () => commandTextarea().value === 'pnpm run dev',
      'compiled command was not rendered'
    );
  }

  it('compiles natural language once, then saves and runs the resulting shell command', async () => {
    mocks.save.mockResolvedValue({ success: true });
    await renderModal();

    await generateCommand('Start this project and verify the local URL.');

    expect(mocks.compile).toHaveBeenCalledWith({
      projectId: 'project-1',
      intent: 'Start this project and verify the local URL.',
      runtimeId: 'codex',
    });
    expect(host.textContent).toContain('sidebar.captureAutomation.generatedCommandDescription');
    expect(primaryButton()?.textContent).toContain('sidebar.captureAutomation.saveAndRun');

    await act(async () => primaryButton()?.click());
    await waitFor(
      () => mocks.runProjectQuickAction.mock.calls.length === 1,
      'saved quick action was not executed'
    );

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

  it('accepts a direct command without calling an Agent, even when no runtime is available', async () => {
    mocks.runtime.runtimeId = null;
    mocks.runtime.createDisabled = true;
    mocks.save.mockResolvedValue({ success: true });
    await renderModal();

    await act(async () => buttonWithText('sidebar.captureAutomation.commandMode').click());
    await act(async () => setTextareaValue(commandTextarea(), 'pnpm run preview'));

    expect(primaryButton()?.disabled).toBe(false);
    expect(primaryButton()?.textContent).toContain('sidebar.captureAutomation.saveAndRun');
    await act(async () => primaryButton()?.click());
    await waitFor(
      () => mocks.runProjectQuickAction.mock.calls.length === 1,
      'direct command quick action was not executed'
    );

    expect(mocks.compile).not.toHaveBeenCalled();
    const savedSettings = mocks.save.mock.calls[0]?.[0] as {
      quickActions: Array<Record<string, unknown>>;
    };
    const savedAction = savedSettings.quickActions[1];
    expect(savedAction).toMatchObject({
      label: 'start-project',
      command: 'pnpm run preview',
      kind: 'shell',
    });
    expect(savedAction).not.toHaveProperty('sourceIntent');
    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project: mocks.mountedProject,
      action: savedAction,
    });
  });

  it('requires regeneration when the natural-language description changes', async () => {
    await renderModal();
    await generateCommand('Start this project.');

    await act(async () =>
      setTextareaValue(intentTextarea(), 'Start this project and open the preview.')
    );

    expect(primaryButton()?.disabled).toBe(false);
    expect(primaryButton()?.textContent).toContain('sidebar.captureAutomation.regenerateCommand');
    expect(host.textContent).toContain('sidebar.captureAutomation.commandNeedsRefresh');

    await act(async () => primaryButton()?.click());
    await waitFor(() => mocks.compile.mock.calls.length === 2, 'command was not regenerated');
    expect(mocks.compile).toHaveBeenLastCalledWith({
      projectId: 'project-1',
      intent: 'Start this project and open the preview.',
      runtimeId: 'codex',
    });
  });

  it('does not execute when saving the command fails', async () => {
    mocks.save.mockResolvedValue({ success: false });
    await renderModal();

    await act(async () => buttonWithText('sidebar.captureAutomation.commandMode').click());
    await act(async () => setTextareaValue(commandTextarea(), 'pnpm run dev'));
    await act(async () => primaryButton()?.click());
    await waitFor(() => mocks.save.mock.calls.length === 1, 'quick action was not saved');

    expect(mocks.runProjectQuickAction).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(host.textContent).toContain('projects.settings.saveFailed');
  });
});
