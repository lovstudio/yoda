import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/tasks';
import type { TaskStore } from '@renderer/features/tasks/stores/task';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  interruptConversation: vi.fn(async () => {}),
  interruptTaskSessions: vi.fn(),
  navigate: vi.fn(),
  openTaskTarget: vi.fn(),
  summary: {
    primaryStatus: 'error' as const,
    totalCount: 2,
    attentionCount: 1,
    workingCount: 1,
    sessions: [
      {
        conversationId: 'error-session',
        status: 'error' as const,
        title: 'Review changes',
      },
      {
        conversationId: 'working-session',
        status: 'working' as const,
        title: 'Implement fix',
      },
    ],
  },
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${Object.values(values).join(':')}` : key,
  }),
}));

vi.mock('@renderer/app/open-task-target', () => ({
  openTaskTarget: mocks.openTaskTarget,
}));

vi.mock('@renderer/features/tasks/components/agent-status-indicator', () => ({
  AgentStatusIndicator: ({ status }: { status: string }) =>
    createElement('span', { 'data-agent-status': status }, status),
}));

vi.mock('@renderer/features/tasks/interrupt-task-sessions', () => ({
  interruptTaskSessions: mocks.interruptTaskSessions,
}));

vi.mock('@renderer/features/tasks/stores/task', () => ({
  registeredTaskData: (task: { data: Task }) => task.data,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  taskSessionStatusSummary: () => mocks.summary,
}));

vi.mock('@renderer/lib/components/agent-logo', () => ({
  default: () => createElement('span', null, 'logo'),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
  rpc: { conversations: { interruptConversation: mocks.interruptConversation } },
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@renderer/lib/ui/relative-time', () => ({
  RelativeTime: () => createElement('span', null, 'time'),
}));

describe('TaskSessionStatusControl', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-slot="popover-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('shows the aggregate count and opens an exact session from the manager', async () => {
    const { TaskSessionStatusControl } = await import(
      '@renderer/features/tasks/components/task-session-status-control'
    );
    const task = { data: makeTask() } as unknown as TaskStore;
    await act(async () => root.render(createElement(TaskSessionStatusControl, { task })));

    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.sessionStatus.manage:2"]'
    );
    expect(trigger?.textContent).toContain('2');

    await act(async () => trigger?.click());

    const openSession = document.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.sessionStatus.openSession:Review changes"]'
    );
    expect(openSession).not.toBeNull();
    expect(document.body.textContent).toContain('Implement fix');

    await act(async () => openSession?.click());

    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'error-session',
      },
      mocks.navigate
    );
  });

  it('interrupts one working session without affecting the others', async () => {
    const { TaskSessionStatusControl } = await import(
      '@renderer/features/tasks/components/task-session-status-control'
    );
    const task = { data: makeTask() } as unknown as TaskStore;
    await act(async () => root.render(createElement(TaskSessionStatusControl, { task })));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click()
    );

    const interrupt = document.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.sessionStatus.interruptSession:Implement fix"]'
    );
    await act(async () => interrupt?.click());

    expect(mocks.interruptConversation).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'working-session'
    );
    expect(mocks.interruptTaskSessions).not.toHaveBeenCalled();
  });
});

function makeTask(): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task',
    status: 'in_progress',
    sourceBranch: undefined,
    createdAt: '2026-07-19T10:00:00.000Z',
    updatedAt: '2026-07-19T10:00:00.000Z',
    statusChangedAt: '2026-07-19T10:00:00.000Z',
    isPinned: false,
    needsReview: false,
    isUserNamed: false,
    setupStatus: 'ready',
    prs: [],
    conversations: {},
  };
}
