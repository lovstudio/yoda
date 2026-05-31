import {
  Bot,
  FolderInput,
  Layers,
  MessageSquareShare,
  Puzzle,
  Search,
  Settings,
  SquarePen,
  Workflow,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
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
import { SidebarProjectlessSessionList } from './projectless-session-list';
import { ProjectsGroupLabel } from './projects-group-label';
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
import { SidebarVirtualList } from './sidebar-virtual-list';
import { UpdateSection } from './update-section';
import { useSidebarDrop } from './use-sidebar-drop';

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();

  const showFeedbackModal = useShowModal('feedbackModal');
  const showCommandPalette = useShowModal('commandPaletteModal');
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
              onClick={() => navigate('home')}
              aria-label={t('sidebar.newSession')}
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2 min-w-0 w-full">
                <SquarePen className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate min-w-0">{t('sidebar.newSession')}</span>
              </span>
              <ShortcutHint settingsKey="newProject" />
            </SidebarMenuButton>
            <SidebarMenuButton
              onClick={() =>
                showCommandPalette({ projectId: currentProjectId, taskId: currentTaskId })
              }
              aria-label={t('sidebar.searchSession')}
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2 min-w-0 w-full">
                <Search className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate min-w-0">{t('sidebar.searchSession')}</span>
              </span>
              <ShortcutHint settingsKey="commandPalette" />
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarContent className="flex flex-col">
          <SidebarPinnedTaskList />
          <SidebarGroup
            className={cn(
              'mb-0 flex flex-col',
              sidebarStore.projectsCollapsed ? 'shrink-0' : 'min-h-0 flex-1'
            )}
          >
            <ProjectsGroupLabel />
            {!sidebarStore.projectsCollapsed && (
              <SidebarGroupContent className="min-h-0 flex-1 flex flex-col">
                <SidebarMenu className="flex-1 min-h-0 flex flex-col">
                  <SidebarVirtualList />
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
          <SidebarProjectlessSessionList />
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
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'skills')}
              onClick={() => navigate('skills')}
              aria-label={t('sidebar.skills')}
              className="w-full justify-start"
            >
              <Puzzle className="h-5 w-5 sm:h-4 sm:w-4" />
              {t('sidebar.skills')}
            </SidebarMenuButton>
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
              isActive={isCurrentView(currentView, 'settings')}
              onClick={() => navigate('settings')}
              aria-label={t('sidebar.settings')}
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-5 w-5 sm:h-4 sm:w-4" />
                {t('sidebar.settings')}
              </span>
              <ShortcutHint settingsKey="settings" />
            </SidebarMenuButton>
          </SidebarMenu>
          <div className="flex items-center gap-2 justify-between px-3 py-2 border-t border-border">
            <button
              type="button"
              className="flex h-6 items-center min-w-0 w-full cursor-pointer gap-2 rounded-lg px-3 text-sm text-foreground-muted focus:outline-none focus-visible:outline-none"
              onClick={() => showFeedbackModal({})}
            >
              <MessageSquareShare className="size-4 shrink-0" />
              <span className="truncate">{t('sidebar.giveFeedback')}</span>
            </button>
            <UpdateSection />
          </div>
        </div>
      </SidebarContainer>
    </div>
  );
});
