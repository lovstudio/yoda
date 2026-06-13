import {
  AppWindow,
  Archive,
  ArrowRightToLine,
  CopyX,
  Link,
  ListX,
  PanelRight,
  PanelRightOpen,
  Pencil,
  RefreshCw,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { buildTaskDeepLink } from '@shared/deep-links';
import type { TaskWindowTabTarget } from '@shared/task-window';
import {
  closeTaskTopTab,
  findInternalTabId,
  openProvisionedTaskTab,
} from '@renderer/app/open-task-target';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { archiveConversationFlow } from '@renderer/features/tasks/archive-task';
import {
  copyTaskLink,
  TaskContextMenuItems,
} from '@renderer/features/tasks/components/task-context-menu';
import { useTaskMenuActions } from '@renderer/features/tasks/components/use-task-menu-actions';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import {
  OVERVIEW_TAB_ID,
  type TabManagerStore,
} from '@renderer/features/tasks/tabs/tab-manager-store';
import { openTaskTabInWindow } from '@renderer/features/tasks/tabs/tab-meta';
import { FilePathMenuItems, type FilePathTarget } from '@renderer/lib/components/file-path-actions';
import { APP_SHORTCUTS } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { isIndexTab, type AppTabEntry } from '@renderer/lib/stores/app-tabs-store';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { log } from '@renderer/utils/logger';

/**
 * Right-click menu for top-level app tabs, built as sections separated
 * automatically. Section order follows frequency, with the destructive
 * lifecycle action isolated at the bottom:
 *
 *   conversation tabs: management (rename / archive) → copy link
 *                      → open modes (in sidebar / in window)
 *                      → close group + reload (always last)
 *   file/diff tabs:    placement → path actions → close group
 *   every other tab:   close group only
 *
 * Close-group items render conditionally (no "close others" without others,
 * no "close to the right" at the rightmost tab) and operate scope-wide on
 * the visible strip; index tabs are never closed.
 */
export const AppTabContextMenu = observer(function AppTabContextMenu({
  tab,
  children,
}: {
  tab: AppTabEntry;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  // A task's overview tab is the task entity itself on the strip — it gets the
  // shared task menu (identical to the sidebar row and the kanban row).
  if (tab.viewId === 'task') {
    const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
    const target = (tab.params.tab as TaskWindowTabTarget | undefined) ?? { kind: 'overview' };
    if (projectId && taskId && target.kind === 'overview') {
      return (
        <TaskOverviewTabMenu tab={tab} projectId={projectId} taskId={taskId}>
          {children}
        </TaskOverviewTabMenu>
      );
    }
  }

  const sections = buildTabSections(tab, t).filter((section) => section.length > 0);

  if (sections.length === 0) return <>{children}</>;

  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {sections.map((section, index) => (
          // Sections are stable per tab kind — index keys are fine here.
          <Fragment key={index}>
            {index > 0 ? <ContextMenuSeparator /> : null}
            {section}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});

export type Translate = Parameters<typeof copyTaskLink>[1];

function buildTabSections(tab: AppTabEntry, t: Translate): ReactNode[][] {
  if (tab.viewId === 'task') return buildTaskSections(tab, t);
  if (tab.viewId === 'file') {
    return [[buildGlobalPinItem(tab, t)], buildProjectFileSection(tab), buildCloseSection(tab, t)];
  }
  // Every other tab (project pages, global views, home) can at least be
  // pinned into the shell side pane.
  return [[buildGlobalPinItem(tab, t)], buildCloseSection(tab, t)];
}

/**
 * "Open in global sidebar" for non-task tabs — copy semantics: the pane gets
 * an independent instance of the view; the tab itself stays in the strip.
 */
function buildGlobalPinItem(tab: AppTabEntry, t: Translate): ReactNode {
  return (
    <ContextMenuItem
      key="global-pin"
      className="whitespace-nowrap"
      onClick={() => appState.sidePane.pinView(tab.viewId, tab.params)}
    >
      <PanelRightOpen className="size-4" />
      {t('appTabs.openInGlobalSidePane')}
    </ContextMenuItem>
  );
}

// ---------------------------------------------------------------------------
// Task tabs (sessions, worktree files, diffs)
// ---------------------------------------------------------------------------

/**
 * Right-click menu for a task's overview tab — the task entity itself on the
 * strip. Reuses the shared task menu wiring (same items as the sidebar row and
 * the kanban row, see agents/conventions/reuse.md), then appends the tab
 * placement and close groups. The index tab itself isn't closeable, but it's a
 * natural place to sweep the rest of the strip from; its shell-pane pin is a
 * copy — the overview stays the scope's fixed index tab.
 */
const TaskOverviewTabMenu = observer(function TaskOverviewTabMenu({
  tab,
  projectId,
  taskId,
  children,
}: {
  tab: AppTabEntry;
  projectId: string;
  taskId: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const actions = useTaskMenuActions(projectId, taskId);
  const tabSections: ReactNode[][] = [
    [
      <ContextMenuItem
        key="global-pin"
        className="whitespace-nowrap"
        onClick={() => appState.sidePane.pinTask(projectId, taskId, OVERVIEW_TAB_ID)}
      >
        <PanelRightOpen className="size-4" />
        {t('appTabs.openInGlobalSidePane')}
      </ContextMenuItem>,
    ],
    buildCloseSection(tab, t),
  ].filter((section) => section.length > 0);

  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-max overflow-x-visible">
        {actions ? (
          <>
            <TaskContextMenuItems {...actions} />
            <ContextMenuSeparator />
          </>
        ) : null}
        {tabSections.map((section, index) => (
          // Sections are stable per tab kind — index keys are fine here.
          <Fragment key={index}>
            {index > 0 ? <ContextMenuSeparator /> : null}
            {section}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});

function buildTaskSections(tab: AppTabEntry, t: Translate): ReactNode[][] {
  const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
  const target = (tab.params.tab as TaskWindowTabTarget | undefined) ?? { kind: 'overview' };
  // Overview tabs are intercepted by TaskOverviewTabMenu before reaching here.
  if (!projectId || !taskId || target.kind === 'overview') return [];

  const provisioned = asProvisioned(getTaskStore(projectId, taskId));

  const placement: ReactNode[] = [];
  if (provisioned) {
    placement.push(
      <ContextMenuItem
        key="sidebar-pin"
        className="whitespace-nowrap"
        onClick={() => void moveTopTabToSidebar(tab, provisioned, target)}
      >
        <PanelRight className="size-4" />
        {t('tasks.tabs.openInSidePane')}
      </ContextMenuItem>,
      <ContextMenuItem
        key="global-pin"
        className="whitespace-nowrap"
        onClick={() => void moveTopTabToShellPane(tab, provisioned, projectId, taskId, target)}
      >
        <PanelRightOpen className="size-4" />
        {t('appTabs.openInGlobalSidePane')}
      </ContextMenuItem>
    );
  }
  placement.push(
    <ContextMenuItem
      key="window"
      className="whitespace-nowrap"
      onClick={() => {
        void openTaskTabInWindow({ projectId, taskId, tab: target }).then((opened) => {
          if (opened) closeTaskTopTab(tab);
        });
      }}
    >
      <AppWindow className="size-4" />
      {t('tasks.tabs.openInWindow')}
    </ContextMenuItem>
  );

  if (target.kind === 'conversation') {
    const [management, copy] = buildConversationSections(
      provisioned,
      projectId,
      taskId,
      target.conversationId,
      t
    );
    return [management ?? [], copy ?? [], placement, buildCloseSection(tab, t)];
  }

  // file / diff target — path actions based on the task worktree.
  const file: ReactNode[] = provisioned
    ? [
        <FilePathMenuItems
          key="file-actions"
          target={fileTarget(provisioned.path, target.path, provisioned.workspace.sshConnectionId)}
          components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
        />,
      ]
    : [];

  return [placement, file, buildCloseSection(tab, t)];
}

/**
 * Scope-wide close actions for the visible strip. Items appear only when they
 * would actually do something; the ⌘W hint shows only on the active tab since
 * the shortcut targets the active tab, not the right-clicked one.
 */
function buildCloseSection(tab: AppTabEntry, t: Translate): ReactNode[] {
  const visible = appState.appTabs.visibleTabs;
  const index = visible.findIndex((entry) => entry.id === tab.id);
  const closeable = visible.filter((entry) => !isIndexTab(entry));
  const others = closeable.filter((entry) => entry.id !== tab.id);
  const toRight =
    index === -1 ? [] : visible.slice(index + 1).filter((entry) => !isIndexTab(entry));

  const closeHotkey =
    tab.id === appState.appTabs.activeTabId
      ? formatHotkey(APP_SHORTCUTS.tabClose.defaultHotkey)
      : undefined;

  const items: ReactNode[] = [];
  if (!isIndexTab(tab)) {
    items.push(
      <ContextMenuItem
        key="close"
        className="whitespace-nowrap"
        onClick={() => closeTaskTopTab(tab)}
      >
        <X className="size-4" />
        {t('tasks.tabs.close')}
        {closeHotkey ? <ContextMenuShortcut>{closeHotkey}</ContextMenuShortcut> : null}
      </ContextMenuItem>
    );
  }
  if (others.length > 0) {
    items.push(
      <ContextMenuItem
        key="close-others"
        className="whitespace-nowrap"
        onClick={() => others.forEach(closeTaskTopTab)}
      >
        <ListX className="size-4" />
        {t('tasks.tabs.closeOthers')}
      </ContextMenuItem>
    );
  }
  if (toRight.length > 0) {
    items.push(
      <ContextMenuItem
        key="close-right"
        className="whitespace-nowrap"
        onClick={() => toRight.forEach(closeTaskTopTab)}
      >
        <ArrowRightToLine className="size-4" />
        {t('tasks.tabs.closeToRight')}
      </ContextMenuItem>
    );
  }
  if (closeable.length > 1) {
    items.push(
      <ContextMenuItem
        key="close-all"
        className="whitespace-nowrap"
        onClick={() => closeable.forEach(closeTaskTopTab)}
      >
        <CopyX className="size-4" />
        {t('tasks.tabs.closeAll')}
      </ContextMenuItem>
    );
  }
  return items;
}

/** 'Mod+W' → '⌘W', matching the command palette's hotkey display. */
function formatHotkey(hotkey: string | undefined): string | undefined {
  return hotkey?.replace('Mod', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace(/\+/g, '');
}

/**
 * Conversation menu sections (management + copy + maintenance), shared between
 * the top-level tab strip and the task sidebar's pinned chips.
 */
export function buildConversationSections(
  provisioned: ProvisionedTask | undefined,
  projectId: string,
  taskId: string,
  conversationId: string,
  t: Translate
): ReactNode[][] {
  // Session management: rename + archive + reload — routine curation actions
  // (archive is recoverable, reload is a rare recovery action grouped with it).
  const management: ReactNode[] = [];
  if (provisioned) {
    management.push(
      <ContextMenuItem
        key="rename"
        className="whitespace-nowrap"
        onClick={() =>
          showModal('renameConversationModal', {
            projectId,
            taskId,
            conversationId,
            currentTitle:
              provisioned.conversations.conversations.get(conversationId)?.data.title ?? '',
          })
        }
      >
        <Pencil className="size-4" />
        {t('tasks.tabs.renameConversation')}
      </ContextMenuItem>,
      <ConversationArchiveSubmenu
        key="archive"
        projectId={projectId}
        taskId={taskId}
        conversationId={conversationId}
      />,
      <ContextMenuItem
        key="reload"
        className="whitespace-nowrap"
        onClick={() => void provisioned.conversations.restartConversation(conversationId)}
      >
        <RefreshCw className="size-4" />
        {t('tasks.tabs.reloadConversation')}
      </ContextMenuItem>
    );
  }

  const copy: ReactNode[] = [
    <ContextMenuItem
      key="copy-link"
      className="whitespace-nowrap"
      onClick={() => void copyTaskLink(buildTaskDeepLink({ projectId, taskId, conversationId }), t)}
    >
      <Link className="size-4" />
      {t('tasks.tabs.copyYodaLink')}
    </ContextMenuItem>,
  ];

  return [management, copy];
}

/**
 * Archive entry as a submenu, mirroring the task context menu's archive
 * options: direct archive (skip the pre-archive skill), run the configured
 * skill then archive, and a shortcut to where the skill is configured.
 */
function ConversationArchiveSubmenu({
  projectId,
  taskId,
  conversationId,
}: {
  projectId: string;
  taskId: string;
  conversationId: string;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const hasArchiveSkill = (homeDraft?.preArchiveCommand ?? '').trim().length > 0;

  const archive = (skipPreCommand: boolean) => {
    void archiveConversationFlow(projectId, taskId, conversationId, { skipPreCommand }).catch(
      (error: unknown) => {
        log.warn('AppTabContextMenu: archive conversation failed', {
          projectId,
          taskId,
          conversationId,
          error,
        });
      }
    );
  };

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="whitespace-nowrap">
        <Archive className="size-4" />
        {t('tasks.tabs.archiveConversation')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem className="whitespace-nowrap" onClick={() => archive(true)}>
          <Archive className="size-4" />
          {t('tasks.tabs.archiveConversationDirect')}
        </ContextMenuItem>
        <ContextMenuItem
          className="whitespace-nowrap"
          disabled={!hasArchiveSkill}
          onClick={() => archive(false)}
        >
          <Sparkles className="size-4" />
          {t('tasks.context.archiveWithSkill')}
        </ContextMenuItem>
        <ContextMenuItem
          className="whitespace-nowrap"
          onClick={() => navigate('settings', { tab: 'sessions' })}
        >
          <Settings2 className="size-4" />
          {t('tasks.context.configureArchiveSkill')}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/**
 * Pins a top-level task tab into the task sidebar strip: ensures the internal
 * tab entry exists (replaying the target below the bridge), moves it into the
 * sidebar, then closes the top-level tab — the entity now lives in the
 * sidebar, not the strip. Returns the internal tab id (shared with the
 * sidebar's drop zone, which positions the new chip afterwards).
 */
export async function moveTopTabToSidebar(
  tab: AppTabEntry,
  provisioned: ProvisionedTask,
  target: TaskWindowTabTarget
): Promise<string | undefined> {
  const tabManager = provisioned.taskView.tabManager;
  const internalId = await ensureInternalTab(provisioned, tabManager, target);
  if (!internalId) return undefined;

  tabManager.moveTabToSidebar(internalId);
  // Pinning while the sidebar is hidden would silently swallow the tab.
  provisioned.taskView.setSidebarCollapsed(false);
  appState.appTabs.closeTab(tab.id);
  return internalId;
}

/**
 * Pins a top-level task tab into the shell-level side pane: same move
 * semantics as the task-sidebar pin, but the entity lands in the cross-route
 * pane — it stays visible while the main area navigates anywhere. Returns the
 * internal tab id (shared with the pane's drop zone).
 */
export async function moveTopTabToShellPane(
  tab: AppTabEntry,
  provisioned: ProvisionedTask,
  projectId: string,
  taskId: string,
  target: TaskWindowTabTarget
): Promise<string | undefined> {
  const tabManager = provisioned.taskView.tabManager;
  const internalId = await ensureInternalTab(provisioned, tabManager, target);
  if (!internalId) return undefined;

  tabManager.moveTabToShellPin(internalId);
  appState.sidePane.pinTask(projectId, taskId, internalId);
  appState.appTabs.closeTab(tab.id);
  return internalId;
}

/**
 * Ensures the internal tab entry for a target exists (replaying the target
 * below the bridge when needed) and returns its id.
 */
async function ensureInternalTab(
  provisioned: ProvisionedTask,
  tabManager: TabManagerStore,
  target: TaskWindowTabTarget
): Promise<string | undefined> {
  let internalId = findInternalTabId(tabManager, target);
  if (!internalId) {
    const bridge = tabManager.topLevelBridge;
    const key = JSON.stringify(target);
    if (bridge) bridge.applyingKey = key;
    try {
      await openProvisionedTaskTab(provisioned, target);
    } finally {
      if (bridge && bridge.applyingKey === key) bridge.applyingKey = null;
    }
    internalId = findInternalTabId(tabManager, target);
  }
  return internalId;
}

// ---------------------------------------------------------------------------
// Project-root file tabs
// ---------------------------------------------------------------------------

function buildProjectFileSection(tab: AppTabEntry): ReactNode[] {
  const { projectId, filePath } = tab.params as { projectId?: string; filePath?: string };
  if (!filePath) return [];
  // Project-less (agent-home) file tab — the path itself is absolute.
  if (!projectId) {
    return [
      <FilePathMenuItems
        key="file-actions"
        target={{ absolutePath: filePath, kind: 'file' }}
        components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
      />,
    ];
  }
  const project = getProjectStore(projectId);
  const data = project && 'data' in project ? project.data : undefined;
  if (!data || typeof data !== 'object' || !('path' in data)) return [];

  const sshConnectionId =
    'type' in data && data.type === 'ssh' && 'connectionId' in data
      ? ((data.connectionId as string | undefined) ?? null)
      : null;

  return [
    <FilePathMenuItems
      key="file-actions"
      target={fileTarget(String(data.path), filePath, sshConnectionId)}
      components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
    />,
  ];
}

export function fileTarget(
  rootPath: string,
  relativePath: string,
  sshConnectionId: string | null | undefined
): FilePathTarget {
  const separator = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/';
  const absolutePath = `${rootPath.replace(/[\\/]+$/, '')}${separator}${relativePath
    .replace(/^\/+/, '')
    .replace(/\//g, separator)}`;
  return {
    absolutePath,
    relativePath,
    kind: 'file',
    sshConnectionId: sshConnectionId ?? null,
  };
}
