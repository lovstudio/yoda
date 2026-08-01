import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChildrenProps = { children?: ReactNode };
type MockPromptToken = {
  id: string;
  kind: 'image' | 'file';
  label: string;
  path: string;
};
type MockComposerPromptInputProps = {
  value: string;
  onChange: (value: string) => void;
  tokens: MockPromptToken[];
  onTokensChange: (tokens: MockPromptToken[]) => void;
  textareaId?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
};

const mocks = vi.hoisted(() => {
  const saveProjectQuickAction = vi.fn();
  const discover = vi.fn();
  const compile = vi.fn();
  const runProjectQuickAction = vi.fn();
  const navigate = vi.fn();
  const loadLocalBranches = vi.fn();
  const loadRemoteBranches = vi.fn();
  const toastError = vi.fn();
  const mountedProject = {
    data: {
      id: 'project-1',
      name: 'Example project',
      type: 'local' as const,
      path: '/tmp/example-project',
    },
  };
  const runtime: { runtimeId: 'codex' | null; createDisabled: boolean } = {
    runtimeId: 'codex',
    createDisabled: false,
  };

  return {
    saveProjectQuickAction,
    discover,
    compile,
    runProjectQuickAction,
    navigate,
    toastError,
    repositoryStore: {
      localData: { load: loadLocalBranches },
      remoteData: { load: loadRemoteBranches },
      defaultBranch: { type: 'local' as const, branch: 'main' },
    },
    mountedProject,
    projectStore: { mountedProject },
    settingsStore: { settings: { composerDefaults: undefined } },
    runtime,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@shared/task-name', () => ({
  taskNameFromPrompt: () => 'start-project',
}));

vi.mock('@renderer/app/composer-prompt-input', async () => {
  const { createElement: create } = await import('react');
  return {
    ComposerPromptInput: ({
      value,
      onChange,
      tokens,
      onTokensChange,
      textareaId,
      placeholder,
      disabled,
      autoFocus,
    }: MockComposerPromptInputProps) =>
      create('div', { 'data-yoda-surface': 'composer' }, [
        create('textarea', {
          key: 'input',
          id: textareaId,
          value,
          placeholder,
          disabled,
          autoFocus,
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
            onChange(event.currentTarget.value),
        }),
        create(
          'button',
          {
            key: 'attach',
            type: 'button',
            'data-testid': 'attach-reference',
            onClick: () => {
              const token: MockPromptToken = {
                id: 'reference-1',
                kind: 'file',
                label: 'release.md',
                path: '/tmp/example-project/docs/release.md',
              };
              onTokensChange([...tokens, token]);
              onChange(
                `${value}${value ? ' ' : ''}\u2002\u2002\u2002${token.label}\u2002\u2002\u2002`
              );
            },
          },
          'attach reference'
        ),
      ]),
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
  getProjectSettingsStore: () => mocks.settingsStore,
  getProjectStore: () => mocks.projectStore,
  getRepositoryStore: () => mocks.repositoryStore,
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: undefined }),
}));

vi.mock('@renderer/features/tasks/conversations/use-effective-runtime', () => ({
  useEffectiveRuntime: () => mocks.runtime,
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
    mocks.runProjectQuickAction.mockReset().mockImplementation((args) => {
      if (args.action.kind === 'skill') {
        args.onTaskCreated?.('task-1');
        return Promise.resolve({ kind: 'skill', taskId: 'task-1' });
      }
      return Promise.resolve({ kind: 'command' });
    });
    mocks.navigate.mockReset();
    mocks.toastError.mockReset();
    mocks.repositoryStore.localData.load.mockReset().mockResolvedValue(undefined);
    mocks.repositoryStore.remoteData.load.mockReset().mockResolvedValue(undefined);
    mocks.runtime.runtimeId = 'codex';
    mocks.runtime.createDisabled = false;
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
        mocks.repositoryStore.localData.load.mock.calls.length > 0 &&
        primaryButton()?.textContent?.includes('sidebar.captureAutomation.startTask') === true,
      'quick-action modal did not become ready'
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

  it('shows natural-language and command tabs with the shared Yoda composer by default', async () => {
    await renderModal();

    expect(host.textContent).toContain('sidebar.captureAutomation.naturalMode');
    expect(host.textContent).toContain('sidebar.captureAutomation.commandMode');
    expect(host.querySelector('[data-yoda-surface="composer"]')).not.toBeNull();
    expect(mocks.compile).not.toHaveBeenCalled();
  });

  it('enters a task immediately and defers quick-action distillation until completion', async () => {
    await renderModal();
    await act(async () => setTextareaValue(textarea('quick-action-intent'), '$release-via-cicd'));
    await act(async () => primaryButton()?.click());

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('task', {
      projectId: 'project-1',
      taskId: 'task-1',
    });
    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project: mocks.mountedProject,
      action: expect.objectContaining({
        command: '$release-via-cicd',
        kind: 'skill',
      }),
      runtimeId: 'codex',
      defaultBranch: { type: 'local', branch: 'main' },
      quickActionSource: {
        prompt: '$release-via-cicd',
        invokedSkill: true,
      },
      onTaskCreated: expect.any(Function),
    });
    expect(mocks.compile).not.toHaveBeenCalled();
    expect(mocks.saveProjectQuickAction).not.toHaveBeenCalled();
  });

  it('serializes Yoda composer references into the task prompt', async () => {
    await renderModal();
    await act(async () => setTextareaValue(textarea('quick-action-intent'), 'Review'));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="attach-reference"]')?.click()
    );
    await act(async () => primaryButton()?.click());

    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          command: 'Review @/tmp/example-project/docs/release.md',
        }),
        quickActionSource: {
          prompt: 'Review @/tmp/example-project/docs/release.md',
          invokedSkill: false,
        },
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
    await act(async () => buttonWithText('sidebar.captureAutomation.commandMode').click());

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
      runtimeId: 'codex',
    });
  });

  it('runs a manually entered command without an AI runtime', async () => {
    mocks.runtime.runtimeId = null;
    mocks.runtime.createDisabled = true;
    await renderModal();
    await act(async () => buttonWithText('sidebar.captureAutomation.commandMode').click());
    await act(async () => buttonWithText('sidebar.captureAutomation.manualMode').click());
    await act(async () => setTextareaValue(textarea('quick-action-command'), 'pnpm run preview'));
    await act(async () => primaryButton()?.click());

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project: mocks.mountedProject,
      action: expect.objectContaining({ command: 'pnpm run preview', kind: 'command' }),
      runtimeId: null,
    });
    expect(mocks.compile).not.toHaveBeenCalled();
  });
});
