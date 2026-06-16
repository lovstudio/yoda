import {
  ChevronRight,
  FolderClosed,
  FolderInput,
  Loader2,
  MoreHorizontal,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildProjectDeepLink } from '@shared/deep-links';
import { ensureUniqueTaskSlug } from '@shared/task-name';
import {
  isUnregisteredProject,
  type UnregisteredProject,
} from '@renderer/features/projects/stores/project';
import {
  asMounted,
  getProjectManagerStore,
  getProjectStore,
  getRepositoryStore,
  projectViewKind,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useArchiveTask } from '@renderer/features/tasks/archive-task';
import { copyTaskLink } from '@renderer/features/tasks/components/task-context-menu';
import { nextDefaultConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { useRuntimeAutoApproveDefaults } from '@renderer/features/tasks/hooks/useRuntimeAutoApproveDefaults';
import { isRegistered } from '@renderer/features/tasks/stores/task';
import { ConnectionStatusDot } from '@renderer/lib/components/connection-status-dot';
import { rpc } from '@renderer/lib/ipc';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { ProjectActionsMenu, ProjectContextMenu } from './project-menu';
import { SidebarItemMiniButton, SidebarMenuButton, SidebarMenuRow } from './sidebar-primitives';
import { useAltKeyHeld } from './use-alt-key-held';

const UNREGISTERED_PHASE_KEY: Record<UnregisteredProject['phase'], string> = {
  'creating-repo': 'sidebar.phase.creatingRepo',
  cloning: 'sidebar.phase.cloning',
  registering: 'sidebar.phase.registering',
  error: 'sidebar.phase.error',
};

export const SidebarProjectItem = observer(function SidebarProjectItem({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params: projectParams } = useParams('project');
  const { params: taskParams } = useParams('task');
  const showChangeConnectionModal = useShowModal('changeProjectConnectionModal');
  const showManageRunScripts = useShowModal('manageRunScriptsModal');
  const showRenameProject = useShowModal('renameProjectModal');
  const showConfirmRemoveProject = useShowModal('confirmActionModal');
  const [isMenuOpen, setMenuOpen] = useState(false);
  // Alt/Option-held hover hints (and click) that the row pins into the global
  // side pane instead of expanding — same affordance as the nav controls.
  const altHeld = useAltKeyHeld();
  const [isHovered, setHovered] = useState(false);

  const project = getProjectStore(projectId);
  const mountedProject = asMounted(project);
  const { archiveTask } = useArchiveTask(projectId);

  const prefetchRepository = useCallback(() => {
    const repo = getRepositoryStore(projectId);
    void repo?.localData.load();
    void repo?.remoteData.load();
  }, [projectId]);

  const handleOpenDetails = useCallback(() => {
    prefetchRepository();
    navigate('project', { projectId });
  }, [navigate, prefetchRepository, projectId]);

  const handleToggleExpanded = useCallback(() => {
    sidebarStore.toggleProjectExpanded(projectId);
  }, [projectId]);

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      handleToggleExpanded();
    },
    [handleToggleExpanded]
  );

  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const expressMode = homeDraft?.expressMode ?? false;
  const expressConnectionId =
    mountedProject?.data?.type === 'ssh' ? mountedProject.data.connectionId : undefined;
  const { runtimeId: expressProviderId } = useEffectiveRuntime(expressConnectionId);
  const expressAutoApproveDefaults = useRuntimeAutoApproveDefaults();

  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : null;
  const currentTaskId = currentView === 'task' ? taskParams.taskId : null;

  const isProjectActive = currentProjectId === projectId && !currentTaskId;
  const activeTaskCount = mountedProject
    ? Array.from(mountedProject.taskManager.tasks.values()).filter(
        (task) => isRegistered(task) && !task.data.archivedAt
      ).length
    : 0;

  useEffect(() => {
    if (isProjectActive) prefetchRepository();
  }, [isProjectActive, prefetchRepository]);

  const isExpanded = sidebarStore.expandedProjectIds.has(projectId);

  const handleAddTask = useCallback(async () => {
    const mounted = mountedProject;
    const repo = getRepositoryStore(projectId);
    const defaultBranch = repo?.defaultBranch;
    const isUnborn = repo?.isUnborn ?? false;
    // Express mode requires a runnable runtime config. Fall back to the home
    // view whenever any prerequisite is missing so the user can fix it there.
    if (!expressMode || !mounted || !expressProviderId || !defaultBranch) {
      navigate('home', { projectId });
      return;
    }
    const strategyKind = homeDraft?.strategyKind ?? 'new-branch';
    const effectiveStrategyKind = isUnborn ? 'no-worktree' : strategyKind;
    const taskId = crypto.randomUUID();
    const baseName = await rpc.tasks.generateTaskName({});
    const existingNames = Array.from(mounted.taskManager.tasks.values(), (t) => t.data.name);
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
        autoApprove: expressAutoApproveDefaults.getDefault(expressProviderId),
      },
    });
    navigate('task', { projectId: mounted.data.id, taskId });
  }, [
    expressMode,
    expressProviderId,
    expressAutoApproveDefaults,
    homeDraft?.strategyKind,
    mountedProject,
    navigate,
    projectId,
  ]);

  if (!project) return null;

  const sshConnectionId = project.data?.type === 'ssh' ? project.data.connectionId : null;
  const isSshProject = sshConnectionId !== null;
  const sshConnectionState = sshConnectionId
    ? appState.sshConnections.stateFor(sshConnectionId)
    : null;
  const canReconnect = sshConnectionState !== 'connected';
  const canPin = project.state !== 'unregistered';
  const isPinned = sidebarStore.isProjectPinned(projectId);
  const projectPath =
    project.data?.path ?? (project.errorCode === 'path-not-found' ? project.error : undefined);
  const ProjectIcon = isSshProject ? FolderInput : FolderClosed;

  const renderSpinnerWithTooltip = () => {
    if (!isUnregisteredProject(project)) return null;
    const labelKey = UNREGISTERED_PHASE_KEY[project.phase] ?? 'sidebar.phase.loading';
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarItemMiniButton type="button" disabled aria-label={t('sidebar.loading')}>
              <Loader2 className="h-4 w-4 animate-spin text-foreground/60" />
            </SidebarItemMiniButton>
          }
        />
        <TooltipContent>{t(labelKey)}</TooltipContent>
      </Tooltip>
    );
  };

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

  const menuActions = {
    isPinned,
    canPin,
    isSsh: isSshProject,
    canReconnect,
    projectPath,
    onCopyYodaLink:
      project.state === 'unregistered'
        ? undefined
        : () => void copyTaskLink(buildProjectDeepLink({ projectId }), t),
    onOpenDetails: handleOpenDetails,
    onPin: () => sidebarStore.setProjectPinned(projectId, true),
    onUnpin: () => sidebarStore.setProjectPinned(projectId, false),
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
    onConfigureScripts:
      project.state === 'unregistered'
        ? undefined
        : () => showManageRunScripts({ projectId, projectName: project.displayName }),
    onRename: project.state === 'unregistered' ? undefined : () => showRenameProject({ projectId }),
    canArchiveProjectTasks: Boolean(mountedProject && activeTaskCount > 0),
    canRemoveProject: project.state !== 'unregistered',
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

  return (
    <ProjectContextMenu {...menuActions}>
      <Tooltip open={altHeld && isHovered}>
        <TooltipTrigger
          render={
            <SidebarMenuRow
              className={cn('group/row h-8 justify-between flex px-1')}
              data-active={isProjectActive || undefined}
              isActive={isProjectActive}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onClick={(e) => {
                // Alt/Option pins the project into the global side pane; a plain
                // click toggles its task list as usual.
                if (e.altKey) {
                  appState.sidePane.pinView('project', { projectId });
                  return;
                }
                handleToggleExpanded();
              }}
              onKeyDown={handleRowKeyDown}
            >
              <div className="flex items-center gap-1 flex-1 min-w-0">
                {project.state === 'unregistered' ? (
                  renderSpinnerWithTooltip()
                ) : (
                  <SidebarItemMiniButton
                    type="button"
                    className="relative"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleExpanded();
                    }}
                  >
                    <ProjectIcon className="absolute h-4 w-4 transition-opacity duration-150 opacity-100 group-hover/row:opacity-0" />
                    <ChevronRight
                      className={cn(
                        'absolute h-4 w-4 transition-all duration-150 opacity-0 group-hover/row:opacity-100',
                        isExpanded && 'rotate-90'
                      )}
                    />
                  </SidebarItemMiniButton>
                )}
                <span
                  className={cn(
                    'flex-1 min-w-0 self-stretch flex items-center overflow-hidden text-left transition-colors select-none',
                    projectViewKind(getProjectStore(projectId)) === 'bootstrapping' &&
                      'text-foreground-tertiary-passive'
                  )}
                >
                  {isSshProject ? (
                    <span className="min-w-0 flex items-center gap-2 overflow-hidden">
                      <span className="truncate">{project.displayName}</span>
                      <ConnectionStatusDot state={sshConnectionState} />
                    </span>
                  ) : (
                    <span className="min-w-0 flex items-center gap-1.5 overflow-hidden">
                      <span className="truncate">{project.displayName}</span>
                      {projectViewKind(project) === 'path_not_found' && (
                        <Tooltip>
                          <TooltipTrigger>
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-foreground-destructive" />
                          </TooltipTrigger>
                          <TooltipContent>{t('sidebar.projectNotFound')}</TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                <ProjectActionsMenu
                  {...menuActions}
                  open={isMenuOpen}
                  onOpenChange={setMenuOpen}
                  trigger={
                    <SidebarItemMiniButton
                      type="button"
                      className={cn(
                        'transition-opacity duration-150',
                        isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'
                      )}
                      aria-label={t('sidebar.more')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </SidebarItemMiniButton>
                  }
                />
                <SidebarItemMiniButton
                  type="button"
                  className={cn(
                    'transition-opacity duration-150',
                    isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'
                  )}
                  onPointerEnter={() => prefetchRepository()}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleAddTask();
                  }}
                  disabled={project.state === 'unregistered'}
                >
                  <Plus className="h-4 w-4" />
                </SidebarItemMiniButton>
              </div>
            </SidebarMenuRow>
          }
        />
        <TooltipContent side="right">{t('appTabs.openInGlobalSidePane')}</TooltipContent>
      </Tooltip>
    </ProjectContextMenu>
  );
});

interface BaseProjectItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive: boolean;
}

export function BaseProjectItem({ isActive, className, ...props }: BaseProjectItemProps) {
  return (
    <SidebarMenuButton
      className={cn('justify-between flex item px-1 py-1', className)}
      isActive={isActive}
      {...props}
    />
  );
}
