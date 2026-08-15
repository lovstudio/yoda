import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { buildProjectDeepLink } from '@shared/deep-links';
import { ensureUniqueTaskSlug } from '@shared/task-name';
import { openNewTask, resolveNewTaskOpenMode } from '@renderer/app/open-new-task';
import { openProjectArchivedTasks } from '@renderer/features/projects/open-project-archived-tasks';
import { getProjectPathForNameRename } from '@renderer/features/projects/project-path';
import {
  asMounted,
  getProjectManagerStore,
  getProjectSettingsStore,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useProjectQuickActions } from '@renderer/features/projects/use-project-quick-actions';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useArchiveTask } from '@renderer/features/tasks/archive-task';
import { nextDefaultConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { isRegistered } from '@renderer/features/tasks/stores/task';
import { copyYodaLink } from '@renderer/lib/clipboard';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';
import type { ProjectMenuActions } from './project-menu';
import { useSidebarHoverIntent } from './use-sidebar-hover-intent';

export interface ProjectMenuBundle {
  /** Everything the project menu can do, identical on every surface that shows it. */
  actions: ProjectMenuActions;
  /** The row's `+` shortcut: honors the persisted open mode and the express switch. */
  addTask: () => Promise<void>;
  /** Hover-intent handle for the row that owns the menu (also fires on menu open). */
  prefetch: ReturnType<typeof useSidebarHoverIntent>;
  /** Load repository data for the project (used by the active-row effect). */
  prefetchRepository: () => void;
}

/**
 * The project entity's menu wiring, shared by the sidebar project row and the
 * nested 「项目」 submenu inside a task's menu. Returns null when the project id
 * is unknown, so callers can bail out together with their row.
 *
 * Reads MobX state — call it from an `observer` component.
 */
export function useProjectMenuActions(projectId: string): ProjectMenuBundle | null {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params: projectParams } = useParams('project');
  const { params: taskParams } = useParams('task');
  const showChangeConnectionModal = useShowModal('changeProjectConnectionModal');
  const showRenameProject = useShowModal('renameProjectModal');
  const showMoveProjectPath = useShowModal('moveProjectPathModal');
  const showConfirmRemoveProject = useShowModal('confirmActionModal');
  const showConfirmRenamePath = useShowModal('confirmActionModal');

  const project = getProjectStore(projectId);
  const mountedProject = asMounted(project);
  const settingsStore = getProjectSettingsStore(projectId);
  const { archiveTask } = useArchiveTask(projectId);
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const expressMode = homeDraft?.expressMode ?? false;
  const expressConnectionId =
    mountedProject?.data?.type === 'ssh' ? mountedProject.data.connectionId : undefined;
  const { runtimeId: expressProviderId } = useEffectiveRuntime(expressConnectionId);
  const projectQuickActions = useProjectQuickActions(projectId);

  const prefetchRepository = useCallback(() => {
    const repo = getRepositoryStore(projectId);
    void repo?.localData.load();
    void repo?.remoteData.load();
  }, [projectId]);

  const prefetchProjectMenuData = useCallback(() => {
    prefetchRepository();
    void settingsStore?.pageData.load();
    const mounted = asMounted(getProjectStore(projectId));
    if (mounted) {
      void workspaceTerminalStore.prefetchProjectTerminals(mounted.data).catch(() => {});
    }
  }, [prefetchRepository, projectId, settingsStore]);
  const prefetch = useSidebarHoverIntent(prefetchProjectMenuData);

  const handleOpenDetails = useCallback(() => {
    prefetchRepository();
    getProjectManagerStore()
      .mountProject(projectId)
      .catch(() => {});
    navigate('project', { projectId });
  }, [navigate, prefetchRepository, projectId]);

  const handleOpenArchivedTasks = useCallback(async () => {
    prefetchRepository();
    await openProjectArchivedTasks(projectId, navigate);
  }, [navigate, prefetchRepository, projectId]);

  const openTaskComposer = useCallback(async () => {
    const openMode = await resolveNewTaskOpenMode();
    void getProjectManagerStore()
      .mountProject(projectId)
      .catch(() => {});
    openNewTask(openMode, projectId);
  }, [projectId]);

  const createTaskAndRun = useCallback(async () => {
    const mounted = asMounted(getProjectStore(projectId));
    const repo = getRepositoryStore(projectId);
    const defaultBranch = repo?.defaultBranch;
    const isUnborn = repo?.isUnborn ?? false;
    if (!mounted || !expressProviderId || !defaultBranch) {
      await openTaskComposer();
      return;
    }
    const strategyKind = homeDraft?.strategyKind ?? 'new-branch';
    const effectiveStrategyKind = isUnborn ? 'no-worktree' : strategyKind;
    const taskId = crypto.randomUUID();
    const baseName = await rpc.tasks.generateTaskName({});
    const existingNames = Array.from(mounted.taskManager.tasks.values(), (task) => task.data.name);
    const taskName = ensureUniqueTaskSlug(baseName, existingNames);
    const strategy =
      effectiveStrategyKind === 'no-worktree'
        ? ({ kind: 'no-worktree' } as const)
        : ({ kind: 'new-branch', taskBranch: taskName, pushBranch: false } as const);
    void mounted.taskManager.createTask({
      id: taskId,
      projectId: mounted.data.id,
      name: taskName,
      sourceBranch: defaultBranch,
      strategy,
      initialConversation: {
        id: crypto.randomUUID(),
        projectId: mounted.data.id,
        taskId,
        runtime: expressProviderId,
        title: nextDefaultConversationTitle(expressProviderId, []),
      },
    });
    navigate('task', { projectId: mounted.data.id, taskId });
  }, [expressProviderId, homeDraft?.strategyKind, navigate, openTaskComposer, projectId]);

  const addTask = useCallback(async () => {
    const openMode = await resolveNewTaskOpenMode();
    // The row shortcut keeps honoring the persisted preference. Explicit menu
    // actions bypass this switch because the user has already chosen an intent.
    if (openMode === 'modal' || !expressMode) {
      void getProjectManagerStore()
        .mountProject(projectId)
        .catch(() => {});
      openNewTask(openMode, projectId);
      return;
    }
    await createTaskAndRun();
  }, [createTaskAndRun, expressMode, projectId]);

  const handleRename = useCallback(() => {
    const currentProject = getProjectStore(projectId);
    if (!currentProject?.data || currentProject.state === 'unregistered') return;

    const currentName = currentProject.displayName;
    const currentPath = currentProject.data.path;
    showRenameProject({
      projectId,
      onSuccess: ({ alias }) => {
        if (!alias) return;
        const nextPath = getProjectPathForNameRename(currentName, currentPath, alias);
        if (!nextPath) return;

        showConfirmRenamePath({
          title: t('sidebar.renameProject.pathRenameTitle'),
          description: t('sidebar.renameProject.pathRenameDescription', {
            name: alias,
          }),
          confirmLabel: t('sidebar.renameProject.pathRenameConfirm'),
          variant: 'default',
          onSuccess: () => {
            void getProjectManagerStore()
              .moveProjectPath(projectId, { name: alias, path: nextPath })
              .catch((error: unknown) => {
                toast({
                  title: t('sidebar.moveProjectPath.failed'),
                  description: error instanceof Error ? error.message : String(error),
                  variant: 'destructive',
                });
              });
          },
        });
      },
    });
  }, [projectId, showConfirmRenamePath, showRenameProject, t]);

  if (!project) return null;

  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : null;
  const activeTaskCount = mountedProject
    ? Array.from(mountedProject.taskManager.tasks.values()).filter(
        (task) => isRegistered(task) && !task.data.archivedAt
      ).length
    : 0;
  const sshConnectionId = project.data?.type === 'ssh' ? project.data.connectionId : null;
  const sshConnectionState = sshConnectionId
    ? appState.sshConnections.stateFor(sshConnectionId)
    : null;
  const projectPath =
    project.data?.path ?? (project.errorCode === 'path-not-found' ? project.error : undefined);

  const handleArchiveProjectTasks = () => {
    if (!mountedProject || activeTaskCount === 0) return;
    void (async () => {
      const taskIds = Array.from(mountedProject.taskManager.tasks.values()).flatMap((task) =>
        isRegistered(task) && !task.data.archivedAt ? [task.data.id] : []
      );
      await Promise.all(taskIds.map((taskId) => archiveTask(taskId, { suppressUndoToast: true })));
      if (currentView === 'task' && taskParams.projectId === projectId) {
        navigate('project', { projectId });
      }
    })();
  };

  const handleArchiveProject = () => {
    if (project.state === 'unregistered') return;
    void getProjectManagerStore().archiveProject(projectId);
    if (currentProjectId === projectId) navigate('home');
  };

  const handleRemoveProject = () => {
    if (project.state === 'unregistered') return;
    const displayName = project.displayName;
    showConfirmRemoveProject({
      title: t('projects.deleteProjectTitle'),
      description: t('projects.deleteProjectDescription', { name: displayName }),
      confirmLabel: t('projects.removeProject'),
      onSuccess: () => {
        void getProjectManagerStore().deleteProject(projectId);
        if (currentProjectId === projectId) navigate('home');
      },
    });
  };

  const actions: ProjectMenuActions = {
    isPinned: sidebarStore.isProjectPinned(projectId),
    canPin: project.state !== 'unregistered',
    isSsh: sshConnectionId !== null,
    canReconnect: sshConnectionState !== 'connected',
    projectPath,
    sshConnectionId,
    onCopyYodaLink:
      project.state === 'unregistered'
        ? undefined
        : () => void copyYodaLink(buildProjectDeepLink({ projectId }), t),
    onOpenDetails: handleOpenDetails,
    onCreateTask: project.state === 'unregistered' ? undefined : () => void openTaskComposer(),
    onCreateTaskAndRun:
      project.state === 'unregistered' ? undefined : () => void createTaskAndRun(),
    onOpenArchivedTasks:
      project.state === 'unregistered' ? undefined : () => void handleOpenArchivedTasks(),
    onPin: () => sidebarStore.setProjectPinned(projectId, true),
    onUnpin: () => sidebarStore.setProjectPinned(projectId, false),
    // Offered whether or not privacy mode is on: the allowlist has to be built
    // while project names are still legible, and turning privacy mode on is
    // exactly what takes that away. Membership is simply inert until then.
    redaction: {
      exempt: sidebarStore.isProjectRedactionExempt(projectId),
      onToggle: () => sidebarStore.toggleProjectRedactionExempt(projectId),
    },
    onReconnect: sshConnectionId
      ? () => {
          void appState.sshConnections.connect(sshConnectionId).catch(() => {});
        }
      : undefined,
    onChangeSshConnection: sshConnectionId
      ? () => {
          showChangeConnectionModal({
            projectId,
            currentConnectionId: sshConnectionId,
          });
        }
      : undefined,
    ...projectQuickActions,
    onMenuOpen: prefetch.runNow,
    onRename: project.state === 'unregistered' ? undefined : handleRename,
    onMovePath:
      project.state === 'unregistered' ? undefined : () => showMoveProjectPath({ projectId }),
    canArchiveProject: project.state !== 'unregistered',
    canArchiveProjectTasks: Boolean(mountedProject && activeTaskCount > 0),
    canRemoveProject: project.state !== 'unregistered',
    onArchiveProject: handleArchiveProject,
    onArchiveProjectTasks: handleArchiveProjectTasks,
    onRemoveProject: handleRemoveProject,
    currentWorkspaceId: project.data?.workspaceId ?? null,
    onAssignWorkspace:
      project.state === 'unregistered'
        ? undefined
        : (workspaceId: string | null) => {
            project.setWorkspaceId(workspaceId);
            void appState.workspaces.assignProject(projectId, workspaceId);
          },
  };

  return { actions, addTask, prefetch, prefetchRepository };
}
