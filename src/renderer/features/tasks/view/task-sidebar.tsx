import {
  AppWindow,
  ArrowLeftToLine,
  ChevronDown,
  ChevronUp,
  Folder,
  GitCompare,
  Globe,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelBottom,
  PanelRight,
  PanelRightOpen,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildConversationSections,
  fileTarget,
  moveTopTabToSidebar,
} from '@renderer/app/app-tab-context-menu';
import { openTaskTopTab } from '@renderer/app/open-task-target';
import { tabDragSource, tabDropIndex, useTabDropZone } from '@renderer/app/tab-drag';
import { BrowserPane } from '@renderer/features/tasks/browser/browser-pane';
import type { ResolvedTab } from '@renderer/features/tasks/tabs/tab-manager-store';
import {
  buildTaskWindowTarget,
  getTabMeta,
  openTaskTabInWindow,
} from '@renderer/features/tasks/tabs/tab-meta';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { ChipContextMenu } from '@renderer/lib/components/chip-context-menu';
import { FeatureCard } from '@renderer/lib/components/feature-card';
import { FilePathMenuItems } from '@renderer/lib/components/file-path-actions';
import { SidebarChip } from '@renderer/lib/components/sidebar-chip';
import { appState } from '@renderer/lib/stores/app-state';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import { ChangesPanel } from '../diff-view/changes-panel/changes-panel';
import { EditorFileTree } from '../editor/editor-file-tree';
import { taskSidebarPreferenceStore } from '../stores/task-sidebar-preferences';
import {
  sessionPanelUnitLabelKey,
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
    case 'browser':
      return 'tasks.browser.title';
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
    case 'browser':
      return 'tasks.sidePane.cardDescBrowser';
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
    case 'browser':
      return <Globe className="size-3.5" />;
  }
}

export const TaskSidebar = observer(function TaskSidebar() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { taskView } = provisioned;
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

  // Right-click menu sections for a pinned chip, mirroring the top strip's
  // AppTabContextMenu: placement, then kind-specific actions.
  const pinnedSections = (tab: ResolvedTab): React.ReactNode[][] => {
    const placement: React.ReactNode[] = [];
    if (tab.kind === 'conversation') {
      placement.push(
        <ContextMenuItem
          key="move-back"
          className="whitespace-nowrap"
          onClick={() => closePinned(tab)}
        >
          <ArrowLeftToLine className="size-4" />
          {t('tasks.sidePane.moveBack')}
        </ContextMenuItem>
      );
    }
    placement.push(
      <ContextMenuItem
        key="global-pin"
        className="whitespace-nowrap"
        onClick={() => {
          tabManager.moveTabToShellPin(tab.tabId);
          appState.sidePane.pinTask(projectId, taskId, tab.tabId);
        }}
      >
        <PanelRightOpen className="size-4" />
        {t('appTabs.openInGlobalSidePane')}
      </ContextMenuItem>,
      <ContextMenuItem
        key="window"
        className="whitespace-nowrap"
        onClick={() => {
          void openTaskTabInWindow(buildTaskWindowTarget(projectId, taskId, tab)).then((opened) => {
            if (opened) tabManager.closeTab(tab.tabId);
          });
        }}
      >
        <AppWindow className="size-4" />
        {t('tasks.tabs.openInWindow')}
      </ContextMenuItem>
    );

    if (tab.kind === 'conversation') {
      // Same ordering as the top strip: management (rename / archive / reload)
      // first, copy second, open modes last.
      const [management, copy] = buildConversationSections(
        provisioned,
        projectId,
        taskId,
        tab.conversationId,
        t
      );
      return [management ?? [], copy ?? [], placement];
    }

    if (tab.kind === 'file' || tab.kind === 'diff') {
      return [
        placement,
        [
          <FilePathMenuItems
            key="file-actions"
            target={fileTarget(provisioned.path, tab.path, provisioned.workspace.sshConnectionId)}
            components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
          />,
        ],
        [
          <ContextMenuItem
            key="close"
            className="whitespace-nowrap"
            onClick={() => closePinned(tab)}
          >
            <X className="size-4" />
            {t('common.close')}
          </ContextMenuItem>,
        ],
      ];
    }

    return [placement];
  };

  // The strip accepts this task's entities (from the top strip, the shell
  // pane, or itself for reorder) and its own feature cards for reorder.
  const dropZone = useTabDropZone({
    canDrop: (payload) =>
      payload.kind === 'sidebar-group' ||
      (payload.kind === 'task-entity' &&
        payload.projectId === projectId &&
        payload.taskId === taskId),
    onDrop: (payload, event) => {
      if (payload.kind === 'sidebar-group') {
        taskSidebarPreferenceStore.reorderSidebarGroup(
          payload.group,
          tabDropIndex(event, 'sidebar-group')
        );
        return;
      }
      if (payload.kind !== 'task-entity') return;
      const index = tabDropIndex(event, 'sidebar-pin');
      if (payload.from === 'taskSidebar' && payload.tabId) {
        tabManager.reorderSidebarTab(payload.tabId, index);
        return;
      }
      if (payload.from === 'shellPane' && payload.tabId) {
        tabManager.moveShellPinBack(payload.tabId);
        tabManager.moveTabToSidebar(payload.tabId);
        tabManager.reorderSidebarTab(payload.tabId, index);
        if (payload.pinId) appState.sidePane.unpin(payload.pinId);
        return;
      }
      if (payload.from === 'strip' && payload.appTab) {
        void moveTopTabToSidebar(payload.appTab, provisioned, payload.target).then((tabId) => {
          if (tabId) tabManager.reorderSidebarTab(tabId, index);
        });
      }
    },
  });

  return (
    <Activity mode={isSidebarCollapsed ? 'hidden' : 'visible'}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
        {/* Header row aligned with the main column's titlebar (the split divides
            the top bar): an operable strip — added feature cards plus tabs
            pinned out of the top-level strip. */}
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background-secondary px-2 [-webkit-app-region:drag] dark:bg-background">
          <div
            ref={dropZone.dropRef}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-md',
              dropZone.isOver && 'bg-background-tertiary-1'
            )}
            style={{ scrollbarWidth: 'none' }}
          >
            {openSidebarGroups.map((group) => (
              <ChipContextMenu
                key={group}
                sections={[
                  // Session card: manage which panel sections show, and in
                  // what order.
                  group === 'session'
                    ? [
                        <ContextMenuSub key="sections">
                          <ContextMenuSubTrigger className="whitespace-nowrap">
                            <SlidersHorizontal className="size-4" />
                            {t('tasks.sessionPanel.manageSections')}
                          </ContextMenuSubTrigger>
                          <ContextMenuSubContent className="w-48">
                            <SessionPanelSectionManager />
                          </ContextMenuSubContent>
                        </ContextMenuSub>,
                      ]
                    : [],
                  [
                    <ContextMenuItem
                      key="remove"
                      className="whitespace-nowrap"
                      onClick={() => closeGroup(group)}
                    >
                      <X className="size-4" />
                      {t('tasks.sidePane.removeCard')}
                    </ContextMenuItem>,
                  ],
                ]}
              >
                <SidebarChip
                  label={t(groupLabelKey(group))}
                  icon={groupIcon(group)}
                  isActive={activeGroup === group}
                  closeLabel={t('tasks.sidePane.removeCard')}
                  onSelect={() => selectGroup(group)}
                  onClose={() => closeGroup(group)}
                  drag={tabDragSource(() => ({ kind: 'sidebar-group', group }))}
                  dropMarker="sidebar-group"
                />
              </ChipContextMenu>
            ))}
            {pinnedTabs.map((tab) => {
              const meta = getTabMeta(tab);
              return (
                <ChipContextMenu key={tab.tabId} sections={pinnedSections(tab)}>
                  <SidebarChip
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
                    drag={tabDragSource(() => ({
                      kind: 'task-entity',
                      from: 'taskSidebar',
                      projectId,
                      taskId,
                      tabId: tab.tabId,
                      target: buildTaskWindowTarget(projectId, taskId, tab).tab,
                    }))}
                    dropMarker="sidebar-pin"
                  />
                </ChipContextMenu>
              );
            })}
            {availableGroups.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={t('tasks.sidePane.addCard')}
                  title={t('tasks.sidePane.addCard')}
                  // Follows the chips normally; once the strip overflows it pins
                  // to the scrollport's right edge and chips scroll beneath it.
                  className="sticky right-0 z-10 flex size-7 shrink-0 items-center justify-center rounded-md bg-background-secondary text-foreground-muted hover:bg-background-2 hover:text-foreground dark:bg-background [-webkit-app-region:no-drag]"
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
          <Activity mode={activeGroup === 'browser' ? 'visible' : 'hidden'}>
            <BrowserPane store={taskView.browser} />
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
                    <FeatureCard
                      key={group}
                      className="w-full"
                      icon={groupIcon(group)}
                      label={t(groupLabelKey(group))}
                      description={t(groupDescKey(group))}
                      index={index}
                      onSelect={() => selectGroup(group)}
                    />
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

/**
 * Visibility + order manager for the Session panel units, hosted in the 会话
 * chip's context menu. Plain rows (not menu items) so toggling and reordering
 * never closes the menu — the user can compose the panel in one pass.
 */
const SessionPanelSectionManager = observer(function SessionPanelSectionManager() {
  const { t } = useTranslation();
  const order = taskSidebarPreferenceStore.sessionPanelUnitOrder;
  const hidden = taskSidebarPreferenceStore.sessionPanelHiddenUnits;

  return (
    <div className="flex flex-col">
      {order.map((unit, index) => {
        const visible = !hidden.includes(unit);
        return (
          <div
            key={unit}
            className="group/row flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-background-2"
          >
            <Checkbox
              checked={visible}
              aria-label={t(sessionPanelUnitLabelKey(unit))}
              onCheckedChange={(checked) =>
                taskSidebarPreferenceStore.setSessionPanelUnitHidden(unit, checked !== true)
              }
            />
            <button
              type="button"
              className={cn(
                'min-w-0 flex-1 truncate text-left',
                !visible && 'text-foreground-passive'
              )}
              onClick={() => taskSidebarPreferenceStore.setSessionPanelUnitHidden(unit, visible)}
            >
              {t(sessionPanelUnitLabelKey(unit))}
            </button>
            <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100">
              <button
                type="button"
                aria-label={t('tasks.sessionPanel.moveSectionUp')}
                title={t('tasks.sessionPanel.moveSectionUp')}
                disabled={index === 0}
                className="flex size-5 items-center justify-center rounded-sm text-foreground-passive hover:bg-background-1 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                onClick={() => taskSidebarPreferenceStore.moveSessionPanelUnit(unit, -1)}
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t('tasks.sessionPanel.moveSectionDown')}
                title={t('tasks.sessionPanel.moveSectionDown')}
                disabled={index === order.length - 1}
                className="flex size-5 items-center justify-center rounded-sm text-foreground-passive hover:bg-background-1 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                onClick={() => taskSidebarPreferenceStore.moveSessionPanelUnit(unit, 1)}
              >
                <ChevronDown className="size-3.5" />
              </button>
            </span>
          </div>
        );
      })}
      <div className="mt-0.5 border-t border-border/70 pt-0.5">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-sm text-foreground-muted hover:bg-background-2 hover:text-foreground"
          onClick={() => taskSidebarPreferenceStore.resetSessionPanelUnits()}
        >
          <RotateCcw className="size-3.5" />
          {t('tasks.sessionPanel.resetSections')}
        </button>
      </div>
    </div>
  );
});
