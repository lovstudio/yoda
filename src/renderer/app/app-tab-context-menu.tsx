import {
  AppWindow,
  Archive,
  ArrowRightToLine,
  CopyX,
  GitFork,
  Link,
  ListX,
  LocateFixed,
  PanelRight,
  PanelRightOpen,
  Pencil,
  RefreshCw,
  Settings2,
  Share2,
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
import { refreshProjectFile } from '@renderer/features/project-file/project-file-session';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { archiveConversationFlow } from '@renderer/features/tasks/archive-task';
import { TaskContextMenuItems } from '@renderer/features/tasks/components/task-context-menu';
import { useTaskMenuActions } from '@renderer/features/tasks/components/use-task-menu-actions';
import { ConversationMoveSubmenu } from '@renderer/features/tasks/conversations/conversation-move-submenu';
import {
  canForkConversation,
  forkConversationIntoNewTab,
} from '@renderer/features/tasks/conversations/fork-conversation-tab';
import { isUnprovisioned, type ProvisionedTask } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { type TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import { openTaskTabInWindow } from '@renderer/features/tasks/tabs/tab-meta';
import { copyYodaLink } from '@renderer/lib/clipboard';
import { FilePathMenuItems, type FilePathTarget } from '@renderer/lib/components/file-path-actions';
import { toast } from '@renderer/lib/hooks/use-toast';
import { APP_SHORTCUTS } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { rpc } from '@renderer/lib/ipc';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
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

/** Right-click menu for top-level app tabs; sections are separated automatically. */
export const AppTabContextMenu = observer(function AppTabContextMenu({
  tab,
  children,
}: {
  tab: AppTabEntry;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setCollapsed } = useWorkspaceLayoutContext();
  const revealInSidebar = () => revealTabInSidebar(tab, () => setCollapsed('left', false));

  // A target-less task tab IS the task entity on the strip — it gets the
  // shared task menu (identical to the sidebar row and the kanban row).
  if (tab.viewId === 'task') {
    const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
    if (projectId && taskId && tab.params.tab === undefined) {
      return (
        <TaskOverviewTabMenu
          tab={tab}
          projectId={projectId}
          taskId={taskId}
          onRevealInSidebar={revealInSidebar}
        >
          {children}
        </TaskOverviewTabMenu>
      );
    }
  }

  const sections = buildTabSections(tab, t, revealInSidebar).filter(
    (section) => section.length > 0
  );

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

export type Translate = Parameters<typeof copyYodaLink>[1];

function buildTabSections(
  tab: AppTabEntry,
  t: Translate,
  onRevealInSidebar: () => void
): ReactNode[][] {
  const reveal = buildRevealInSidebarSection(tab, t, onRevealInSidebar);
  if (tab.viewId === 'task') return buildTaskSections(tab, t, reveal);
  if (tab.viewId === 'file') {
    return [
      [...reveal, buildGlobalPinItem(tab, t)],
      buildProjectFileSection(tab),
      buildCloseSection(tab, t),
    ];
  }
  // Every other tab (project pages, global views, home) can at least be
  // pinned into the shell side pane.
  return [[...reveal, buildGlobalPinItem(tab, t)], buildCloseSection(tab, t)];
}

export function tabSidebarTarget(
  tab: AppTabEntry
): { projectId: string; taskId?: string } | undefined {
  const { projectId, taskId } = tab.params as { projectId?: unknown; taskId?: unknown };
  if (typeof projectId !== 'string' || projectId.length === 0) return undefined;
  if (tab.viewId === 'task') {
    if (typeof taskId !== 'string' || taskId.length === 0) return undefined;
    return { projectId, taskId };
  }
  if (tab.viewId === 'project' || tab.viewId === 'file') return { projectId };
  return undefined;
}

export function revealTabInSidebar(tab: AppTabEntry, revealSidebar: () => void): void {
  const target = tabSidebarTarget(tab);
  if (!target) return;
  revealSidebar();
  sidebarStore.requestSelectionReveal(target.projectId, target.taskId);
}

function buildRevealInSidebarSection(
  tab: AppTabEntry,
  t: Translate,
  onRevealInSidebar: () => void
): ReactNode[] {
  if (!tabSidebarTarget(tab)) return [];
  return [
    <ContextMenuItem
      key="reveal-in-sidebar"
      className="whitespace-nowrap"
      onClick={onRevealInSidebar}
    >
      <LocateFixed className="size-4" />
      {t('appTabs.revealInSidebar')}
    </ContextMenuItem>,
  ];
}

/** "Open in global sidebar" — pane gets an independent view instance; tab stays. */
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

/** Overview tab menu — reuses shared task items (see agents/conventions/reuse.md). */
const TaskOverviewTabMenu = observer(function TaskOverviewTabMenu({
  tab,
  projectId,
  taskId,
  onRevealInSidebar,
  children,
}: {
  tab: AppTabEntry;
  projectId: string;
  taskId: string;
  onRevealInSidebar: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const actions = useTaskMenuActions(projectId, taskId);
  const tabSections: ReactNode[][] = [
    buildProvisionRetrySection(projectId, taskId, t),
    [
      <ContextMenuItem
        key="reveal-in-sidebar"
        className="whitespace-nowrap"
        onClick={onRevealInSidebar}
      >
        <LocateFixed className="size-4" />
        {t('appTabs.revealInSidebar')}
      </ContextMenuItem>,
      <ContextMenuItem
        key="global-pin"
        className="whitespace-nowrap"
        onClick={() => appState.sidePane.pinTaskView(projectId, taskId)}
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

function buildTaskSections(tab: AppTabEntry, t: Translate, reveal: ReactNode[]): ReactNode[][] {
  const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
  const target = tab.params.tab as TaskWindowTabTarget | undefined;
  // The task's own tab is intercepted by TaskOverviewTabMenu before reaching here.
  if (!projectId || !taskId || !target) return [];

  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  const retry = buildProvisionRetrySection(projectId, taskId, t);

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
    return [
      retry,
      management ?? [],
      copy ?? [],
      [...reveal, ...placement],
      buildCloseSection(tab, t),
    ];
  }

  // room-member target — identity tab; placement + close only (no path actions).
  if (target.kind === 'room-member') {
    return [retry, [...reveal, ...placement], buildCloseSection(tab, t)];
  }

  // file / diff target — path actions based on the task worktree.
  const file: ReactNode[] = provisioned
    ? [
        <FilePathMenuItems
          key="file-actions"
          target={fileTarget(provisioned.path, target.path, provisioned.workspace.sshConnectionId)}
          components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
          onRefresh={
            target.kind === 'file'
              ? () => provisioned.taskView.editorView.refreshFile(target.path)
              : undefined
          }
        />,
      ]
    : [];

  return [retry, [...reveal, ...placement], file, buildCloseSection(tab, t)];
}

/**
 * "Retry setup" item for a task stuck in `provision-error` — its workspace
 * never provisioned, so the conversation-management items (which require a
 * provisioned task) are absent. Re-runs `provisionTask`, mirroring the retry
 * button on the in-panel TaskProvisionRecovery surface.
 */
function buildProvisionRetrySection(projectId: string, taskId: string, t: Translate): ReactNode[] {
  const store = getTaskStore(projectId, taskId);
  if (!store || !isUnprovisioned(store) || store.phase !== 'provision-error') return [];
  return [
    <ContextMenuItem
      key="retry-provision"
      className="whitespace-nowrap"
      onClick={() => void getTaskManagerStore(projectId)?.provisionTask(taskId)}
    >
      <RefreshCw className="size-4" />
      {t('tasks.retryTaskSetup')}
    </ContextMenuItem>,
  ];
}

/** Scope-wide close actions; items appear only when they have a target. */
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

/** Shared menu sections [management, copy] for the top strip and sidebar chips. */
export function buildConversationSections(
  provisioned: ProvisionedTask | undefined,
  projectId: string,
  taskId: string,
  conversationId: string,
  t: Translate
): ReactNode[][] {
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
      </ContextMenuItem>
    );
    if (canForkConversation(provisioned, conversationId)) {
      management.push(
        <ContextMenuItem
          key="fork"
          className="whitespace-nowrap"
          onClick={() =>
            void forkConversationIntoNewTab({
              provisioned,
              projectId,
              taskId,
              conversationId,
              messages: {
                success: t('tasks.tabs.forkConversationSuccess'),
                failure: t('tasks.tabs.forkConversationFailed'),
              },
            })
          }
        >
          <GitFork className="size-4" />
          {t('tasks.tabs.forkConversation')}
        </ContextMenuItem>
      );
    }
    management.push(
      <ConversationMoveSubmenu
        key="move"
        projectId={projectId}
        taskId={taskId}
        conversationId={conversationId}
      />,
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
    ...(provisioned
      ? [
          <ContextMenuItem
            key="share-public"
            className="whitespace-nowrap"
            onClick={() => void shareConversationPublicly(projectId, taskId, conversationId, t)}
          >
            <Share2 className="size-4" />
            {t('tasks.tabs.sharePublicLink')}
          </ContextMenuItem>,
        ]
      : []),
    <ContextMenuItem
      key="copy-link"
      className="whitespace-nowrap"
      onClick={() => void copyYodaLink(buildTaskDeepLink({ projectId, taskId, conversationId }), t)}
    >
      <Link className="size-4" />
      {t('tasks.tabs.copyYodaLink')}
    </ContextMenuItem>,
  ];

  return [management, copy];
}

async function shareConversationPublicly(
  projectId: string,
  taskId: string,
  conversationId: string,
  t: Translate
): Promise<void> {
  const toastId = toast.loading(t('tasks.tabs.creatingPublicShare'));
  try {
    const share = await rpc.sessionShares.create(projectId, taskId, conversationId);
    const copied = await rpc.app.clipboardWriteText(share.url);
    toast.success(
      t(copied.success ? 'tasks.tabs.publicShareCopied' : 'tasks.tabs.publicShareCreated'),
      {
        id: toastId,
        description:
          share.omittedAssetCount > 0
            ? t('tasks.tabs.publicShareAssetsPartial', {
                uploaded: share.assetCount,
                omitted: share.omittedAssetCount,
              })
            : share.assetCount > 0
              ? t('tasks.tabs.publicShareAssetsUploaded', { count: share.assetCount })
              : copied.success
                ? undefined
                : t('tasks.tabs.publicShareCopyFailed'),
        action: {
          label: t('common.open'),
          onClick: () => void rpc.app.openExternal(share.url),
        },
      }
    );
  } catch (error) {
    log.warn('AppTabContextMenu: create public session share failed', {
      projectId,
      taskId,
      conversationId,
      error,
    });

    let description = t('tasks.tabs.publicShareFailedDescription');
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      'code' in error &&
      'message' in error
    ) {
      const e = error as { status: number; code: string; message: string };
      description = `${e.message} (${e.status} ${e.code})`;
    } else if (error instanceof Error) {
      description = error.message;
    }

    toast.error(t('tasks.tabs.publicShareFailed'), {
      id: toastId,
      description,
      action: {
        label: t('common.copy'),
        onClick: () => {
          const text = typeof description === 'string' ? description : String(description);
          void rpc.app.clipboardWriteText(text);
        },
      },
    });
  }
}

/** Archive submenu — direct / run skill then archive / configure skill. */
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

/** Move a top-level tab into the task sidebar; returns the new internal tab id. */
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

/** Move a top-level tab into the cross-route shell side pane. */
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

/** Ensures the internal tab entry exists for a target and returns its id. */
async function ensureInternalTab(
  provisioned: ProvisionedTask,
  tabManager: TabManagerStore,
  target: TaskWindowTabTarget
): Promise<string | undefined> {
  let internalId = findInternalTabId(tabManager, target);
  if (!internalId) {
    const bridge = tabManager.topLevelBridge;
    const key = JSON.stringify(target);
    const token = Symbol(key);
    if (bridge) bridge.applying = { key, token };
    try {
      await openProvisionedTaskTab(provisioned, target);
    } finally {
      if (bridge?.applying?.token === token) bridge.applying = null;
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
        onRefresh={() => refreshProjectFile(null, filePath)}
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
      onRefresh={() => refreshProjectFile(projectId, filePath)}
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
