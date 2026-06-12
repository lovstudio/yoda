import {
  BookOpen,
  ExternalLink,
  FolderInput,
  Globe,
  MessageSquareShare,
  PanelRightOpen,
  Puzzle,
  Search,
  Settings,
  Smartphone,
  SquarePen,
  Workflow,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { skillIssueAgentLabel } from '@shared/skills/validation';
import { YODA_DOCS_URL, YODA_WEBSITE_URL } from '@shared/urls';
import type { ViewId } from '@renderer/app/view-registry';
import {
  useSkillValidationIssues,
  type SkillValidationIssueEntry,
} from '@renderer/features/skills/useSkillValidationIssues';
import { WorkspaceSwitcher } from '@renderer/features/workspaces/workspace-switcher';
import { rpc } from '@renderer/lib/ipc';
import {
  isCurrentView,
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { SidebarPinnedTaskList } from './pinned-task-list';
import { SidebarProjectlessTaskList } from './projectless-task-list';
import { ProjectsGroupLabel, ProjectsSettingsMenu } from './projects-group-label';
import {
  SidebarContainer,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
} from './sidebar-primitives';
import { SidebarSpace } from './sidebar-space';
import { SidebarVersionAnchor } from './sidebar-version-anchor';
import { SidebarVirtualList } from './sidebar-virtual-list';
import { useSidebarDrop } from './use-sidebar-drop';

/** Tracks whether the Alt/Option key is held, resetting on window blur. */
function useAltKeyHeld(): boolean {
  const [held, setHeld] = React.useState(false);
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setHeld(false);
    };
    const onBlur = () => setHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return held;
}

/**
 * Wraps a sidebar control that routes to a registered view: right-click offers
 * "open in global sidebar" (copy semantics — the pane gets an independent
 * instance), and while Alt/Option is held a hover tooltip hints that clicking
 * pins the view into the shell side pane instead of navigating.
 */
const GlobalSidePaneTarget: React.FC<{
  viewId: ViewId;
  params?: Record<string, unknown>;
  altHeld: boolean;
  tooltipSide?: 'top' | 'right';
  children: React.ReactElement;
}> = ({ viewId, params, altHeld, tooltipSide = 'right', children }) => {
  const { t } = useTranslation();
  const [hovered, setHovered] = React.useState(false);
  const label = t('appTabs.openInGlobalSidePane');
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="shrink-0"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Tooltip open={altHeld && hovered}>
          <TooltipTrigger render={children} />
          <TooltipContent side={tooltipSide}>{label}</TooltipContent>
        </Tooltip>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          className="whitespace-nowrap"
          onClick={() => appState.sidePane.pinView(viewId, params ?? {})}
        >
          <PanelRightOpen className="size-4" />
          {label}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const altHeld = useAltKeyHeld();

  const showCommandPalette = useShowModal('commandPaletteModal');
  const showFeedbackModal = useShowModal('feedbackModal');
  const { count: skillIssueCount, firstIssue: firstSkillIssue } = useSkillValidationIssues();
  const { isDragOver, onDragOver, onDragEnter, onDragLeave, onDrop } = useSidebarDrop();

  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');
  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : undefined;
  const currentTaskId = currentView === 'task' ? taskParams.taskId : undefined;
  const skillIssueLabel =
    skillIssueCount > 0 ? t('sidebar.skillIssues', { count: skillIssueCount }) : null;
  const skillIssueTitle =
    skillIssueLabel && firstSkillIssue
      ? `${skillIssueLabel}\n${formatSkillIssueTitle(firstSkillIssue)}`
      : (skillIssueLabel ?? undefined);
  const handleOpenFirstSkillIssue = React.useCallback(() => {
    if (!firstSkillIssue) {
      navigate('skills');
      return;
    }
    navigate('skills', { focusSkillId: firstSkillIssue.skill.id });
  }, [firstSkillIssue, navigate]);
  const handleNewTask = React.useCallback(() => {
    if (currentProjectId) {
      navigate('home', { projectId: currentProjectId });
      return;
    }
    navigate('home');
  }, [currentProjectId, navigate]);

  // Quick-access icons docked to the right of the account row. Each view is
  // also reachable as an embedded settings tab.
  const quickNavItems: {
    key: 'skills' | 'automation' | 'mobile';
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    title?: string;
    onClick: () => void;
    pinParams?: Record<string, unknown>;
    showIssueDot?: boolean;
  }[] = [
    {
      key: 'skills',
      icon: Puzzle,
      label: t('sidebar.skills'),
      title: skillIssueTitle ?? t('sidebar.skills'),
      onClick: skillIssueCount > 0 ? handleOpenFirstSkillIssue : () => navigate('skills'),
      pinParams: firstSkillIssue ? { focusSkillId: firstSkillIssue.skill.id } : undefined,
      showIssueDot: skillIssueCount > 0,
    },
    {
      key: 'automation',
      icon: Workflow,
      label: t('sidebar.automation'),
      onClick: () => navigate('automation'),
    },
    {
      key: 'mobile',
      icon: Smartphone,
      label: t('sidebar.mobile'),
      onClick: () => navigate('mobile'),
    },
  ];

  return (
    <div
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
      <SidebarContainer className="w-full border-r-0 flex-1 min-h-0">
        <SidebarFooter className="mt-0 border-t-0 px-2 pb-0">
          <SidebarMenu>
            <div className="group/ws flex h-8 items-center gap-1 rounded-lg pr-1 text-foreground-tertiary-muted transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary has-data-popup-open:bg-background-tertiary-1 has-data-popup-open:text-foreground-tertiary">
              <WorkspaceSwitcher />
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
              <ShortcutHint settingsKey="newProject" />
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
            <div className="my-1 border-t border-border" />
          </SidebarMenu>
        </SidebarFooter>
        <SidebarContent className="flex flex-col overflow-y-auto">
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
          <SidebarProjectlessTaskList />
        </SidebarContent>
        <div className="flex flex-col">
          {/* Single separator for the footer block: sits above the nav section
              when expanded, and directly above the account row when collapsed. */}
          <div className="mx-2 my-1 border-t border-border" />
          {!sidebarStore.navSectionHidden && (
            <SidebarMenu className="px-2">
              <GlobalSidePaneTarget viewId="settings" altHeld={altHeld}>
                <SidebarMenuButton
                  isActive={isCurrentView(currentView, 'settings')}
                  onClick={(e) =>
                    e.altKey ? appState.sidePane.pinView('settings', {}) : navigate('settings')
                  }
                  aria-label={t('sidebar.settings')}
                  className="w-full justify-start"
                >
                  <Settings className="h-5 w-5 sm:h-4 sm:w-4" />
                  {t('sidebar.settings')}
                </SidebarMenuButton>
              </GlobalSidePaneTarget>
              <SidebarMenuButton
                onClick={() => void rpc.app.openExternal(YODA_WEBSITE_URL)}
                aria-label={t('sidebar.website')}
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Globe className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
                  <span className="truncate">{t('sidebar.website')}</span>
                </span>
                <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-foreground-tertiary-passive" />
              </SidebarMenuButton>
              <SidebarMenuButton
                onClick={() => void rpc.app.openExternal(YODA_DOCS_URL)}
                aria-label={t('sidebar.docs')}
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <BookOpen className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
                  <span className="truncate">{t('sidebar.docs')}</span>
                </span>
                <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-foreground-tertiary-passive" />
              </SidebarMenuButton>
              <SidebarMenuButton
                onClick={() => showFeedbackModal({})}
                aria-label={t('sidebar.giveFeedback')}
                className="w-full justify-start"
              >
                <MessageSquareShare className="h-5 w-5 sm:h-4 sm:w-4" />
                {t('sidebar.giveFeedback')}
              </SidebarMenuButton>
            </SidebarMenu>
          )}
          <div className="flex items-center gap-0.5 pr-2">
            <div className="min-w-0 flex-1">
              <SidebarVersionAnchor />
            </div>
            {quickNavItems.map(
              ({ key, icon: Icon, label, title, onClick, pinParams, showIssueDot }) => (
                <GlobalSidePaneTarget
                  key={key}
                  viewId={key}
                  params={pinParams}
                  altHeld={altHeld}
                  tooltipSide="top"
                >
                  <button
                    type="button"
                    onClick={(e) =>
                      e.altKey ? appState.sidePane.pinView(key, pinParams ?? {}) : onClick()
                    }
                    aria-label={label}
                    // Native title would fight the Alt-hint tooltip.
                    title={altHeld ? undefined : (title ?? label)}
                    className={cn(
                      'relative flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-tertiary-passive transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isCurrentView(currentView, key) &&
                        'bg-background-tertiary-1 text-foreground-tertiary'
                    )}
                  >
                    <Icon className="size-4" />
                    {showIssueDot && (
                      <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500" />
                    )}
                  </button>
                </GlobalSidePaneTarget>
              )
            )}
          </div>
        </div>
      </SidebarContainer>
    </div>
  );
});

function formatSkillIssueTitle(entry: SkillValidationIssueEntry): string {
  const location = entry.issue.path ? `${entry.issue.path}: ` : '';
  return `${entry.skill.displayName}: ${skillIssueAgentLabel(entry.issue.agent)}: ${location}${entry.issue.message}`;
}
