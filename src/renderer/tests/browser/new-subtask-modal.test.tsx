import {
  act,
  createElement,
  forwardRef,
  type ButtonHTMLAttributes,
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
    taskManager,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getRepositoryStore: () => ({
    defaultBranch: { type: 'local' as const, branch: 'main' },
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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
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

  it('creates a session-less child task when a new name is provided', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    await renderModal();
    const input = host.querySelector<HTMLInputElement>(
      'input[placeholder="tasks.addSubtask.newPlaceholder"]'
    );
    if (!input) throw new Error('New subtask name input was not rendered');

    await act(async () => setInputValue(input, 'Fresh child'));
    await act(async () => findButton(host, 'tasks.addSubtask.createAndAdd').click());

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
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
