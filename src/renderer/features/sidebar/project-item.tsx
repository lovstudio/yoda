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
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
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
  const [isMenuOpen, setMenuOpen] = useState(false);

  const project = getProjectStore(projectId);

  const prefetchRepository = useCallback(() => {
    const repo = getRepositoryStore(projectId);
    void repo?.localData.load();
    void repo?.remoteData.load();
  }, [projectId]);

  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const expressMode = homeDraft?.expressMode ?? false;
  const projectStoreForExpress = getProjectStore(projectId);
  const mountedForExpress = asMounted(projectStoreForExpress);
  const expressConnectionId =
    mountedForExpress?.data?.type === 'ssh' ? mountedForExpress.data.connectionId : undefined;
  const { providerId: expressProviderId } = useEffectiveProvider(expressConnectionId);
  const expressAutoApproveDefaults = useAgentAutoApproveDefaults();

  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : null;
  const currentTaskId = currentView === 'task' ? taskParams.taskId : null;

  const isProjectActive = currentProjectId === projectId && !currentTaskId;

  useEffect(() => {
    if (isProjectActive) prefetchRepository();
  }, [isProjectActive, prefetchRepository]);

  const isExpanded = sidebarStore.expandedProjectIds.has(projectId);

  const handleAddTask = useCallback(async () => {
    const mounted = mountedForExpress;
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
        provider: expressProviderId,
        title: taskName,
        autoApprove: expressAutoApproveDefaults.getDefault(expressProviderId),
      },
    });
    navigate('task', { projectId: mounted.data.id, taskId });
  }, [
    expressMode,
    expressProviderId,
    expressAutoApproveDefaults,
    homeDraft?.strategyKind,
    mountedForExpress,
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
  const ProjectIcon = isSshProject ? FolderInput : FolderClosed;

  const renderSpinnerWithTooltip = () => {
    if (!isUnregisteredProject(project)) return null;
    const labelKey = UNREGISTERED_PHASE_KEY[project.phase] ?? 'sidebar.phase.loading';
    return (
      <Tooltip>
        <TooltipTrigger>
          <SidebarItemMiniButton type="button" disabled aria-label={t('sidebar.loading')}>
            <Loader2 className="h-4 w-4 animate-spin text-foreground/60" />
          </SidebarItemMiniButton>
        </TooltipTrigger>
        <TooltipContent>{t(labelKey)}</TooltipContent>
      </Tooltip>
    );
  };

  const handleArchive = () => {
    void getProjectManagerStore().archiveProject(projectId);
    if (isProjectActive) navigate('home');
  };

  const menuActions = {
    isSsh: isSshProject,
    canReconnect,
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
        : () => showManageRunScripts({ projectId, projectName: project.name ?? projectId }),
    onArchive: handleArchive,
  };

  return (
    <ProjectContextMenu {...menuActions}>
      <SidebarMenuRow
        className={cn('group/row h-8 justify-between flex px-1')}
        data-active={isProjectActive || undefined}
        isActive={isProjectActive}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => navigate('project', { projectId })}
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
                sidebarStore.toggleProjectExpanded(projectId);
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
              'flex-1 min-w-0 self-stretch flex items-center truncate text-left transition-colors select-none',
              projectViewKind(getProjectStore(projectId)) === 'bootstrapping' &&
                'text-foreground-tertiary-passive'
            )}
          >
            {isSshProject ? (
              <span className="min-w-0 flex items-center gap-2">
                <span className="truncate">{project.name}</span>
                <ConnectionStatusDot state={sshConnectionState} />
              </span>
            ) : (
              <span className="min-w-0 flex items-center gap-1.5">
                <span className="truncate">{project.name}</span>
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
                aria-label={t('sidebar.runScripts.menuLabel')}
                disabled={project.state === 'unregistered'}
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
