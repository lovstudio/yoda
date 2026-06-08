import {
  AlertTriangle,
  Bot,
  FolderInput,
  Layers,
  Puzzle,
  Search,
  Smartphone,
  SquarePen,
  Workflow,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  useSkillValidationIssues,
  type SkillValidationIssueEntry,
} from '@renderer/features/skills/useSkillValidationIssues';
import {
  isCurrentView,
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { cn } from '@renderer/utils/utils';
import { SidebarPinnedTaskList } from './pinned-task-list';
import { SidebarProjectlessTaskList } from './projectless-task-list';
import { ProjectsGroupLabel } from './projects-group-label';
import { SidebarAccount } from './sidebar-account';
import {
  SidebarContainer,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuRow,
} from './sidebar-primitives';
import { SidebarSpace } from './sidebar-space';
import { SidebarVirtualList } from './sidebar-virtual-list';
import { UpdateSection } from './update-section';
import { useSidebarDrop } from './use-sidebar-drop';

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();

  const showCommandPalette = useShowModal('commandPaletteModal');
  const showMobileConnection = useShowModal('mobileConnectionModal');
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
        <SidebarFooter className="mt-0 border-t-0 border-b">
          <SidebarMenu>
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
                showCommandPalette({ projectId: currentProjectId, taskId: currentTaskId })
              }
              aria-label={t('sidebar.searchTasks')}
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2 min-w-0 w-full">
                <Search className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate min-w-0">{t('sidebar.searchTasks')}</span>
              </span>
              <ShortcutHint settingsKey="commandPalette" />
            </SidebarMenuButton>
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
        <div className="flex flex-col border-t border-border">
          <SidebarMenu className="px-2 pt-2">
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'agents')}
              onClick={() => navigate('agents')}
              aria-label={t('sidebar.agents')}
              className="w-full justify-start"
            >
              <Bot className="h-5 w-5 sm:h-4 sm:w-4" />
              {t('sidebar.agents')}
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'maas')}
              onClick={() => navigate('maas')}
              aria-label={t('sidebar.maas')}
              className="w-full justify-start"
            >
              <Layers className="h-5 w-5 sm:h-4 sm:w-4" />
              {t('sidebar.maas')}
            </SidebarMenuButton>
            <SidebarMenuRow
              isActive={isCurrentView(currentView, 'skills')}
              className="gap-1 px-1 py-1"
            >
              <button
                type="button"
                onClick={() => navigate('skills')}
                onMouseDown={(event) => event.preventDefault()}
                aria-label={t('sidebar.skills')}
                className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Puzzle className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
                <span className="truncate">{t('sidebar.skills')}</span>
              </button>
              {skillIssueCount > 0 && (
                <button
                  type="button"
                  onClick={handleOpenFirstSkillIssue}
                  onMouseDown={(event) => event.preventDefault()}
                  aria-label={`${skillIssueLabel}: ${t('sidebar.openFirstSkillIssue')}`}
                  title={skillIssueTitle}
                  className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] font-medium text-amber-600 transition-colors hover:border-amber-500/70 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {formatIssueCount(skillIssueCount)}
                </button>
              )}
            </SidebarMenuRow>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'automation')}
              onClick={() => navigate('automation')}
              aria-label={t('sidebar.automation')}
              className="w-full justify-start"
            >
              <Workflow className="h-5 w-5 sm:h-4 sm:w-4" />
              {t('sidebar.automation')}
            </SidebarMenuButton>
            <SidebarMenuButton
              onClick={() => showMobileConnection({})}
              aria-label={t('sidebar.mobile')}
              className="w-full justify-start"
            >
              <Smartphone className="h-5 w-5 sm:h-4 sm:w-4" />
              {t('sidebar.mobile')}
            </SidebarMenuButton>
          </SidebarMenu>
          <div className="flex items-center justify-end px-3 py-2 border-t border-border">
            <UpdateSection />
          </div>
          <div className="border-t border-border">
            <SidebarAccount />
          </div>
        </div>
      </SidebarContainer>
    </div>
  );
});

function formatIssueCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function formatSkillIssueTitle(entry: SkillValidationIssueEntry): string {
  const location = entry.issue.path ? `${entry.issue.path}: ` : '';
  return `${entry.skill.displayName}: Codex: ${location}${entry.issue.message}`;
}
