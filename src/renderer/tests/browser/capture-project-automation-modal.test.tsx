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
  const pageLoad = vi.fn();
  const save = vi.fn();
  const compile = vi.fn();
  const discover = vi.fn();
  const runProjectQuickAction = vi.fn();
  const navigate = vi.fn();
  const loadLocalBranches = vi.fn();
  const loadRemoteBranches = vi.fn();
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
        kind: 'command' | 'skill';
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
    discover,
    runProjectQuickAction,
    navigate,
    repositoryStore: {
      localData: { load: loadLocalBranches },
      remoteData: { load: loadRemoteBranches },
      defaultBranch: { type: 'local' as const, branch: 'main' },
    },
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
    mocks.pageLoad.mockReset().mockResolvedValue(undefined);
    mocks.save.mockReset().mockResolvedValue({ success: true });
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
    mocks.compile.mockReset().mockResolvedValue({
      kind: 'command',
      label: 'Start project',
      command: 'pnpm run dev',
      explanation: 'package.json defines the dev script',
    });
    mocks.runProjectQuickAction.mockReset().mockResolvedValue({ kind: 'command' });
    mocks.navigate.mockReset();
    mocks.repositoryStore.localData.load.mockReset().mockResolvedValue(undefined);
    mocks.repositoryStore.remoteData.load.mockReset().mockResolvedValue(undefined);
    mocks.runtime.runtimeId = 'codex';
    mocks.runtime.createDisabled = false;
    mocks.settingsStore.settings = {
      scripts: {},
      quickActions: [
        {
          id: 'existing',
          label: 'Existing action',
          command: 'Review the release and publish it.',
          kind: 'skill',
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
      () =>
        mocks.pageLoad.mock.calls.length > 0 &&
        mocks.discover.mock.calls.length > 0 &&
        host.querySelector('[data-package-script-id="package.json:dev"]') !== null,
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

  function textarea(id: string): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>(`#${id}`);
    if (!element) throw new Error(`textarea was not rendered: ${id}`);
    return element;
  }

  async function analyze(intent: string): Promise<void> {
    await act(async () => setTextareaValue(textarea('quick-action-intent'), intent));
    expect(primaryButton()?.textContent).toContain('sidebar.captureAutomation.analyze');
    await act(async () => primaryButton()?.click());
    await waitFor(
      () => host.querySelector('#quick-action-generated-content') !== null,
      'analyzed result was not rendered'
    );
  }

  it('offers every package.json script but only saves the script the user runs', async () => {
    await renderModal();

    expect(host.textContent).toContain('pnpm run dev');
    expect(host.textContent).toContain('pnpm run test');
    expect(primaryButton()?.textContent).toContain('sidebar.captureAutomation.runAndSave');
    await act(async () => primaryButton()?.click());
    await waitFor(() => mocks.save.mock.calls.length === 1, 'package script was not saved');

    const savedSettings = mocks.save.mock.calls[0]?.[0] as {
      quickActions: Array<Record<string, unknown>>;
    };
    expect(savedSettings.quickActions).toHaveLength(2);
    expect(savedSettings.quickActions[1]).toMatchObject({
      label: 'dev',
      command: 'pnpm run dev',
      kind: 'command',
    });
    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project: mocks.mountedProject,
      action: expect.objectContaining({ command: 'pnpm run dev', kind: 'command' }),
      runtimeId: 'codex',
      defaultBranch: undefined,
    });
  });

  it('classifies natural language once, then runs and saves the resulting command', async () => {
    await renderModal();
    await act(async () => buttonWithText('sidebar.captureAutomation.describeMode').click());
    expect(host.querySelector('[data-yoda-surface="composer"]')).not.toBeNull();
    await analyze('Start this project and verify the local URL.');

    expect(mocks.compile).toHaveBeenCalledWith({
      projectId: 'project-1',
      intent: 'Start this project and verify the local URL.',
      runtimeId: 'codex',
    });
    expect(host.textContent).toContain('sidebar.captureAutomation.generatedCommandDescription');

    await act(async () => primaryButton()?.click());
    await waitFor(() => mocks.save.mock.calls.length === 1, 'analyzed command was not saved');
    const savedSettings = mocks.save.mock.calls[0]?.[0] as {
      quickActions: Array<Record<string, unknown>>;
    };
    expect(savedSettings.quickActions[1]).toMatchObject({
      label: 'Start project',
      command: 'pnpm run dev',
      kind: 'command',
      sourceIntent: 'Start this project and verify the local URL.',
    });
    expect(mocks.repositoryStore.localData.load).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('serializes Yoda composer references before asking AI to analyze them', async () => {
    await renderModal();
    await act(async () => buttonWithText('sidebar.captureAutomation.describeMode').click());
    await act(async () => setTextareaValue(textarea('quick-action-intent'), 'Review'));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="attach-reference"]')?.click()
    );

    await act(async () => primaryButton()?.click());
    await waitFor(
      () => mocks.compile.mock.calls.length === 1,
      'referenced prompt was not analyzed'
    );

    expect(mocks.compile).toHaveBeenCalledWith({
      projectId: 'project-1',
      intent: 'Review @/tmp/example-project/docs/release.md',
      runtimeId: 'codex',
    });
  });

  it('keeps adaptive natural-language work as a Skill and opens its task', async () => {
    mocks.compile.mockResolvedValue({
      kind: 'skill',
      label: 'Review changes',
      instruction: 'Review recent changes and fix the highest-risk regression.',
      explanation: 'Each run requires contextual review and judgment.',
    });
    mocks.runProjectQuickAction.mockResolvedValue({ kind: 'skill', taskId: 'task-1' });
    await renderModal();
    await act(async () => buttonWithText('sidebar.captureAutomation.describeMode').click());
    await analyze('Review recent changes and fix the riskiest problem.');

    expect(host.textContent).toContain('sidebar.captureAutomation.generatedSkillDescription');
    await act(async () => primaryButton()?.click());
    await waitFor(() => mocks.navigate.mock.calls.length === 1, 'Skill task was not opened');

    expect(mocks.repositoryStore.localData.load).toHaveBeenCalledTimes(1);
    expect(mocks.repositoryStore.remoteData.load).toHaveBeenCalledTimes(1);
    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project: mocks.mountedProject,
      action: expect.objectContaining({
        command: 'Review recent changes and fix the highest-risk regression.',
        kind: 'skill',
      }),
      runtimeId: 'codex',
      defaultBranch: { type: 'local', branch: 'main' },
    });
    expect(mocks.navigate).toHaveBeenCalledWith('task', {
      projectId: 'project-1',
      taskId: 'task-1',
    });
  });

  it('runs a directly entered command without an AI runtime', async () => {
    mocks.runtime.runtimeId = null;
    mocks.runtime.createDisabled = true;
    await renderModal();
    await act(async () => buttonWithText('sidebar.captureAutomation.commandMode').click());
    await act(async () => setTextareaValue(textarea('quick-action-command'), 'pnpm run preview'));

    await act(async () => primaryButton()?.click());
    await waitFor(() => mocks.save.mock.calls.length === 1, 'direct command was not saved');
    expect(mocks.compile).not.toHaveBeenCalled();
    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project: mocks.mountedProject,
      action: expect.objectContaining({ command: 'pnpm run preview', kind: 'command' }),
      runtimeId: null,
      defaultBranch: undefined,
    });
  });

  it('requires fresh analysis after the natural-language description changes', async () => {
    await renderModal();
    await act(async () => buttonWithText('sidebar.captureAutomation.describeMode').click());
    await analyze('Start this project.');

    await act(async () =>
      setTextareaValue(textarea('quick-action-intent'), 'Start this project and open the preview.')
    );
    expect(primaryButton()?.textContent).toContain('sidebar.captureAutomation.analyzeAgain');
    expect(host.textContent).toContain('sidebar.captureAutomation.analysisNeedsRefresh');
    await act(async () => primaryButton()?.click());
    await waitFor(() => mocks.compile.mock.calls.length === 2, 'operation was not analyzed again');
  });

  it('runs before persisting so a failed execution never enters the list', async () => {
    mocks.runProjectQuickAction.mockRejectedValue(new Error('terminal unavailable'));
    await renderModal();
    await act(async () => primaryButton()?.click());
    await waitFor(
      () => host.textContent?.includes('sidebar.captureAutomation.submitFailed') === true,
      'execution failure was not shown'
    );

    expect(mocks.save).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
