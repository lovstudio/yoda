import {
  act,
  createElement,
  forwardRef,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockTask = {
  data: {
    id: string;
    name: string;
    archivedAt?: string;
    parentTaskId?: string;
  };
  setParentTask: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  const parent = {
    data: { id: 'parent-task', name: 'Parent task' },
    setParentTask: vi.fn(),
  };
  const existing = {
    data: { id: 'existing-task', name: 'Existing task' },
    setParentTask: vi.fn(),
  };
  const existingChild = {
    data: { id: 'existing-child', name: 'Already a child', parentTaskId: 'parent-task' },
    setParentTask: vi.fn(),
  };
  const archived = {
    data: { id: 'archived-task', name: 'Archived task', archivedAt: '2026-07-22' },
    setParentTask: vi.fn(),
  };
  const ancestor = {
    data: { id: 'ancestor-task', name: 'Ancestor task' },
    setParentTask: vi.fn(),
  };
  const createTask = vi.fn();
  const navigate = vi.fn();
  const setRuntimeOverride = vi.fn();
  const taskManager = {
    tasks: new Map([
      [parent.data.id, parent],
      [existing.data.id, existing],
      [existingChild.data.id, existingChild],
      [archived.data.id, archived],
      [ancestor.data.id, ancestor],
    ]),
    createTask,
  };

  return {
    parent,
    existing,
    existingChild,
    archived,
    ancestor,
    createTask,
    navigate,
    setRuntimeOverride,
    taskManager,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectStore: () => ({ data: { id: 'project-1' } }),
  getRepositoryStore: () => ({
    defaultBranch: { type: 'local' as const, branch: 'main' },
  }),
  mountedProjectData: () => ({
    type: 'local' as const,
    id: 'project-1',
    path: '/repo',
  }),
}));

vi.mock('@renderer/features/tasks/conversations/conversation-title-utils', () => ({
  initialConversationTitle: (runtime: string, prompt: string | undefined) =>
    `${runtime}:${prompt ?? ''}`,
}));

vi.mock('@renderer/features/tasks/conversations/use-effective-runtime', () => ({
  useEffectiveRuntime: () => ({
    runtimeId: 'claude' as const,
    setRuntimeOverride: mocks.setRuntimeOverride,
    createDisabled: false,
  }),
}));

vi.mock('@renderer/features/tasks/stores/task', () => ({
  registeredTaskData: (store: MockTask) => store.data,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskManagerStore: () => mocks.taskManager,
  isTaskDescendantOf: (_projectId: string, _candidateId: string, ancestorId: string) =>
    ancestorId === 'ancestor-task',
}));

vi.mock('@renderer/lib/components/agent-selector/agent-selector', () => ({
  AgentSelector: () => createElement('div', { 'data-agent-selector': 'true' }),
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@renderer/app/composer-prompt-input', () => ({
  ComposerPromptInput: ({
    value,
    onChange,
    placeholder,
    disabled,
    autoFocus,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
  }) =>
    createElement('textarea', {
      'data-yoda-surface': 'composer',
      value,
      placeholder,
      disabled,
      autoFocus,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value),
    }),
}));

vi.mock('@renderer/lib/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement('button', props, children),
}));

vi.mock('@renderer/lib/ui/confirm-button', () => ({
  ConfirmButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement('button', props, children),
}));

vi.mock('@renderer/lib/ui/dialog', () => {
  const element = (tag: 'div' | 'h2', slot: string) =>
    function MockDialogElement({ children }: { children?: ReactNode }) {
      return createElement(tag, { 'data-slot': slot }, children);
    };

  return {
    DialogContentArea: element('div', 'dialog-content-area'),
    DialogFooter: element('div', 'dialog-footer'),
    DialogHeader: element('div', 'dialog-header'),
    DialogTitle: element('h2', 'dialog-title'),
  };
});

vi.mock('@renderer/lib/ui/field', () => ({
  Field: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  FieldGroup: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  FieldLabel: ({ children }: { children?: ReactNode }) => createElement('label', null, children),
}));

vi.mock('@renderer/lib/ui/input', () => ({
  Input: forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) =>
    createElement('input', { ...props, ref })
  ),
}));

function setTextareaValue(input: HTMLTextAreaElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setValue?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function findButton(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

describe('NewSubtaskModal', () => {
  let host: HTMLDivElement;
  let root: Root;
  let onSuccess: (result: void) => void;
  let onClose: () => void;

  beforeEach(() => {
    mocks.createTask.mockReset().mockResolvedValue(undefined);
    mocks.navigate.mockReset();
    mocks.setRuntimeOverride.mockReset();
    for (const task of mocks.taskManager.tasks.values()) {
      task.setParentTask.mockReset().mockResolvedValue({ success: true });
    }
    onSuccess = vi.fn((_result: void) => {});
    onClose = vi.fn(() => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function renderModal(): Promise<void> {
    const { NewSubtaskModal } = await import('@renderer/app/new-subtask-modal');
    await act(async () => {
      root.render(
        createElement(NewSubtaskModal, {
          projectId: 'project-1',
          parentTaskId: 'parent-task',
          onSuccess,
          onClose,
        })
      );
    });
  }

  it('adds an existing task under the current task', async () => {
    await renderModal();

    expect(host.textContent).toContain('Existing task');
    expect(host.textContent).not.toContain('Already a child');
    expect(host.textContent).not.toContain('Archived task');
    expect(host.textContent).not.toContain('Ancestor task');

    await act(async () => findButton(host, 'Existing task').click());
    await act(async () => findButton(host, 'tasks.addSubtask.addExisting').click());

    expect(mocks.existing.setParentTask).toHaveBeenCalledWith('parent-task');
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('reuses the standard composer and creates a session-less child task', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    await renderModal();
    const input = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="tasks.addSubtask.newPlaceholder"]'
    );
    if (!input) throw new Error('New subtask composer was not rendered');

    expect(input.dataset.yodaSurface).toBe('composer');
    expect(host.querySelector('[data-agent-selector="true"]')).not.toBeNull();

    await act(async () => setTextareaValue(input, 'Fresh child\nMore detail'));
    await act(async () => findButton(host, 'tasks.addSubtask.createOnly').click());

    expect(mocks.createTask).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000001',
      projectId: 'project-1',
      name: 'Fresh child',
      sourceBranch: { type: 'local', branch: 'main' },
      strategy: { kind: 'no-worktree' },
      parentTaskId: 'parent-task',
    });
    expect(mocks.createTask.mock.calls[0]?.[0]).not.toHaveProperty('initialConversation');
    expect(mocks.existing.setParentTask).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('creates the child, starts its Agent session, and opens the new task', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003');
    await renderModal();
    const input = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="tasks.addSubtask.newPlaceholder"]'
    );
    if (!input) throw new Error('New subtask composer was not rendered');

    await act(async () => setTextareaValue(input, 'Run child\nImplement it now'));
    await act(async () => findButton(host, 'tasks.addSubtask.createAndRun').click());

    expect(mocks.createTask).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000002',
      projectId: 'project-1',
      name: 'Run child',
      sourceBranch: { type: 'local', branch: 'main' },
      strategy: { kind: 'no-worktree' },
      parentTaskId: 'parent-task',
      initialConversation: {
        id: '00000000-0000-4000-8000-000000000003',
        projectId: 'project-1',
        taskId: '00000000-0000-4000-8000-000000000002',
        runtime: 'claude',
        title: 'claude:Run child\nImplement it now',
        initialPrompt: 'Run child\nImplement it now',
        imagePaths: undefined,
      },
    });
    expect(mocks.navigate).toHaveBeenCalledWith('task', {
      projectId: 'project-1',
      taskId: '00000000-0000-4000-8000-000000000002',
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
