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
import {
  isUnregisteredProject,
  type UnregisteredProject,
} from '@renderer/features/projects/stores/project';
import {
  asMounted,
  getProjectManagerStore,
  getProjectStore,
  projectViewKind,
} from '@renderer/features/projects/stores/project-selectors';
import { ConnectionStatusDot } from '@renderer/lib/components/connection-status-dot';
import { useParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { ProjectActionsMenu, ProjectContextMenu } from './project-menu';
import { SidebarItemMiniButton, SidebarMenuButton, SidebarMenuRow } from './sidebar-primitives';
import { SIDEBAR_REDACTED_CLASS, SIDEBAR_REDACTED_HOVER_REVEAL_CLASS } from './sidebar-redaction';
import { useProjectMenuActions } from './use-project-menu-actions';

const UNREGISTERED_PHASE_KEY: Record<UnregisteredProject['phase'], string> = {
  'creating-repo': 'sidebar.phase.creatingRepo',
  cloning: 'sidebar.phase.cloning',
  registering: 'sidebar.phase.registering',
  error: 'sidebar.phase.error',
};

export const SidebarProjectItem = observer(function SidebarProjectItem({
  projectId,
  isDropTarget = false,
}: {
  projectId: string;
  /** Highlighted as the drop target while a task is dragged over this project. */
  isDropTarget?: boolean;
}) {
  const { t } = useTranslation();
  const { currentView } = useWorkspaceSlots();
  const { params: projectParams } = useParams('project');
  const { params: taskParams } = useParams('task');
  const [isMenuOpen, setMenuOpen] = useState(false);

  const project = getProjectStore(projectId);
  const mountedProject = asMounted(project);
  const menu = useProjectMenuActions(projectId);

  const handleToggleExpanded = useCallback(() => {
    const willExpand = !sidebarStore.expandedProjectIds.has(projectId);
    sidebarStore.toggleProjectExpanded(projectId);
    if (willExpand) {
      getProjectManagerStore()
        .mountProject(projectId)
        .catch(() => {});
    }
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

  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : null;
  const currentTaskId = currentView === 'task' ? taskParams.taskId : null;

  const isProjectActive = currentProjectId === projectId && !currentTaskId;
  const prefetchRepository = menu?.prefetchRepository;

  useEffect(() => {
    if (isProjectActive) prefetchRepository?.();
  }, [isProjectActive, prefetchRepository]);

  const isExpanded = sidebarStore.expandedProjectIds.has(projectId);

  // Expanded state is persisted independently from project mounts. A project
  // restored below the initial mount limit can therefore render its expanded
  // row before its task manager exists; load it when that visible row enters
  // the virtualized list, without mounting every expanded project at startup.
  useEffect(() => {
    if (!isExpanded || !project || !project.data || mountedProject) return;
    void getProjectManagerStore()
      .mountProject(projectId)
      .catch(() => {});
  }, [isExpanded, mountedProject, project, projectId]);

  if (!project || !menu) return null;

  const { actions: menuActions, addTask, prefetch } = menu;
  const sshConnectionId = project.data?.type === 'ssh' ? project.data.connectionId : null;
  const isSshProject = sshConnectionId !== null;
  const sshConnectionState = sshConnectionId
    ? appState.sshConnections.stateFor(sshConnectionId)
    : null;
  const isRedacted = sidebarStore.isProjectRedacted(projectId);
  const redactedNameClassName =
    isRedacted && cn(SIDEBAR_REDACTED_CLASS, SIDEBAR_REDACTED_HOVER_REVEAL_CLASS);
  const ProjectIcon = isSshProject ? FolderInput : FolderClosed;
  const isLoadingProjectSessions =
    projectViewKind(project) === 'bootstrapping' ||
    mountedProject?.taskManager.taskLoadState === 'loading';

  const renderSpinnerWithTooltip = () => {
    const label = isUnregisteredProject(project)
      ? t(UNREGISTERED_PHASE_KEY[project.phase] ?? 'sidebar.phase.loading')
      : t('sidebar.loadingProjectSessions');
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarItemMiniButton type="button" disabled aria-label={label}>
              <Loader2 className="h-4 w-4 animate-spin text-foreground/60" />
            </SidebarItemMiniButton>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <ProjectContextMenu {...menuActions}>
      <SidebarMenuRow
        className={cn(
          'group/row h-8 justify-between flex px-1',
          isDropTarget && 'ring-2 ring-inset ring-primary bg-primary/10'
        )}
        data-active={isProjectActive || undefined}
        data-sidebar-entity="project"
        data-sidebar-project-id={projectId}
        isActive={isProjectActive}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-busy={project.state === 'unregistered' || isLoadingProjectSessions}
        onMouseDown={(e) => e.preventDefault()}
        onPointerEnter={prefetch.schedule}
        onPointerLeave={prefetch.cancel}
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
          {project.state === 'unregistered' || isLoadingProjectSessions ? (
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
                <span
                  data-sidebar-project-content="name"
                  className={cn(
                    'truncate transition-[color,filter,opacity]',
                    redactedNameClassName
                  )}
                >
                  {project.displayName}
                </span>
                {isLoadingProjectSessions && (
                  <span className="shrink-0 text-xs text-foreground-tertiary-muted">
                    {t('sidebar.loadingSessions')}
                  </span>
                )}
                <ConnectionStatusDot state={sshConnectionState} />
              </span>
            ) : (
              <span className="min-w-0 flex items-center gap-1.5 overflow-hidden">
                <span
                  data-sidebar-project-content="name"
                  className={cn(
                    'truncate transition-[color,filter,opacity]',
                    redactedNameClassName
                  )}
                >
                  {project.displayName}
                </span>
                {isLoadingProjectSessions && (
                  <span className="shrink-0 text-xs text-foreground-tertiary-muted">
                    {t('sidebar.loadingSessions')}
                  </span>
                )}
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
            onPointerEnter={prefetch.schedule}
            onClick={(e) => {
              e.stopPropagation();
              void addTask();
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
