import { AppWindow, FolderInput, Library, Search, SquarePen, Store } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { skillIssueAgentLabel } from '@shared/skills/validation';
import { useAiLabApps, useUpdateAiLabApp } from '@renderer/features/ai-lab/use-ai-lab';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import {
  useSkillValidationIssues,
  type SkillValidationIssueEntry,
} from '@renderer/features/skills/useSkillValidationIssues';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import {
  WorkspaceReviewBadge,
  WorkspaceSwitcher,
} from '@renderer/features/workspaces/workspace-switcher';
import {
  isCurrentView,
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { cn } from '@renderer/utils/utils';
import { GlobalSidePaneTarget } from './global-side-pane-target';
import { SidebarPinnedTaskList } from './pinned-task-list';
import { ProjectsGroupLabel, ProjectsSettingsMenu } from './projects-group-label';
import { SidebarAccountAnchor } from './sidebar-account-anchor';
import {
  SidebarContainer,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
} from './sidebar-primitives';
import { findSidebarSelectionRow } from './sidebar-selection-sync';
import { SidebarSpace } from './sidebar-space';
import { SidebarStatusBar } from './sidebar-status-bar';
import { SidebarVirtualList } from './sidebar-virtual-list';
import { useAltKeyHeld } from './use-alt-key-held';
import { useSidebarDrop } from './use-sidebar-drop';

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const altHeld = useAltKeyHeld();

  const showCommandPalette = useShowModal('commandPaletteModal');
  const { count: skillIssueCount, firstIssue: firstSkillIssue } = useSkillValidationIssues();
  const { isDragOver, onDragOver, onDragEnter, onDragLeave, onDrop } = useSidebarDrop();

  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');
  const { params: libraryParams } = useParams('library');
  const { params: marketplaceParams } = useParams('marketplace');
  const aiLabApps = useAiLabApps();
  const updateAiLabApp = useUpdateAiLabApp();
  const sidebarContentRef = React.useRef<HTMLDivElement>(null);
  const lastScrolledSelectionRef = React.useRef<string | null>(null);
  const lastScrolledRowRef = React.useRef<HTMLElement | null>(null);
  const pinnedApps = (aiLabApps.data ?? []).filter((app) => app.pinned);
  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : undefined;
  const currentTaskId = currentView === 'task' ? taskParams.taskId : undefined;
  const currentProject = currentProjectId ? getProjectStore(currentProjectId) : undefined;
  const currentTask =
    currentProjectId && currentTaskId ? getTaskStore(currentProjectId, currentTaskId) : undefined;
  const currentProjectPinned = currentProjectId
    ? sidebarStore.isProjectPinned(currentProjectId)
    : false;
  const currentTaskPinned = currentTask?.data.isPinned ?? false;
  const currentWorkspaceId =
    currentProject?.state === 'unregistered'
      ? currentProject.pendingWorkspaceId
      : currentProject?.data?.workspaceId;
  const selectionKey =
    currentProjectId && (currentView === 'project' || currentView === 'task')
      ? `${currentView}:${currentProjectId}:${currentTaskId ?? ''}`
      : null;

  React.useEffect(() => {
    if (!currentProjectId || (currentView !== 'project' && currentView !== 'task')) return;
    sidebarStore.revealSelection(currentProjectId, currentTaskId);
  }, [
    currentProject,
    currentProjectId,
    currentProjectPinned,
    currentTask,
    currentTaskId,
    currentTaskPinned,
    currentView,
    currentWorkspaceId,
  ]);

  React.useEffect(() => {
    const root = sidebarContentRef.current;
    if (!selectionKey || !currentProjectId || !root) {
      lastScrolledSelectionRef.current = null;
      lastScrolledRowRef.current = null;
      return;
    }

    const scrollSelectionIntoView = () => {
      const row = findSidebarSelectionRow(root, currentProjectId, currentTaskId);
      if (!row) {
        lastScrolledRowRef.current = null;
        return;
      }
      if (lastScrolledSelectionRef.current === selectionKey && lastScrolledRowRef.current === row) {
        return;
      }

      lastScrolledSelectionRef.current = selectionKey;
      lastScrolledRowRef.current = row;
      row.scrollIntoView({ block: 'nearest' });
    };

    scrollSelectionIntoView();
    const observer = new MutationObserver(scrollSelectionIntoView);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-sidebar-entity', 'data-sidebar-project-id', 'data-sidebar-task-id'],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [currentProjectId, currentTaskId, selectionKey]);
  const skillIssueLabel =
    skillIssueCount > 0 ? t('sidebar.skillIssues', { count: skillIssueCount }) : null;
  const skillIssueTitle =
    skillIssueLabel && firstSkillIssue
      ? `${skillIssueLabel}\n${formatSkillIssueTitle(firstSkillIssue)}`
      : (skillIssueLabel ?? undefined);
  const handleNewTask = React.useCallback(() => {
    if (currentProjectId) {
      navigate('home', { projectId: currentProjectId });
      return;
    }
    navigate('home');
  }, [currentProjectId, navigate]);

  return (
    <div
      data-yoda-surface="left-sidebar"
      className={cn(
        'relative flex flex-col h-full bg-background-tertiary text-foreground-tertiary-muted transition-colors',
        isDragOver && 'bg-accent/10 ring-2 ring-inset ring-accent/50'
      )}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background-tertiary/80 backdrop-blur-sm pointer-events-none">
          <FolderInput className="size-8 text-foreground" />
          <span className="text-xs font-medium text-foreground">
            {t('sidebar.dropToAddProject')}
          </span>
        </div>
      )}
      <SidebarSpace />
      <div className="px-2 pb-2">
        <SidebarAccountAnchor />
      </div>
      <SidebarContainer className="w-full border-r-0 flex-1 min-h-0">
        <div className="px-2">
          <SidebarMenu>
            <div className="group/ws flex h-8 items-center gap-1 rounded-lg pr-1 text-foreground-tertiary-muted transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary has-data-popup-open:bg-background-tertiary-1 has-data-popup-open:text-foreground-tertiary">
              <WorkspaceSwitcher />
              <WorkspaceReviewBadge className="shrink-0" />
              <ProjectsSettingsMenu />
            </div>
            <div className="my-1 border-t border-border" />
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'home')}
              onClick={handleNewTask}
              aria-label={t('sidebar.newTask')}
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2 min-w-0 w-full">
                <SquarePen className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate min-w-0">{t('sidebar.newTask')}</span>
              </span>
              <ShortcutHint settingsKey="newTask" />
            </SidebarMenuButton>
            <SidebarMenuButton
              onClick={() =>
                showCommandPalette({
                  projectId: currentProjectId,
                  taskId: currentTaskId,
                  initialQuery: 'in:tasks ',
                })
              }
              aria-label={t('sidebar.searchTasks')}
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2 min-w-0 w-full">
                <Search className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate min-w-0">{t('sidebar.searchTasks')}</span>
              </span>
              <ShortcutHint settingsKey="commandPaletteTasks" />
            </SidebarMenuButton>
            <GlobalSidePaneTarget viewId="library" params={libraryParams} altHeld={altHeld}>
              <SidebarMenuButton
                isActive={isCurrentView(currentView, 'library')}
                onClick={(e) =>
                  e.altKey
                    ? appState.sidePane.toggleView('library', libraryParams)
                    : navigate('library', libraryParams)
                }
                aria-label={t('sidebar.library')}
                title={skillIssueTitle ?? t('sidebar.library')}
                className="w-full justify-start"
              >
                <span className="relative flex items-center gap-2 min-w-0 w-full">
                  <Library className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
                  <span className="truncate min-w-0">{t('sidebar.library')}</span>
                  {skillIssueCount > 0 && (
                    <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500" />
                  )}
                </span>
              </SidebarMenuButton>
            </GlobalSidePaneTarget>
            {pinnedApps.map((app) => (
              <GlobalSidePaneTarget
                key={app.id}
                viewId="library"
                params={{ section: 'apps', appId: app.id }}
                altHeld={altHeld}
                unpinAction={{
                  label: t('aiLab.unpinFromNavigation'),
                  disabled: updateAiLabApp.isPending,
                  onSelect: () => updateAiLabApp.mutate({ id: app.id, pinned: false }),
                }}
              >
                <SidebarMenuButton
                  isActive={
                    currentView === 'library' &&
                    libraryParams.section === 'apps' &&
                    libraryParams.appId === app.id
                  }
                  onClick={(event) =>
                    event.altKey
                      ? appState.sidePane.toggleView('library', {
                          section: 'apps',
                          appId: app.id,
                        })
                      : navigate('library', { section: 'apps', appId: app.id })
                  }
                  aria-label={app.name}
                  title={app.description}
                  className="w-full justify-start pl-7"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <AppWindow className="size-3.5 shrink-0 text-sky-500" />
                    <span className="min-w-0 truncate text-xs">{app.name}</span>
                  </span>
                </SidebarMenuButton>
              </GlobalSidePaneTarget>
            ))}
            <GlobalSidePaneTarget viewId="marketplace" params={marketplaceParams} altHeld={altHeld}>
              <SidebarMenuButton
                isActive={isCurrentView(currentView, 'marketplace')}
                onClick={(event) =>
                  event.altKey
                    ? appState.sidePane.toggleView('marketplace', marketplaceParams)
                    : navigate('marketplace')
                }
                aria-label={t('sidebar.marketplace')}
                title={t('sidebar.marketplace')}
                className="w-full justify-start"
              >
                <span className="flex min-w-0 w-full items-center gap-2">
                  <Store className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
                  <span className="min-w-0 truncate">{t('sidebar.marketplace')}</span>
                </span>
              </SidebarMenuButton>
            </GlobalSidePaneTarget>
            <div className="my-1 border-t border-border" />
          </SidebarMenu>
        </div>
        <SidebarContent ref={sidebarContentRef} className="flex flex-col overflow-y-auto">
          <SidebarPinnedTaskList />
          <SidebarGroup className="mb-0 flex flex-col shrink-0">
            <ProjectsGroupLabel />
            {!sidebarStore.projectsCollapsed && (
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarVirtualList />
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        </SidebarContent>
      </SidebarContainer>
      <SidebarStatusBar />
    </div>
  );
});

function formatSkillIssueTitle(entry: SkillValidationIssueEntry): string {
  const location = entry.issue.path ? `${entry.issue.path}: ` : '';
  return `${entry.skill.displayName}: ${skillIssueAgentLabel(entry.issue.agent)}: ${location}${entry.issue.message}`;
}
