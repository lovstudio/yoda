import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChildrenProps = { children?: ReactNode };
type MockSubmitTarget = { kind: string; quickActionProjectId?: string };
type MockHomeComposerProps = {
  submitTarget?: MockSubmitTarget;
  onSubmitted?: (result: {
    kind: 'task';
    projectId: string;
    taskId: string;
    requirement: string;
  }) => void;
};

const mocks = vi.hoisted(() => {
  const saveProjectQuickAction = vi.fn();
  const discover = vi.fn();
  const compile = vi.fn();
  const runProjectQuickAction = vi.fn();
  const toastError = vi.fn();
  const mountedProject = {
    data: {
      id: 'project-1',
      name: 'Example project',
      type: 'local' as const,
      path: '/tmp/example-project',
    },
  };
  const composerProps: { current: MockHomeComposerProps | null } = { current: null };

  return {
    saveProjectQuickAction,
    discover,
    compile,
    runProjectQuickAction,
    toastError,
    mountedProject,
    projectStore: { mountedProject },
    composerProps,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@shared/task-name', () => ({
  taskNameFromPrompt: () => 'start-project',
}));

vi.mock('@renderer/app/home-view', async () => {
  const { createElement: create } = await import('react');
  return {
    HomeComposer: (props: MockHomeComposerProps) => {
      mocks.composerProps.current = props;
      return create(
        'button',
        {
          type: 'button',
          'data-yoda-surface': 'home-composer',
          onClick: () =>
            props.onSubmitted?.({
              kind: 'task',
              projectId: 'project-1',
              taskId: 'task-1',
              requirement: '$release-via-cicd',
            }),
        },
        'send'
      );
    },
  };
});

vi.mock('@renderer/features/projects/run-project-quick-action', () => ({
  runProjectQuickAction: mocks.runProjectQuickAction,
}));

vi.mock('@renderer/features/projects/save-project-quick-action', () => ({
  saveProjectQuickAction: mocks.saveProjectQuickAction,
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  asMounted: () => mocks.mountedProject,
  getProjectStore: () => mocks.projectStore,
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: { error: mocks.toastError },
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    quickActions: {
      compile: mocks.compile,
      discover: mocks.discover,
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
    mocks.saveProjectQuickAction.mockReset().mockResolvedValue(true);
    mocks.discover.mockReset().mockResolvedValue([
      {
        id: 'package.json:dev',
        label: 'dev',
        command: 'pnpm run dev',
        source: 'package.json',
      },
      {
        id: 'package.json:test',
        label: 'test',
        command: 'pnpm run test',
        source: 'package.json',
      },
    ]);
    mocks.compile.mockReset();
    mocks.runProjectQuickAction.mockReset().mockResolvedValue({ kind: 'command' });
    mocks.toastError.mockReset();
    mocks.composerProps.current = null;
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
      () =>
        mocks.discover.mock.calls.length > 0 &&
        host.querySelector('[data-yoda-surface="home-composer"]') !== null,
      'quick-action modal did not become ready'
    );
  }

  // Only the active tab panel is mounted, so command assertions wait for the switch.
  async function openCommandTab(): Promise<void> {
    await act(async () => buttonWithText('sidebar.captureAutomation.commandMode').click());
    await waitFor(
      () => host.querySelector('[data-package-script-id]') !== null,
      'command tab did not mount the discovered scripts'
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

  function textarea(id: string): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>(`#${id}`);
    if (!element) throw new Error(`textarea was not rendered: ${id}`);
    return element;
  }

  it('hosts the standard new-task composer, locked to the project, for natural language', async () => {
    await renderModal();

    expect(host.textContent).toContain('sidebar.captureAutomation.naturalMode');
    expect(host.textContent).toContain('sidebar.captureAutomation.commandMode');
    expect(host.querySelector('[data-yoda-surface="home-composer"]')).not.toBeNull();
    expect(mocks.composerProps.current?.submitTarget).toEqual({
      kind: 'new-task',
      quickActionProjectId: 'project-1',
    });
    // The composer owns its own send button — no duplicate primary in the footer.
    expect(primaryButton()?.textContent).toContain('common.cancel');
    expect(mocks.compile).not.toHaveBeenCalled();
  });

  it('records a composer-launched task in the quick-action list', async () => {
    await renderModal();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-yoda-surface="home-composer"]')?.click()
    );

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.runProjectQuickAction).not.toHaveBeenCalled();
    await waitFor(
      () => mocks.saveProjectQuickAction.mock.calls.length === 1,
      'natural-language quick action was not saved'
    );
    expect(mocks.saveProjectQuickAction).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        command: '$release-via-cicd',
        kind: 'skill',
        sourceIntent: '$release-via-cicd',
      })
    );
  });

  it('runs an existing script, opens Terminal immediately, then saves it in the background', async () => {
    let resolveExecution: ((value: { kind: 'command' }) => void) | undefined;
    mocks.runProjectQuickAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExecution = resolve;
        })
    );
    await renderModal();
    await openCommandTab();

    expect(host.textContent).toContain('pnpm run dev');
    await act(async () => primaryButton()?.click());
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.saveProjectQuickAction).not.toHaveBeenCalled();

    await act(async () => resolveExecution?.({ kind: 'command' }));
    await waitFor(
      () => mocks.saveProjectQuickAction.mock.calls.length === 1,
      'executed command was not saved'
    );
    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project: mocks.mountedProject,
      action: expect.objectContaining({ command: 'pnpm run dev', kind: 'command', label: 'dev' }),
    });
  });

  it('runs a manually entered command', async () => {
    await renderModal();
    await openCommandTab();
    await act(async () => buttonWithText('sidebar.captureAutomation.manualMode').click());
    await act(async () => setTextareaValue(textarea('quick-action-command'), 'pnpm run preview'));
    await act(async () => primaryButton()?.click());

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project: mocks.mountedProject,
      action: expect.objectContaining({ command: 'pnpm run preview', kind: 'command' }),
    });
    expect(mocks.compile).not.toHaveBeenCalled();
  });
});
