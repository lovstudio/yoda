import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  taskWindowAssignTargetChannel,
  taskWindowReturnedToTabChannel,
} from '@shared/events/appEvents';
import type { TaskWindowTabTarget, TaskWindowTarget } from '@shared/task-window';
import { openProvisionedTaskTab } from '@renderer/app/open-task-target';
import { CommandShortcutBinder } from '@renderer/lib/commands/command-shortcut-binder';
import { ErrorBoundary } from '@renderer/lib/components/error-boundary';
import { MonacoKeyboardBridge } from '@renderer/lib/components/monaco-keyboard-bridge';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import i18n from '@renderer/lib/i18n';
import { events, rpc } from '@renderer/lib/ipc';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import {
  assignTaskWindowTarget,
  getTaskWindowLaunchTarget,
} from '@renderer/lib/task-window-launch-target';
import { Toaster } from '@renderer/lib/ui/toaster';
import { log } from '@renderer/utils/logger';
import { formatConversationTitleForDisplay } from './conversations/conversation-title-utils';
import { TaskActiveTabContent } from './main-panel';
import {
  getTaskStore,
  taskErrorMessage,
  taskViewKind,
  type TaskViewKind,
} from './stores/task-selectors';
import type { ResolvedTab } from './tabs/tab-manager-store';
import { useProvisionedTask } from './task-view-context';
import { TaskViewWrapperWithProviders } from './view';

export const TaskTabWindow = observer(function TaskTabWindow() {
  useTheme();

  // A pre-warmed window boots this shell empty and waits for the main process to
  // assign its target, so tearing out a tab reuses an already-booted renderer
  // instead of cold-starting one.
  useEffect(() => {
    return events.on(taskWindowAssignTargetChannel, (target) => {
      assignTaskWindowTarget(target);
    });
  }, []);

  const target = getTaskWindowLaunchTarget();

  // Parked warm window: shell + providers are mounted, just nothing to show yet.
  if (!target) {
    return <div className="h-screen w-screen bg-background" />;
  }

  return (
    <>
      <CommandShortcutBinder />
      <MonacoKeyboardBridge />
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <TaskViewWrapperWithProviders projectId={target.projectId} taskId={target.taskId}>
          <ErrorBoundary variant="inline" componentName="TaskTabWindow">
            <TaskTabWindowContent target={target} />
          </ErrorBoundary>
          <ErrorBoundary variant="inline" componentName="ModalRenderer">
            <ModalRenderer />
          </ErrorBoundary>
        </TaskViewWrapperWithProviders>
      </div>
      <Toaster />
    </>
  );
});

const TaskTabWindowContent = observer(function TaskTabWindowContent({
  target,
}: {
  target: TaskWindowTarget;
}) {
  const taskStore = getTaskStore(target.projectId, target.taskId);
  const kind = taskViewKind(taskStore, target.projectId);

  if (kind !== 'ready') {
    return <TaskTabWindowStatus kind={kind} target={target} />;
  }

  return <ReadyTaskTabWindow target={target} />;
});

const ReadyTaskTabWindow = observer(function ReadyTaskTabWindow({
  target,
}: {
  target: TaskWindowTarget;
}) {
  const provisioned = useProvisionedTask();
  const { taskView } = provisioned;
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);
  const targetTab = taskView.tabManager.resolvedTabs.find((tab) =>
    resolvedTabMatchesTarget(tab, target.tab)
  );
  const title = targetTab
    ? formatTaskWindowTabTitle(targetTab)
    : fallbackTaskWindowTabTitle(target);

  useEffect(() => {
    void openProvisionedTaskTab(provisioned, target.tab)
      .then((found) => {
        if (found) return;
        log.warn('TaskTabWindow: target tab was not found', {
          projectId: target.projectId,
          taskId: target.taskId,
          tab: target.tab,
        });
      })
      .catch((error: unknown) => {
        log.warn('TaskTabWindow: failed to open target tab', {
          projectId: target.projectId,
          taskId: target.taskId,
          tab: target.tab,
          error,
        });
      });
  }, [provisioned, target]);

  useEffect(() => {
    let isMounted = true;
    void window.electronAPI.getCurrentWindowId().then((id) => {
      if (isMounted) setCurrentWindowId(id);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!currentWindowId) return;
    return events.on(taskWindowReturnedToTabChannel, (payload) => {
      if (payload.sourceWindowId !== currentWindowId) return;
      void window.electronAPI.closeCurrentWindow();
    });
  }, [currentWindowId]);

  // Register this window's dock target with the main process so that, while the
  // user drags the real OS window over the main window's task tab strip, the
  // main process can dock the tab back instead of leaving a floating window.
  useEffect(() => {
    if (!currentWindowId) return;
    void rpc.app.registerTaskWindowDock({ sourceWindowId: currentWindowId, target });
    return () => {
      void rpc.app.unregisterTaskWindowDock(currentWindowId);
    };
  }, [currentWindowId, target]);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      onFocus={() => taskView.setFocusedRegion('main')}
      onPointerDown={() => taskView.setFocusedRegion('main')}
    >
      {/*
        The whole title bar is a native `-webkit-app-region: drag` region, so
        dragging anywhere on it moves the real OS window (the intuitive default).
        "Dock back to the main window's tab strip" is detected by the main
        process while the window is dragged over the strip — see the dock
        registration effect above — so no separate HTML5 drag handle is needed.
        The left padding also clears the macOS traffic lights.
      */}
      <div
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background-secondary pl-20 pr-2 dark:bg-background [-webkit-app-region:drag]"
        title={title}
      >
        <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden />
        <span className="min-w-0 truncate text-xs font-medium text-foreground-muted">{title}</span>
      </div>
      <TaskActiveTabContent />
    </div>
  );
});

function resolvedTabMatchesTarget(tab: ResolvedTab, target: TaskWindowTabTarget): boolean {
  switch (target.kind) {
    case 'overview':
      return tab.kind === 'overview';
    case 'conversation':
      return tab.kind === 'conversation' && tab.conversationId === target.conversationId;
    case 'file':
      return tab.kind === 'file' && tab.path === target.path;
    case 'diff':
      return tab.kind === 'diff' && tab.path === target.path && tab.diffGroup === target.diffGroup;
  }
}

function formatTaskWindowTabTitle(tab: ResolvedTab): string {
  switch (tab.kind) {
    case 'overview':
      return i18n.t('tasks.tabs.overview');
    case 'conversation':
      return (
        formatConversationTitleForDisplay(tab.store.data.runtimeId, tab.store.data.title).trim() ||
        tab.store.data.runtimeId
      );
    case 'file':
    case 'diff':
      return tab.path;
  }
}

function fallbackTaskWindowTabTitle(target: TaskWindowTarget): string {
  switch (target.tab.kind) {
    case 'overview':
      return i18n.t('tasks.tabs.overview');
    case 'conversation':
      return target.tab.conversationId;
    case 'file':
    case 'diff':
      return target.tab.path;
  }
}

const TaskTabWindowStatus = observer(function TaskTabWindowStatus({
  kind,
  target,
}: {
  kind: TaskViewKind;
  target: TaskWindowTarget;
}) {
  const { t } = useTranslation();
  const taskStore = getTaskStore(target.projectId, target.taskId);
  const status = getTaskTabWindowStatus(kind, t, taskStore);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
      {status.isBusy ? <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" /> : null}
      <p
        className={
          status.isError
            ? 'text-sm font-medium text-foreground-destructive'
            : 'text-xs font-mono text-foreground-muted'
        }
      >
        {status.title}
      </p>
      {status.description ? (
        <p className="max-w-sm text-xs text-foreground-muted">{status.description}</p>
      ) : null}
    </div>
  );
});

function getTaskTabWindowStatus(
  kind: TaskViewKind,
  t: TFunction,
  taskStore: ReturnType<typeof getTaskStore>
): { title: string; description?: string; isBusy: boolean; isError: boolean } {
  if (kind === 'creating') {
    return { title: t('tasks.creatingTask'), isBusy: true, isError: false };
  }

  if (kind === 'naming') {
    const setupRequiresBranchName = taskStore?.data.setupRequiresBranchName === true;
    return {
      title:
        taskStore?.provisionProgressMessage ??
        t(
          setupRequiresBranchName ? 'tasks.generatingTaskNameAndBranch' : 'tasks.generatingTaskName'
        ),
      isBusy: true,
      isError: false,
    };
  }

  if (
    kind === 'project-mounting' ||
    kind === 'provisioning' ||
    kind === 'idle' ||
    kind === 'teardown'
  ) {
    return {
      title: taskStore?.provisionProgressMessage ?? t('tasks.settingUpWorkspace'),
      isBusy: true,
      isError: false,
    };
  }

  if (kind === 'create-error') {
    return {
      title: t('tasks.errorCreatingTask'),
      description: taskErrorMessage(taskStore),
      isBusy: false,
      isError: true,
    };
  }

  if (kind === 'naming-error') {
    const title =
      taskStore?.data.setupStatus === 'branch_failed'
        ? t('tasks.branchSetupFailed')
        : t('tasks.namingFailed');
    return {
      title,
      description: taskErrorMessage(taskStore),
      isBusy: false,
      isError: true,
    };
  }

  if (kind === 'provision-error' || kind === 'project-error') {
    return {
      title: t('tasks.failedSetUpWorkspace'),
      description: taskErrorMessage(taskStore),
      isBusy: false,
      isError: true,
    };
  }

  if (kind === 'teardown-error') {
    return {
      title: t('tasks.failedTearDownWorkspace'),
      description: taskErrorMessage(taskStore),
      isBusy: false,
      isError: true,
    };
  }

  return {
    title: t('tasks.taskUnavailable'),
    isBusy: false,
    isError: true,
  };
}
