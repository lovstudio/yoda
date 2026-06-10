import {
  AppWindow,
  Archive,
  ArrowRightToLine,
  CopyX,
  Link,
  ListX,
  PanelRight,
  Pencil,
  RefreshCw,
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
import {
  archiveConversationWithPreCommand,
  archiveTaskIfNoConversationsLeft,
} from '@renderer/features/tasks/archive-task';
import { copyTaskLink } from '@renderer/features/tasks/components/task-context-menu';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { openTaskTabInWindow } from '@renderer/features/tasks/tabs/tab-meta';
import { FilePathMenuItems, type FilePathTarget } from '@renderer/lib/components/file-path-actions';
import { APP_SHORTCUTS } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { isIndexTab, type AppTabEntry } from '@renderer/lib/stores/app-tabs-store';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { log } from '@renderer/utils/logger';

/**
 * Right-click menu for top-level app tabs, built as sections separated
 * automatically. Section order follows frequency, with the destructive
 * lifecycle action isolated at the bottom:
 *
 *   conversation tabs: actions (rename / copy link)
 *                      → placement (pin to sidebar / open in window)
 *                      → close group → lifecycle (reload / archive, always last)
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
    return [buildProjectFileSection(tab), buildCloseSection(tab, t)];
  }
  return [buildCloseSection(tab, t)];
}

// ---------------------------------------------------------------------------
// Task tabs (sessions, worktree files, diffs)
// ---------------------------------------------------------------------------

function buildTaskSections(tab: AppTabEntry, t: Translate): ReactNode[][] {
  const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
  const target = (tab.params.tab as TaskWindowTabTarget | undefined) ?? { kind: 'overview' };
  if (!projectId || !taskId) return [];
  // The index tab itself isn't closeable, but it's a natural place to sweep
  // the rest of the strip from.
  if (target.kind === 'overview') return [buildCloseSection(tab, t)];

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
    const [actions, lifecycle] = buildConversationSections(
      provisioned,
      projectId,
      taskId,
      target.conversationId,
      t
    );
    return [actions ?? [], placement, buildCloseSection(tab, t), lifecycle ?? []];
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
 * Conversation menu sections (actions + lifecycle), shared between the
 * top-level tab strip and the task sidebar's pinned chips.
 */
export function buildConversationSections(
  provisioned: ProvisionedTask | undefined,
  projectId: string,
  taskId: string,
  conversationId: string,
  t: Translate
): ReactNode[][] {
  const actions: ReactNode[] = [];
  if (provisioned) {
    actions.push(
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
  }
  actions.push(
    <ContextMenuItem
      key="copy-link"
      className="whitespace-nowrap"
      onClick={() => void copyTaskLink(buildTaskDeepLink({ projectId, taskId, conversationId }), t)}
    >
      <Link className="size-4" />
      {t('tasks.tabs.copyYodaLink')}
    </ContextMenuItem>
  );

  // Lifecycle section: reload (rare recovery action) and archive — both act
  // on the session as a whole, kept at the bottom away from the daily items.
  const lifecycle: ReactNode[] = [];
  if (provisioned) {
    lifecycle.push(
      <ContextMenuItem
        key="reload"
        className="whitespace-nowrap"
        onClick={() => void provisioned.conversations.restartConversation(conversationId)}
      >
        <RefreshCw className="size-4" />
        {t('tasks.tabs.reloadConversation')}
      </ContextMenuItem>
    );
    // Archiving always runs the configured pre-archive command (when set) —
    // the plain close (×) is the no-command path.
    const archiveConversation = () => {
      if (provisioned.conversations.conversations.get(conversationId)?.isArchiving) return;
      void (async () => {
        try {
          await archiveConversationWithPreCommand(projectId, taskId, conversationId);
          await archiveTaskIfNoConversationsLeft(projectId, taskId);
        } catch (error) {
          log.warn('AppTabContextMenu: archive conversation failed', {
            projectId,
            taskId,
            conversationId,
            error,
          });
        }
      })();
    };
    lifecycle.push(
      <ContextMenuItem key="archive" className="whitespace-nowrap" onClick={archiveConversation}>
        <Archive className="size-4" />
        {t('tasks.tabs.archiveConversation')}
      </ContextMenuItem>
    );
  }

  return [actions, lifecycle];
}

/**
 * Pins a top-level task tab into the task sidebar strip: ensures the internal
 * tab entry exists (replaying the target below the bridge), moves it into the
 * sidebar, then closes the top-level tab — the entity now lives in the
 * sidebar, not the strip.
 */
async function moveTopTabToSidebar(
  tab: AppTabEntry,
  provisioned: ProvisionedTask,
  target: TaskWindowTabTarget
): Promise<void> {
  const tabManager = provisioned.taskView.tabManager;

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
  if (!internalId) return;

  tabManager.moveTabToSidebar(internalId);
  // Pinning while the sidebar is hidden would silently swallow the tab.
  provisioned.taskView.setSidebarCollapsed(false);
  appState.appTabs.closeTab(tab.id);
}

// ---------------------------------------------------------------------------
// Project-root file tabs
// ---------------------------------------------------------------------------

function buildProjectFileSection(tab: AppTabEntry): ReactNode[] {
  const { projectId, filePath } = tab.params as { projectId?: string; filePath?: string };
  if (!projectId || !filePath) return [];
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
