import {
  Folder,
  GitCompare,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelBottom,
  PanelRight,
  Plus,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useTranslation } from 'react-i18next';
import { openTaskTopTab } from '@renderer/app/open-task-target';
import type { ResolvedTab } from '@renderer/features/tasks/tabs/tab-manager-store';
import { buildTaskWindowTarget, getTabMeta } from '@renderer/features/tasks/tabs/tab-meta';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import { ChangesPanel } from '../diff-view/changes-panel/changes-panel';
import { EditorFileTree } from '../editor/editor-file-tree';
import {
  SIDEBAR_TAB_GROUPS,
  sidebarGroupForTab,
  sidebarTabForGroup,
  type SidebarTabGroup,
} from '../types';
import { SessionPanel } from './session-panel';
import { SidebarPinnedContent } from './sidebar-pinned-content';

function groupLabelKey(group: SidebarTabGroup): string {
  switch (group) {
    case 'session':
      return 'tasks.sessionPanel.title';
    case 'changes':
      return 'tasks.changes';
    case 'files':
      return 'tasks.files';
  }
}

/** One-line blurb shown on the empty-state feature card. */
function groupDescKey(group: SidebarTabGroup): string {
  switch (group) {
    case 'session':
      return 'tasks.sidePane.cardDescSession';
    case 'changes':
      return 'tasks.sidePane.cardDescChanges';
    case 'files':
      return 'tasks.sidePane.cardDescFiles';
  }
}

function groupIcon(group: SidebarTabGroup): React.ReactNode {
  switch (group) {
    case 'session':
      return <MessageSquare className="size-3.5" />;
    case 'changes':
      return <GitCompare className="size-3.5" />;
    case 'files':
      return <Folder className="size-3.5" />;
  }
}

export const TaskSidebar = observer(function TaskSidebar() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const { taskView } = useProvisionedTask();
  const { tabManager } = taskView;
  const { isSidebarCollapsed, sidebarTab: activeTab, openSidebarGroups } = taskView;
  const pinnedTabs = tabManager.resolvedSidebarTabs;
  const activePinnedId = tabManager.activeSidebarTabId;
  // A feature card is only active when its chip is actually in the strip.
  const currentGroup = activePinnedId ? null : sidebarGroupForTab(activeTab);
  const activeGroup =
    currentGroup && openSidebarGroups.includes(currentGroup) ? currentGroup : null;
  const sessionActive = activeGroup === 'session';
  const availableGroups = SIDEBAR_TAB_GROUPS.filter((g) => !openSidebarGroups.includes(g));
  const isEmpty = !activeGroup && !activePinnedId;

  const selectGroup = (group: SidebarTabGroup) => {
    tabManager.setActiveSidebarTab(undefined);
    taskView.setSidebarTab(sidebarTabForGroup(group));
  };

  // Closing a feature card removes its chip; if it was active, fall back to the
  // first remaining card, then the first pinned tab.
  const closeGroup = (group: SidebarTabGroup) => {
    taskView.closeSidebarGroup(group);
    if (activeGroup !== group) return;
    const next = openSidebarGroups.find((g) => g !== group);
    if (next) {
      taskView.setSidebarTab(sidebarTabForGroup(next));
    } else if (pinnedTabs.length > 0) {
      tabManager.setActiveSidebarTab(pinnedTabs[0].tabId);
    }
  };

  // Closing a pinned chip: files/diffs (e.g. smart-path cmd+click opens) are
  // stateless and reopenable — just close them, never surface them in the main
  // area. Conversations return to the strip as a background top-level tab so
  // the session stays reachable without stealing the main area's active tab.
  const closePinned = (tab: ResolvedTab) => {
    if (tab.kind === 'file' || tab.kind === 'diff') {
      tabManager.closeTab(tab.tabId);
      return;
    }
    tabManager.moveSidebarTabBack(tab.tabId);
    openTaskTopTab(projectId, taskId, buildTaskWindowTarget(projectId, taskId, tab).tab, {
      activate: false,
    });
  };

  return (
    <Activity mode={isSidebarCollapsed ? 'hidden' : 'visible'}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
        {/* Header row aligned with the main column's titlebar (the split divides
            the top bar): an operable strip — added feature cards plus tabs
            pinned out of the top-level strip. */}
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background-secondary px-2 [-webkit-app-region:drag] dark:bg-background">
          <div
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            style={{ scrollbarWidth: 'none' }}
          >
            {openSidebarGroups.map((group) => (
              <SidebarChip
                key={group}
                label={t(groupLabelKey(group))}
                icon={groupIcon(group)}
                isActive={activeGroup === group}
                closeLabel={t('tasks.sidePane.removeCard')}
                onSelect={() => selectGroup(group)}
                onClose={() => closeGroup(group)}
              />
            ))}
            {pinnedTabs.map((tab) => {
              const meta = getTabMeta(tab);
              return (
                <SidebarChip
                  key={tab.tabId}
                  label={meta.label}
                  title={meta.title}
                  icon={meta.icon}
                  isActive={activePinnedId === tab.tabId}
                  closeLabel={t(
                    tab.kind === 'file' || tab.kind === 'diff'
                      ? 'common.close'
                      : 'tasks.sidePane.moveBack'
                  )}
                  onSelect={() => tabManager.setActiveSidebarTab(tab.tabId)}
                  onClose={() => closePinned(tab)}
                />
              );
            })}
            {availableGroups.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={t('tasks.sidePane.addCard')}
                  title={t('tasks.sidePane.addCard')}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-background-2 hover:text-foreground [-webkit-app-region:no-drag]"
                >
                  <Plus className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-auto">
                  {availableGroups.map((group) => (
                    <DropdownMenuItem key={group} onClick={() => selectGroup(group)}>
                      {groupIcon(group)}
                      {t(groupLabelKey(group))}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={t(
              taskView.isSidebarMaximized ? 'tasks.sidePane.restore' : 'tasks.sidePane.maximize'
            )}
            title={t(
              taskView.isSidebarMaximized ? 'tasks.sidePane.restore' : 'tasks.sidePane.maximize'
            )}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-background-2 hover:text-foreground [-webkit-app-region:no-drag]"
            onClick={() => taskView.setSidebarMaximized(!taskView.isSidebarMaximized)}
          >
            {taskView.isSidebarMaximized ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            aria-label={t('tasks.toggleTerminal')}
            title={t('tasks.toggleTerminal')}
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-background-2 hover:text-foreground [-webkit-app-region:no-drag]',
              taskView.isTerminalDrawerOpen ? 'text-foreground' : 'text-foreground-muted'
            )}
            onClick={() => taskView.setTerminalDrawerOpen(!taskView.isTerminalDrawerOpen)}
          >
            <PanelBottom className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('tasks.toggleSidebar')}
            title={t('tasks.toggleSidebar')}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-background-2 hover:text-foreground [-webkit-app-region:no-drag]"
            onClick={() => taskView.setSidebarCollapsed(true)}
          >
            <PanelRight className="size-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Activity mode={sessionActive ? 'visible' : 'hidden'}>
            <SessionPanel />
          </Activity>
          <Activity mode={activeGroup === 'changes' ? 'visible' : 'hidden'}>
            <ChangesPanel />
          </Activity>
          <Activity mode={activeGroup === 'files' ? 'visible' : 'hidden'}>
            <EditorFileTree />
          </Activity>
          {/* Each pinned entity keeps its own Activity so background PTYs stay alive. */}
          {pinnedTabs.map((tab) => {
            const entry = tabManager.entries.get(tab.tabId);
            if (!entry) return null;
            return (
              <Activity key={tab.tabId} mode={activePinnedId === tab.tabId ? 'visible' : 'hidden'}>
                <SidebarPinnedContent entry={entry} />
              </Activity>
            );
          })}
          {/* Empty state: a centered list of all available feature cards, one per row. */}
          {isEmpty ? (
            availableGroups.length > 0 ? (
              <div className="flex h-full items-center justify-center p-6">
                <div className="flex w-full max-w-72 flex-col gap-2">
                  <p className="animate-in px-1 pb-1 text-[10px] font-medium uppercase tracking-widest text-foreground-passive fade-in-0 fill-mode-backwards">
                    {t('tasks.sidePane.addCard')}
                  </p>
                  {availableGroups.map((group, index) => (
                    <button
                      key={group}
                      type="button"
                      className="group/card flex w-full animate-in items-center gap-3 rounded-lg border border-border bg-background-1 px-3 py-2.5 text-left fade-in-0 slide-in-from-bottom-2 fill-mode-backwards transition-colors hover:border-primary/40 hover:bg-background-2"
                      style={{ animationDelay: `${(index + 1) * 60}ms` }}
                      onClick={() => selectGroup(group)}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background-2 text-foreground-muted transition-colors group-hover/card:border-primary/30 group-hover/card:bg-primary/10 group-hover/card:text-primary [&_svg]:size-4">
                        {groupIcon(group)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-xs font-medium text-foreground">
                          {t(groupLabelKey(group))}
                        </span>
                        <span className="truncate text-[11px] leading-4 text-foreground-passive">
                          {t(groupDescKey(group))}
                        </span>
                      </span>
                      <Plus className="size-3.5 shrink-0 text-foreground-passive opacity-0 transition-opacity group-hover/card:opacity-100" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-4">
                <p className="text-xs text-foreground-passive">{t('tasks.sidePane.emptyHint')}</p>
              </div>
            )
          ) : null}
        </div>
      </div>
    </Activity>
  );
});

/** A chip in the sidebar strip — same visual language as the titlebar's AppTab. */
function SidebarChip({
  label,
  title,
  icon,
  isActive,
  closeLabel,
  onSelect,
  onClose,
}: {
  label: string;
  title?: string;
  icon?: React.ReactNode;
  isActive: boolean;
  closeLabel?: string;
  onSelect: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      title={title ?? label}
      className={cn(
        'group flex h-7 max-w-44 shrink-0 cursor-default select-none items-center gap-1.5 rounded-md border border-transparent py-1 px-2 text-xs [-webkit-app-region:no-drag]',
        onClose && 'pr-1',
        isActive
          ? 'border-border bg-background-1 text-foreground'
          : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
      )}
      onClick={onSelect}
      onAuxClick={(event) => {
        if (event.button === 1 && onClose) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
    >
      {icon ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
      {onClose ? (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <button
            type="button"
            aria-label={closeLabel}
            title={closeLabel}
            className="invisible flex size-4 items-center justify-center rounded-sm text-foreground-passive hover:bg-background-2 hover:text-foreground group-hover:visible"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      ) : null}
    </div>
  );
}
