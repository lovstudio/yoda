import { AppWindow, ArrowLeftToLine, PanelRight, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildConversationSections,
  fileTarget,
  moveTopTabToShellPane,
} from '@renderer/app/app-tab-context-menu';
import { describeTab } from '@renderer/app/app-tab-strip';
import { closeTaskTopTab, openTaskTopTab } from '@renderer/app/open-task-target';
import {
  tabDragSource,
  tabDropIndex,
  useTabDropZone,
  type TabDragPayload,
} from '@renderer/app/tab-drag';
import {
  views,
  type ViewDefinition,
  type ViewId,
  type WrapParams,
} from '@renderer/app/view-registry';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { OVERVIEW_TAB_ID } from '@renderer/features/tasks/tabs/tab-manager-store';
import {
  buildTaskWindowTarget,
  getTabMeta,
  openTaskTabInWindow,
} from '@renderer/features/tasks/tabs/tab-meta';
import {
  ProvisionedTaskProvider,
  TaskViewWrapper,
  useProvisionedTask,
} from '@renderer/features/tasks/task-view-context';
import { SidebarPinnedContent } from '@renderer/features/tasks/view/sidebar-pinned-content';
import { ChipContextMenu } from '@renderer/lib/components/chip-context-menu';
import { FilePathMenuItems } from '@renderer/lib/components/file-path-actions';
import { SidebarChip } from '@renderer/lib/components/sidebar-chip';
import {
  useNavigate,
  ViewParamsOverrideProvider,
  type ViewParamsOverride,
} from '@renderer/lib/layout/navigation-provider';
import type { SidePanePin } from '@renderer/lib/stores/app-side-pane-store';
import { appState } from '@renderer/lib/stores/app-state';
import { isIndexTab, type AppTabEntry } from '@renderer/lib/stores/app-tabs-store';
import { ContextMenuItem, ContextMenuSeparator } from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';

/**
 * Shell-level (cross-route) side pane: hosts pins of any top-level tab — task
 * entities (session/file/diff/overview) and arbitrary views (settings, project
 * pages, project files). A first-class workspace column; navigating the main
 * area never unmounts it, so pinned sessions keep running. Complements the
 * route-scoped task sidebar.
 */
export const AppSidePane = observer(function AppSidePane() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { value: projectSettings } = useAppSettingsKey('project');
  const branchPrefix = projectSettings?.branchPrefix ?? '';
  const { pins, activePinId, activePin } = appState.sidePane;

  // A moved task entity reclaimed by the main area (route replay, dedupe
  // reopen) leaves `shellPinTabIds` — drop its pin so no ghost chip remains.
  useEffect(() => {
    for (const pin of pins) {
      if (pin.kind !== 'task' || pin.tabId === OVERVIEW_TAB_ID) continue;
      const provisioned = asProvisioned(getTaskStore(pin.projectId, pin.taskId));
      if (!provisioned) continue;
      const { tabManager } = provisioned.taskView;
      if (!tabManager.entries.has(pin.tabId) || !tabManager.shellPinTabIds.includes(pin.tabId)) {
        appState.sidePane.unpin(pin.id);
      }
    }
  });

  // Closing a pin mirrors the task sidebar's policy: conversations return to
  // the strip as a background top-level tab so the session stays reachable;
  // files/diffs are stateless and just close; copies (views, overview) unpin.
  const closePin = (pin: SidePanePin) => {
    if (pin.kind === 'task' && pin.tabId !== OVERVIEW_TAB_ID) {
      const provisioned = asProvisioned(getTaskStore(pin.projectId, pin.taskId));
      const { tabManager } = provisioned?.taskView ?? {};
      const resolved = tabManager?.resolveTab(pin.tabId);
      if (tabManager && resolved && resolved.kind === 'conversation') {
        tabManager.moveShellPinBack(pin.tabId);
        openTaskTopTab(
          pin.projectId,
          pin.taskId,
          buildTaskWindowTarget(pin.projectId, pin.taskId, resolved).tab,
          { activate: false }
        );
      } else {
        tabManager?.closeTab(pin.tabId);
      }
    }
    appState.sidePane.unpin(pin.id);
  };

  const chipMeta = (pin: SidePanePin): { label: string; title?: string; icon: ReactNode } => {
    if (pin.kind === 'task' && pin.tabId !== OVERVIEW_TAB_ID) {
      const provisioned = asProvisioned(getTaskStore(pin.projectId, pin.taskId));
      const resolved = provisioned?.taskView.tabManager.resolveTab(pin.tabId);
      if (resolved) {
        const meta = getTabMeta(resolved);
        return { label: meta.label, title: meta.title, icon: meta.icon };
      }
      return { label: t('appTabs.task'), icon: null };
    }
    const entry: AppTabEntry =
      pin.kind === 'task'
        ? {
            id: pin.id,
            viewId: 'task',
            params: { projectId: pin.projectId, taskId: pin.taskId, tab: { kind: 'overview' } },
          }
        : { id: pin.id, viewId: pin.viewId, params: pin.params };
    return describeTab(entry, t, branchPrefix);
  };

  // Moved task entities drag as such (placeable in any area); copy-semantics
  // pins (views, overview) drag for in-pane reorder only.
  const dragPayload = (pin: SidePanePin): TabDragPayload => {
    if (pin.kind === 'task' && pin.tabId !== OVERVIEW_TAB_ID) {
      const resolved = asProvisioned(
        getTaskStore(pin.projectId, pin.taskId)
      )?.taskView.tabManager.resolveTab(pin.tabId);
      if (resolved && resolved.kind !== 'overview') {
        return {
          kind: 'task-entity',
          from: 'shellPane',
          projectId: pin.projectId,
          taskId: pin.taskId,
          tabId: pin.tabId,
          pinId: pin.id,
          target: buildTaskWindowTarget(pin.projectId, pin.taskId, resolved).tab,
        };
      }
    }
    return { kind: 'shell-pin', pinId: pin.id, pin };
  };

  // Right-click menu for a moved task entity pin, mirroring the task sidebar's
  // pinned chips: placement (back to strip / task sidebar / window), then
  // kind-specific actions. Copy-semantics pins keep the plain chip.
  const pinSections = (pin: SidePanePin): ReactNode[][] => {
    if (pin.kind !== 'task' || pin.tabId === OVERVIEW_TAB_ID) return [];
    const provisioned = asProvisioned(getTaskStore(pin.projectId, pin.taskId));
    const tabManager = provisioned?.taskView.tabManager;
    const resolved = tabManager?.resolveTab(pin.tabId);
    if (!provisioned || !tabManager || !resolved || resolved.kind === 'overview') return [];
    const target = buildTaskWindowTarget(pin.projectId, pin.taskId, resolved);

    const placement: ReactNode[] = [
      <ContextMenuItem
        key="move-back"
        className="whitespace-nowrap"
        onClick={() => {
          tabManager.moveShellPinBack(pin.tabId);
          appState.sidePane.unpin(pin.id);
          openTaskTopTab(pin.projectId, pin.taskId, target.tab, { activate: false });
        }}
      >
        <ArrowLeftToLine className="size-4" />
        {t('tasks.sidePane.moveBack')}
      </ContextMenuItem>,
      <ContextMenuItem
        key="task-sidebar"
        className="whitespace-nowrap"
        onClick={() => {
          tabManager.moveShellPinBack(pin.tabId);
          tabManager.moveTabToSidebar(pin.tabId);
          appState.sidePane.unpin(pin.id);
          provisioned.taskView.setSidebarCollapsed(false);
          // The task sidebar is route-scoped — surface the destination.
          navigate('task', { projectId: pin.projectId, taskId: pin.taskId });
        }}
      >
        <PanelRight className="size-4" />
        {t('tasks.tabs.openInSidePane')}
      </ContextMenuItem>,
      <ContextMenuItem
        key="window"
        className="whitespace-nowrap"
        onClick={() => {
          void openTaskTabInWindow(target).then((opened) => {
            if (!opened) return;
            tabManager.closeTab(pin.tabId);
            appState.sidePane.unpin(pin.id);
          });
        }}
      >
        <AppWindow className="size-4" />
        {t('tasks.tabs.openInWindow')}
      </ContextMenuItem>,
    ];

    if (resolved.kind === 'conversation') {
      const [management, copy] = buildConversationSections(
        provisioned,
        pin.projectId,
        pin.taskId,
        resolved.conversationId,
        t
      );
      return [management ?? [], copy ?? [], placement];
    }

    // file / diff — path actions plus the plain close.
    return [
      placement,
      [
        <FilePathMenuItems
          key="file-actions"
          target={fileTarget(
            provisioned.path,
            resolved.path,
            provisioned.workspace.sshConnectionId
          )}
          components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
        />,
      ],
      [
        <ContextMenuItem key="close" className="whitespace-nowrap" onClick={() => closePin(pin)}>
          <X className="size-4" />
          {t('common.close')}
        </ContextMenuItem>,
      ],
    ];
  };

  // The pane accepts task entities from anywhere (and its own pins for
  // reorder); dragging is move semantics throughout — a dropped view tab
  // leaves the strip (only the scope's fixed index tab stays as a copy).
  const dropZone = useTabDropZone({
    canDrop: (payload) =>
      payload.kind === 'task-entity' || payload.kind === 'view' || payload.kind === 'shell-pin',
    onDrop: (payload, event) => {
      const index = tabDropIndex(event, 'shell-pin');
      if (payload.kind === 'shell-pin') {
        appState.sidePane.reorderPin(payload.pinId, index);
        return;
      }
      if (payload.kind === 'view') {
        const tab = payload.appTab;
        const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
        if (tab.viewId === 'task' && projectId && taskId) {
          appState.sidePane.pinTask(projectId, taskId, OVERVIEW_TAB_ID);
        } else {
          appState.sidePane.pinView(tab.viewId, tab.params);
        }
        // The index tab is the scope's identity and never closes — its pin is
        // a copy; every other view tab moves.
        if (!isIndexTab(tab)) closeTaskTopTab(tab);
        // pinView/pinTask select the (possibly pre-existing) pin — position it.
        const pinId = appState.sidePane.activePinId;
        if (pinId) appState.sidePane.reorderPin(pinId, index);
        return;
      }
      // canDrop already excludes sidebar-group; this narrows the type.
      if (payload.kind !== 'task-entity') return;
      if (payload.from === 'shellPane' && payload.pinId) {
        appState.sidePane.reorderPin(payload.pinId, index);
        return;
      }
      const provisioned = asProvisioned(getTaskStore(payload.projectId, payload.taskId));
      if (!provisioned) return;
      if (payload.from === 'taskSidebar' && payload.tabId) {
        provisioned.taskView.tabManager.moveTabToShellPin(payload.tabId);
        appState.sidePane.pinTask(payload.projectId, payload.taskId, payload.tabId);
        const pinId = appState.sidePane.activePinId;
        if (pinId) appState.sidePane.reorderPin(pinId, index);
        return;
      }
      if (payload.from === 'strip' && payload.appTab) {
        void moveTopTabToShellPane(
          payload.appTab,
          provisioned,
          payload.projectId,
          payload.taskId,
          payload.target
        ).then((tabId) => {
          if (!tabId) return;
          const pinId = appState.sidePane.activePinId;
          if (pinId) appState.sidePane.reorderPin(pinId, index);
        });
      }
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background-secondary px-2 [-webkit-app-region:drag] dark:bg-background">
        <div
          ref={dropZone.dropRef}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-md',
            dropZone.isOver && 'bg-background-tertiary-1'
          )}
          style={{ scrollbarWidth: 'none' }}
        >
          {pins.map((pin) => {
            const meta = chipMeta(pin);
            return (
              <ChipContextMenu key={pin.id} sections={pinSections(pin)}>
                <SidebarChip
                  label={meta.label}
                  title={meta.title}
                  icon={meta.icon}
                  isActive={activePinId === pin.id}
                  closeLabel={t('common.close')}
                  onSelect={() => appState.sidePane.setActivePin(pin.id)}
                  onClose={() => closePin(pin)}
                  drag={tabDragSource(() => dragPayload(pin))}
                  dropMarker="shell-pin"
                />
              </ChipContextMenu>
            );
          })}
        </div>
        {/* The active pin's view can hang a control at the row's right end
            (e.g. the settings tab picker). */}
        {activePin?.kind === 'view' ? <PaneHeaderAccessory pin={activePin} /> : null}
        {/* Closes the whole pane: every pin goes through the per-pin close
            policy, so conversations flow back to the strip instead of dying. */}
        <button
          type="button"
          onClick={() => [...pins].forEach(closePin)}
          aria-label={t('appTabs.closeGlobalSidePane')}
          title={t('appTabs.closeGlobalSidePane')}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-passive hover:bg-background-2 hover:text-foreground [-webkit-app-region:no-drag]"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Each pin keeps its own Activity so background PTYs/views stay alive. */}
        {pins.map((pin) => (
          <Activity key={pin.id} mode={activePinId === pin.id ? 'visible' : 'hidden'}>
            {pin.kind === 'task' ? (
              <TaskViewWrapper projectId={pin.projectId} taskId={pin.taskId}>
                <ProvisionedTaskProvider projectId={pin.projectId} taskId={pin.taskId}>
                  <ShellPinnedTaskBody tabId={pin.tabId} />
                </ProvisionedTaskProvider>
              </TaskViewWrapper>
            ) : (
              <ViewPinHost pin={pin} />
            )}
          </Activity>
        ))}
      </div>
    </div>
  );
});

/** Resolves a task pin's internal entry and renders it through the shared pinned renderer. */
const ShellPinnedTaskBody = observer(function ShellPinnedTaskBody({ tabId }: { tabId: string }) {
  const provisioned = useProvisionedTask();
  const entry = provisioned.taskView.tabManager.entries.get(tabId);
  if (!entry) return null;
  return <SidebarPinnedContent entry={entry} />;
});

type ViewPin = Extract<SidePanePin, { kind: 'view' }>;

function viewDefinition(viewId: string): ViewDefinition<Record<string, unknown>> | undefined {
  return (views as unknown as Record<string, ViewDefinition<Record<string, unknown>>>)[viewId];
}

/** The pin's params override, shared by the body host and the header accessory. */
function usePinParamsOverride(pin: ViewPin): ViewParamsOverride {
  return useMemo(
    () => ({
      viewId: pin.viewId,
      getParams: () => pin.params,
      setParams: (params) => appState.sidePane.updatePinParams(pin.id, params),
    }),
    [pin]
  );
}

/**
 * Right-end slot of the chip-strip row: the active pinned view's
 * PaneHeaderSlot, rendered under the same WrapView + params override as its
 * body so hooks like useParams/useSettingsTab resolve to the pin.
 */
const PaneHeaderAccessory = observer(function PaneHeaderAccessory({ pin }: { pin: ViewPin }) {
  const def = viewDefinition(pin.viewId);
  const override = usePinParamsOverride(pin);
  if (!def?.PaneHeaderSlot) return null;

  const slot = <def.PaneHeaderSlot />;
  return (
    <div className="flex shrink-0 items-center [-webkit-app-region:no-drag]">
      <ViewParamsOverrideProvider value={override}>
        {def.WrapView ? (
          <def.WrapView {...(pin.params as WrapParams<ViewId>)}>{slot}</def.WrapView>
        ) : (
          slot
        )}
      </ViewParamsOverrideProvider>
    </div>
  );
});

/**
 * Generic host for a pinned view: renders the registered view's MainPanel
 * (inside its WrapView when defined) with params detached from the global
 * route via the override layer — the pane shows ITS pin's params even when
 * the main area navigates the same view elsewhere.
 */
const ViewPinHost = observer(function ViewPinHost({ pin }: { pin: ViewPin }) {
  const def = viewDefinition(pin.viewId);
  const override = usePinParamsOverride(pin);
  if (!def) return null;

  const content = <def.MainPanel />;
  return (
    // Flex column so MainPanels sized with flex-1 (the norm in
    // WorkspaceContentLayout) get a bounded height here too — otherwise inner
    // scroll areas grow past the pane and clip instead of scrolling.
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ViewParamsOverrideProvider value={override}>
        {def.WrapView ? (
          <def.WrapView {...(pin.params as WrapParams<ViewId>)}>{content}</def.WrapView>
        ) : (
          content
        )}
      </ViewParamsOverrideProvider>
    </div>
  );
});
