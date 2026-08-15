import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const flags = { redacted: false };
  return {
    flags,
    mountProject: vi.fn(),
    project: null as unknown as {
      state: 'unmounted';
      id: string;
      name: string;
      alias: null;
      data: {
        id: string;
        name: string;
        alias: null;
        path: string;
        type: 'local';
        baseRef: string;
        workspaceId: null;
        isInternal: false;
      };
      phase: 'idle';
      mountedProject: null;
      displayName: string;
      error: undefined;
      errorCode: undefined;
    },
    sidebarStore: {
      expandedProjectIds: new Set<string>(),
      collapsedTaskIds: new Set<string>(),
      taskBranchDisplay: 'compact' as const,
      redactTaskContent: false,
      isProjectPinned: () => false,
      setProjectPinned: vi.fn(),
      isProjectRedacted: () => flags.redacted,
      isProjectRedactionExempt: () => false,
      toggleProjectRedactionExempt: vi.fn(),
      holdTaskReflow: vi.fn(),
      releaseTaskReflow: vi.fn(),
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/app/open-new-task', () => ({
  openNewTask: vi.fn(),
  resolveNewTaskOpenMode: vi.fn(async () => 'modal'),
}));

vi.mock('@renderer/features/projects/stores/project', () => ({
  isUnregisteredProject: () => false,
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  asMounted: () => undefined,
  getProjectManagerStore: () => ({
    archiveProject: vi.fn(),
    deleteProject: vi.fn(),
    mountProject: mocks.mountProject,
    moveProjectPath: vi.fn(),
  }),
  getProjectSettingsStore: () => undefined,
  getProjectStore: () => mocks.project,
  getRepositoryStore: () => undefined,
  projectViewKind: () => 'idle_unmounted',
}));

vi.mock('@renderer/features/projects/project-path', () => ({
  getProjectPathForNameRename: () => undefined,
}));

vi.mock('@renderer/features/projects/project-quick-action-target', () => ({
  getRunningProjectQuickActionTarget: () => undefined,
  openProjectQuickActionTarget: vi.fn(),
}));

vi.mock('@renderer/features/projects/run-project-quick-action', () => ({
  runProjectQuickAction: vi.fn(),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: undefined }),
}));

vi.mock('@renderer/features/tasks/archive-task', () => ({
  useArchiveTask: () => ({ archiveTask: vi.fn() }),
}));

vi.mock('@renderer/lib/clipboard', () => ({
  copyYodaLink: vi.fn(),
}));

vi.mock('@renderer/features/tasks/conversations/conversation-title-utils', () => ({
  nextDefaultConversationTitle: () => 'New task',
}));

vi.mock('@renderer/features/tasks/conversations/use-effective-runtime', () => ({
  useEffectiveRuntime: () => ({ runtimeId: undefined }),
}));

vi.mock('@renderer/features/tasks/stores/task', () => ({
  isRegistered: () => false,
}));

vi.mock('@renderer/lib/components/connection-status-dot', () => ({
  ConnectionStatusDot: () => null,
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@renderer/lib/ipc', () => ({ rpc: {} }));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: vi.fn() }),
  useParams: () => ({ params: {} }),
  useWorkspaceSlots: () => ({ currentView: 'home' }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => vi.fn(),
}));

vi.mock('@renderer/lib/stores/app-state', () => {
  const sidebarStore = mocks.sidebarStore;
  return {
    appState: {
      sidePane: { pinView: vi.fn() },
      sshConnections: { connect: vi.fn(), stateFor: () => null },
      workspaces: { assignProject: vi.fn() },
    },
    sidebarStore,
  };
});

vi.mock('@renderer/lib/stores/workspace-terminal-store', () => ({
  workspaceTerminalStore: { prefetchProjectTerminals: vi.fn() },
}));

vi.mock('@renderer/lib/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipContent: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({ children, render }: { children?: ReactNode; render?: ReactNode }) =>
    render ?? children,
}));

vi.mock('@renderer/utils/logger', () => ({ log: { warn: vi.fn() } }));
vi.mock('@renderer/utils/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

vi.mock('@renderer/features/sidebar/project-menu', () => ({
  ProjectActionsMenu: ({ trigger }: { trigger: ReactNode }) => trigger,
  ProjectContextMenu: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock('@renderer/features/sidebar/sidebar-primitives', () => ({
  SidebarItemMiniButton: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('button', props, children),
  SidebarMenuButton: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('button', props, children),
  SidebarMenuRow: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('div', props, children),
}));

vi.mock('@renderer/features/sidebar/use-sidebar-hover-intent', () => ({
  useSidebarHoverIntent: () => ({ cancel: vi.fn(), runNow: vi.fn(), schedule: vi.fn() }),
}));

describe('SidebarProjectItem restored expansion', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.mountProject.mockReset();
    mocks.mountProject.mockResolvedValue(undefined);
    mocks.flags.redacted = false;
    mocks.project = {
      state: 'unmounted',
      id: 'project-1',
      name: 'Restored project',
      alias: null,
      data: {
        id: 'project-1',
        name: 'Restored project',
        alias: null,
        path: '/tmp/restored-project',
        type: 'local',
        baseRef: 'main',
        workspaceId: null,
        isInternal: false,
      },
      phase: 'idle',
      mountedProject: null,
      displayName: 'Restored project',
      error: undefined,
      errorCode: undefined,
    };
    mocks.sidebarStore.expandedProjectIds = new Set(['project-1']);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('mounts an expanded unmounted project when its row is visible', async () => {
    const { SidebarProjectItem } = await import('@renderer/features/sidebar/project-item');

    await act(async () => {
      root.render(createElement(SidebarProjectItem, { projectId: 'project-1' }));
    });

    expect(mocks.mountProject).toHaveBeenCalledWith('project-1');
  });

  // A blurred project row still has to be identifiable, otherwise the privacy
  // allowlist becomes unreachable the moment privacy mode is on.
  it('clears a redacted project name on row hover', async () => {
    mocks.flags.redacted = true;
    const { SidebarProjectItem } = await import('@renderer/features/sidebar/project-item');

    await act(async () => {
      root.render(createElement(SidebarProjectItem, { projectId: 'project-1' }));
    });

    const name = host.querySelector('[data-sidebar-project-content="name"]');
    expect(name?.classList.contains('blur-[2px]')).toBe(true);
    expect(name?.classList.contains('group-hover/row:blur-none')).toBe(true);
  });
});
