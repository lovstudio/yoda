import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppResourceSnapshot, WorktreeStorageSnapshot } from '@shared/app-resource';
import type { WorkspaceResourceHistoryPoint } from '@renderer/app/workspace-resource-history';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(async () => undefined),
  showConfirm: vi.fn(),
  invalidateQueries: vi.fn(async () => undefined),
  navigate: vi.fn(),
  openTaskTarget: vi.fn(),
  onClose: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { initialData?: unknown }) => ({
    data: options.initialData,
    isFetching: false,
    refetch: mocks.refetch,
  }),
  useQueryClient: () => ({
    getQueryData: vi.fn(),
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock('@renderer/lib/components/file-path-actions', () => ({
  FilePathActionsDropdown: ({ target }: { target: { absolutePath: string } }) =>
    createElement('button', {
      type: 'button',
      'data-file-path': target.absolutePath,
    }),
}));

vi.mock('@renderer/app/open-task-target', () => ({
  openTaskTarget: mocks.openTaskTarget,
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({
    toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: { getResourceSnapshot: vi.fn() },
    projects: {
      getWorktreeStorageSnapshot: vi.fn(),
      cleanupUnusedWorktrees: vi.fn(),
    },
  },
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showConfirm,
}));

vi.mock('@renderer/lib/ui/badge', () => ({
  Badge: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
}));

vi.mock('@renderer/lib/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement('button', props, children),
}));

vi.mock('@renderer/lib/ui/dialog', () => {
  const element = (tag: 'div' | 'h2' | 'p', slot: string) =>
    function MockDialogElement({
      children,
      ...props
    }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
      return createElement(tag, { ...props, 'data-slot': slot }, children);
    };

  return {
    DialogContentArea: element('div', 'dialog-content-area'),
    DialogDescription: element('p', 'dialog-description'),
    DialogHeader: element('div', 'dialog-header'),
    DialogTitle: element('h2', 'dialog-title'),
  };
});

const snapshot: AppResourceSnapshot = {
  sampledAt: '2026-07-30T10:00:00.000Z',
  cpuPercent: 24,
  memoryBytes: 3_200_000_000,
  processes: [
    {
      pid: 101,
      type: 'Browser',
      cpuPercent: 8,
      memoryBytes: 900_000_000,
    },
  ],
  agentSessions: [
    {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      runtimeId: 'codex',
      title: 'Build resource details',
      taskTitle: 'Resource center',
      status: 'working',
      pid: 202,
      cpuPercent: 16,
      memoryBytes: 2_300_000_000,
      outputBytesPerSecond: 0,
      lastActivityAt: null,
      ringBufferBytes: 0,
      ringBufferCapBytes: 0,
      rendererConsumers: 1,
      lifecycle: 'hot',
      tmuxBacked: true,
    },
  ],
  mainEventLoop: { p50Ms: 1, p95Ms: 3, p99Ms: 5, maxMs: 7 },
  rendererPerformance: {
    sampledAt: '2026-07-30T10:00:00.000Z',
    inputLatency: { p50Ms: 4, p95Ms: 10, p99Ms: 14, maxMs: 20 },
    eventLoop: { p50Ms: 2, p95Ms: 6, p99Ms: 9, maxMs: 12 },
    longTaskCount: 2,
  },
};

const history: WorkspaceResourceHistoryPoint[] = [
  {
    sampledAt: '2026-07-30T09:59:55.000Z',
    cpuPercent: 20,
    memoryBytes: 3_100_000_000,
    inputLatencyP95Ms: 8,
    rendererLatencyP95Ms: 5,
    mainLatencyP95Ms: 2,
  },
  {
    sampledAt: snapshot.sampledAt,
    cpuPercent: snapshot.cpuPercent,
    memoryBytes: snapshot.memoryBytes,
    inputLatencyP95Ms: 10,
    rendererLatencyP95Ms: 6,
    mainLatencyP95Ms: 3,
  },
];

const storage: WorktreeStorageSnapshot = {
  sampledAt: snapshot.sampledAt,
  totalBytes: 12_000_000_000,
  reclaimableBytes: 2_000_000_000,
  worktreeCount: 2,
  reclaimableCount: 1,
  items: [
    {
      projectId: 'project-1',
      projectName: 'Yoda',
      path: '/tmp/yoda-worktree',
      branch: 'feature/resources',
      activeTaskId: 'task-1',
      activeTaskName: 'Resource center',
      sizeBytes: 8_000_000_000,
      dirty: false,
      referencedByActiveTask: true,
      reclaimable: false,
    },
  ],
};

describe('WorkspaceResourceDetailsModal', () => {
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
    host.remove();
  });

  async function renderModal(kind: 'cpu' | 'memory' | 'latency' | 'worktrees') {
    const { WorkspaceResourceDetailsModal } = await import(
      '@renderer/app/workspace-resource-details-modal'
    );
    await act(async () => {
      root.render(
        createElement(WorkspaceResourceDetailsModal, {
          kind,
          initialSnapshot: snapshot,
          initialHistory: history,
          initialWorktreeStorage: storage,
          onSuccess: vi.fn(),
          onClose: mocks.onClose,
        })
      );
    });
  }

  it('shows CPU and memory detail dialogs with process and Agent breakdowns', async () => {
    await renderModal('cpu');

    expect(host.textContent).toContain('workspaceRuntime.resources.details.cpuTitle');
    expect(host.textContent).toContain('Build resource details');
    expect(host.querySelector('[data-resource-detail-trend="cpu"]')).not.toBeNull();

    await renderModal('memory');

    expect(host.textContent).toContain('workspaceRuntime.resources.details.memoryTitle');
    expect(host.querySelector('[data-resource-detail-trend="memory"]')).not.toBeNull();
  });

  it('shows separate input, renderer, and main-process latency distributions', async () => {
    await renderModal('latency');

    expect(host.textContent).toContain('workspaceRuntime.resources.details.inputLatency');
    expect(host.textContent).toContain('workspaceRuntime.resources.details.rendererLatency');
    expect(host.textContent).toContain('workspaceRuntime.resources.details.mainLatency');
    expect(host.querySelectorAll('polyline[data-resource-detail-trend]')).toHaveLength(3);
  });

  it('shows a navigable Worktree inventory and its reclaim action', async () => {
    await renderModal('worktrees');

    expect(host.textContent).toContain('workspaceRuntime.resources.details.worktreesTitle');
    expect(host.textContent).toContain('Yoda');
    expect(host.textContent).toContain('/tmp/yoda-worktree');
    expect(host.querySelector('[data-file-path="/tmp/yoda-worktree"]')).not.toBeNull();
    expect(host.textContent).toContain('workspaceRuntime.resources.cleanup');

    const taskButton = host.querySelector<HTMLButtonElement>('[data-worktree-task-id="task-1"]');
    expect(taskButton?.textContent).toContain('Yoda');
    expect(taskButton?.textContent).toContain('/tmp/yoda-worktree');
    expect(taskButton?.textContent).toContain('Resource center');
    await act(async () => taskButton?.click());

    expect(mocks.onClose).toHaveBeenCalledOnce();
    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1' },
      mocks.navigate
    );
  });
});
