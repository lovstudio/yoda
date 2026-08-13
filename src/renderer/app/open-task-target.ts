import { when } from 'mobx';
import type { Conversation } from '@shared/conversations';
import type { DeepLinkTarget } from '@shared/deep-links';
import type { TaskWindowTabTarget, TaskWindowTarget } from '@shared/task-window';
import type { ActiveFile } from '@shared/view-state';
import type { TabDragPayload } from '@renderer/app/tab-drag';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  OVERVIEW_TAB_ID,
  type TabManagerStore,
} from '@renderer/features/tasks/tabs/tab-manager-store';
import { rpc } from '@renderer/lib/ipc';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { tabScopeKey, type AppTabEntry } from '@renderer/lib/stores/app-tabs-store';
import { log } from '@renderer/utils/logger';

/**
 * Tracks only unresolved shells created by immediate callers. A newer opener
 * can adopt the same entity by replacing/clearing the token, so an older async
 * lookup never rolls that newer tab back by identity alone.
 */
const provisionalConversationOwners = new WeakMap<TabManagerStore, Map<string, symbol>>();

function conversationOwnerMap(tabManager: TabManagerStore): Map<string, symbol> {
  let owners = provisionalConversationOwners.get(tabManager);
  if (!owners) {
    owners = new Map();
    provisionalConversationOwners.set(tabManager, owners);
  }
  return owners;
}

/**
 * Opens (or focuses — routes are deduplicated) a top-level app tab for an
 * internal task tab target. The task view's TopLevelTabSync replays the target
 * onto the internal TabManagerStore once the route applies. With
 * `activate: false` the tab is only ensured in the strip, in the background.
 */
export function openTaskTopTab(
  projectId: string,
  taskId: string,
  tab: TaskWindowTabTarget,
  options?: { activate?: boolean }
): void {
  appState.appTabs.openTab('task', { projectId, taskId, tab }, options);
}

/**
 * Closes a top-level tab; for task tabs, the matching internal TabManagerStore
 * entry closes first. Without the internal close the entity would stay the
 * task's active internal tab, and the scope-entry restore in TopLevelTabSync
 * would resurrect the top-level tab in the same frame (the × appearing dead).
 * Non-task tabs fall through to a plain top-level close.
 */
export function closeTaskTopTab(tab: AppTabEntry): void {
  const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
  const target = tab.params.tab as TaskWindowTabTarget | undefined;
  if (tab.viewId === 'task' && projectId && taskId && target && target.kind !== 'overview') {
    const tabManager = asProvisioned(getTaskStore(projectId, taskId))?.taskView.tabManager;
    const internalId = tabManager ? findInternalTabId(tabManager, target) : undefined;
    if (tabManager && internalId) tabManager.closeTab(internalId);
  }
  appState.appTabs.closeTab(tab.id);
}

/**
 * Drop-zone handler shared by the top strip and the central column: a moved
 * entity (task-sidebar pin or shell-pane pin) returns to its scope's strip; a
 * shell view/overview pin reopens its tab there and unpins.
 *
 * Browser semantics: the dropped tab's CONTENT renders immediately, but the
 * tab row stays put — a cross-scope tab is stuck into the current strip
 * first (see AppTabsStore.stickTab / stripScope), then activated, so the
 * strip never swaps to the destination scope's own set.
 */
export function moveDraggedTabToStrip(payload: TabDragPayload): void {
  if (payload.kind === 'shell-pin') {
    const { pin } = payload;
    if (pin.kind === 'view') {
      appState.appTabs.openTab(pin.viewId, pin.params, { activate: false });
      stickWhenBackground(pin.viewId, pin.params);
      appState.appTabs.openTab(pin.viewId, pin.params, { activate: true });
    } else {
      const target = { kind: 'overview' } as const;
      openTaskTopTab(pin.projectId, pin.taskId, target, { activate: false });
      stickWhenBackground('task', { projectId: pin.projectId, taskId: pin.taskId, tab: target });
      openTaskTopTab(pin.projectId, pin.taskId, target, { activate: true });
    }
    appState.sidePane.unpin(pin.id);
    return;
  }
  if (payload.kind !== 'task-entity' || !payload.tabId) return;
  const { projectId, taskId, target } = payload;
  const tabManager = asProvisioned(getTaskStore(projectId, taskId))?.taskView.tabManager;
  if (!tabManager) return;
  if (payload.from === 'taskSidebar') tabManager.moveSidebarTabBack(payload.tabId);
  if (payload.from === 'shellPane') {
    tabManager.moveShellPinBack(payload.tabId);
    if (payload.pinId) appState.sidePane.unpin(payload.pinId);
  }
  openTaskTopTab(projectId, taskId, target, { activate: false });
  stickWhenBackground('task', { projectId, taskId, tab: target });
  openTaskTopTab(projectId, taskId, target, { activate: true });
}

/**
 * A tab dropped while another scope is visible would swap the whole strip on
 * activation — stick it first so it coexists in the current strip instead.
 */
function stickWhenBackground(viewId: string, params: Record<string, unknown>): void {
  const { currentViewId, viewParamsStore } = appState.navigation;
  const activeScope = tabScopeKey(
    currentViewId,
    (viewParamsStore[currentViewId] ?? {}) as Record<string, unknown>
  );
  if (tabScopeKey(viewId, params) === activeScope) return;
  appState.appTabs.stickTab(viewId, params);
}

/** Resolves a top-level tab target to the matching internal tab id, if open. */
export function findInternalTabId(
  tabManager: TabManagerStore,
  target: TaskWindowTabTarget
): string | undefined {
  for (const resolved of tabManager.resolvedTabs) {
    if (
      target.kind === 'conversation' &&
      resolved.kind === 'conversation' &&
      resolved.conversationId === target.conversationId
    ) {
      return resolved.tabId;
    }
    if (
      target.kind === 'room-member' &&
      resolved.kind === 'room-member' &&
      resolved.memberId === target.memberId
    ) {
      return resolved.tabId;
    }
    if (target.kind === 'file' && resolved.kind === 'file' && resolved.path === target.path) {
      return resolved.tabId;
    }
    if (
      target.kind === 'diff' &&
      resolved.kind === 'diff' &&
      resolved.path === target.path &&
      resolved.diffGroup === target.diffGroup
    ) {
      return resolved.tabId;
    }
  }
  return undefined;
}

export type OpenTaskTarget = {
  projectId: string;
  taskId?: DeepLinkTarget['taskId'];
  conversationId?: DeepLinkTarget['conversationId'];
  promptId?: DeepLinkTarget['promptId'];
  promptIndex?: DeepLinkTarget['promptIndex'];
};

export function openTaskTarget(
  target: OpenTaskTarget,
  navigate: NavigateFnTyped,
  disposers?: Set<() => void>,
  tabTarget?: TaskWindowTabTarget
): void {
  const { projectId, taskId, conversationId, promptId, promptIndex } = target;
  if (!taskId) {
    navigate('project', { projectId });
    void prepareTaskTarget(projectId).catch((error: unknown) => {
      log.warn('openTaskTarget: failed to mount project', { projectId, error });
    });
    return;
  }
  navigate('task', { projectId, taskId });
  // A deep link / notification can target a task whose project isn't mounted
  // yet; navigate() only sets the route, so mount here. mountProject auto-
  // provisions the task that the current nav route points at (no-op if the
  // project is already mounted), which is what `when()` below waits for.
  void prepareTaskTarget(projectId, taskId).catch((error: unknown) => {
    log.warn('openTaskTarget: failed to mount project', { projectId, taskId, error });
  });
  const targetTab: TaskWindowTabTarget | null =
    tabTarget ?? (conversationId ? { kind: 'conversation', conversationId } : null);
  if (!targetTab) return;

  const dispose = when(
    () => Boolean(asProvisioned(getTaskStore(projectId, taskId))),
    () => {
      disposers?.delete(dispose);
      const provisioned = asProvisioned(getTaskStore(projectId, taskId));
      if (!provisioned) return;

      void openProvisionedTaskTab(provisioned, targetTab)
        .then((found) => {
          if (!found) return;

          if (targetTab.kind === 'conversation' && (promptId || promptIndex)) {
            // Prompts now live in the dedicated Conversation chapter; open it.
            provisioned.taskView.setSidebarCollapsed(false);
            provisioned.taskView.setSidebarTab('conversations');
          }
        })
        .catch((error: unknown) => {
          log.warn('openTaskTarget: failed to open tab target', {
            projectId,
            taskId,
            tabTarget: targetTab,
            error,
          });
        });
    },
    { timeout: 10_000 }
  );
  disposers?.add(dispose);
}

export async function prepareTaskTarget(projectId: string, taskId?: string): Promise<void> {
  const projectManager = getProjectManagerStore();
  const projectLoaded = await projectManager.ensureProjectLoaded(projectId);
  if (!projectLoaded) return;

  await projectManager.mountProject(projectId);
  if (!taskId) return;

  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) return;
  const taskLoaded = await taskManager.ensureTaskLoaded(taskId);
  if (taskLoaded) await taskManager.provisionTask(taskId);
}

export function openTaskWindowTarget(
  target: TaskWindowTarget,
  navigate: NavigateFnTyped,
  disposers?: Set<() => void>
): void {
  openTaskTarget(
    {
      projectId: target.projectId,
      taskId: target.taskId,
      conversationId: target.tab.kind === 'conversation' ? target.tab.conversationId : undefined,
    },
    navigate,
    disposers,
    target.tab
  );
}

type OpenProvisionedTaskTabOptions = {
  shouldApply?: () => boolean;
  /**
   * Selects an already-owned route target without forwarding the same intent
   * back through the top-level tab bridge. The guard is deliberately scoped
   * to each synchronous TabManager mutation; it never spans hydration awaits,
   * so a real user tab click can still supersede a staged task open.
   */
  topLevelMode?: 'normal' | 'internal';
};

export type DeferredTaskTabSelection = {
  /** Whether the active or archived target exists. */
  found: boolean;
  /**
   * Applies the prepared target synchronously. Returns false when the request
   * was superseded before commit or the target did not exist.
   */
  activate: () => boolean;
};

type DeferredTaskTabOptions = OpenProvisionedTaskTabOptions & {
  /** Hydrate and validate the target without changing the selected tab. */
  deferSelection: true;
};

type ImmediateTaskTabOptions = OpenProvisionedTaskTabOptions & {
  deferSelection?: false;
};

export function openProvisionedTaskTab(
  provisioned: ProvisionedTask,
  tabTarget: TaskWindowTabTarget,
  options: DeferredTaskTabOptions
): Promise<DeferredTaskTabSelection>;
export function openProvisionedTaskTab(
  provisioned: ProvisionedTask,
  tabTarget: TaskWindowTabTarget,
  options?: ImmediateTaskTabOptions
): Promise<boolean>;
export async function openProvisionedTaskTab(
  provisioned: ProvisionedTask,
  tabTarget: TaskWindowTabTarget,
  options?: DeferredTaskTabOptions | ImmediateTaskTabOptions
): Promise<boolean | DeferredTaskTabSelection> {
  const shouldApply = options?.shouldApply ?? (() => true);
  const deferSelection = options?.deferSelection === true;
  const applyTabMutation = <T>(mutation: () => T): T => {
    if (options?.topLevelMode !== 'internal') return mutation();

    const bridge = provisioned.taskView.tabManager.topLevelBridge;
    if (!bridge) return mutation();

    const previous = bridge.applying;
    const token = Symbol('staged-task-target');
    bridge.applying = { key: JSON.stringify(tabTarget), token };
    try {
      return mutation();
    } finally {
      if (bridge.applying?.token === token) bridge.applying = previous;
    }
  };
  const deferredSelection = (
    found: boolean,
    activateTarget?: () => void
  ): DeferredTaskTabSelection => ({
    found,
    activate: () => {
      if (!found || !activateTarget || !shouldApply()) return false;
      activateTarget();
      return true;
    },
  });
  const cancelledResult = (): boolean | DeferredTaskTabSelection =>
    deferSelection ? deferredSelection(true) : true;
  const applyOrDefer = (activateTarget: () => void): boolean | DeferredTaskTabSelection => {
    if (deferSelection) return deferredSelection(true, activateTarget);
    activateTarget();
    return true;
  };
  // A cancelled replay is already superseded, not a missing target. Report a
  // successful no-op so its caller never removes the newer route as dangling.
  if (!shouldApply()) return cancelledResult();

  switch (tabTarget.kind) {
    case 'overview':
      return applyOrDefer(() => {
        applyTabMutation(() => provisioned.taskView.tabManager.setActiveTab(OVERVIEW_TAB_ID));
        provisioned.taskView.setFocusedRegion('main');
      });
    case 'conversation': {
      const { tabManager } = provisioned.taskView;
      const hadTab = tabManager.hasConversationTab(tabTarget.conversationId);
      const owners = conversationOwnerMap(tabManager);
      const existingOwner = owners.get(tabTarget.conversationId);
      const hasHydratedConversation = provisioned.conversations.conversations.has(
        tabTarget.conversationId
      );
      const provisionalToken =
        !deferSelection && (!hadTab || !hasHydratedConversation || existingOwner) ? Symbol() : null;
      const releaseProvisional = (close: boolean): void => {
        if (!provisionalToken || owners.get(tabTarget.conversationId) !== provisionalToken) return;
        owners.delete(tabTarget.conversationId);
        if (close) tabManager.closeConversation(tabTarget.conversationId);
      };
      // Direct deep-link and replay callers retain their immediate stable shell.
      // Explicit task opening defers this mutation until its hot/staging commit,
      // so the source task remains completely intact during target hydration.
      if (!deferSelection) {
        if (provisionalToken) owners.set(tabTarget.conversationId, provisionalToken);
        applyTabMutation(() => tabManager.openConversation(tabTarget.conversationId));
      }
      const found = await provisioned.conversations.ensureConversation(tabTarget.conversationId);
      if (!shouldApply()) {
        releaseProvisional(true);
        return cancelledResult();
      }
      if (!found) {
        if (!deferSelection) {
          // The entry above is only provisional until the active snapshot proves
          // that the conversation exists. Remove it before opening an archived
          // transcript or closing a dangling target.
          releaseProvisional(true);
        }
        const archived = await findArchivedConversation(provisioned, tabTarget.conversationId);
        if (!shouldApply()) return cancelledResult();
        if (!archived) return deferSelection ? deferredSelection(false) : false;
        return applyOrDefer(() => openArchivedConversationFallback(provisioned, archived));
      }
      return applyOrDefer(() => {
        if (deferSelection) {
          // The final commit adopts any unresolved immediate shell for this
          // entity before opening it, revoking an older request's cleanup right.
          owners.delete(tabTarget.conversationId);
          applyTabMutation(() => tabManager.openConversation(tabTarget.conversationId));
        } else {
          releaseProvisional(false);
        }
        provisioned.taskView.setFocusedRegion('main');
      });
    }
    case 'room-member':
      return applyOrDefer(() => {
        applyTabMutation(() => provisioned.taskView.tabManager.openRoomMember(tabTarget.memberId));
        provisioned.taskView.setFocusedRegion('main');
      });
    case 'file':
      return applyOrDefer(() => {
        applyTabMutation(() => provisioned.taskView.tabManager.openFile(tabTarget.path));
        provisioned.taskView.setFocusedRegion('main');
      });
    case 'diff':
      return applyOrDefer(() => {
        applyTabMutation(() =>
          provisioned.taskView.tabManager.openDiff(
            diffTargetToActiveFile(tabTarget),
            tabTarget.status
          )
        );
        provisioned.taskView.setFocusedRegion('main');
      });
  }
}

async function findArchivedConversation(
  provisioned: ProvisionedTask,
  conversationId: string
): Promise<Conversation | undefined> {
  const archived = await rpc.conversations.getArchivedConversationsForTask(
    provisioned.projectId,
    provisioned.taskId
  );
  return archived.find((row) => row.id === conversationId);
}

function openArchivedConversationFallback(
  provisioned: ProvisionedTask,
  conversation: Conversation
): void {
  provisioned.taskView.setSidebarCollapsed(false);
  provisioned.taskView.setSidebarTab('conversations');
  provisioned.taskView.setFocusedRegion('main');
  showModal('archivedSessionTranscriptModal', { conversation });
}

function diffTargetToActiveFile(
  tabTarget: Extract<TaskWindowTabTarget, { kind: 'diff' }>
): ActiveFile {
  return {
    path: tabTarget.path,
    type: tabTarget.diffGroup === 'disk' ? 'disk' : 'git',
    group: tabTarget.diffGroup,
    originalRef: tabTarget.originalRef,
    modifiedRef: tabTarget.modifiedRef,
    prNumber: tabTarget.prNumber,
  };
}
