import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { standaloneKanbanPanesChangedChannel } from '@shared/events/appEvents';
import {
  STANDALONE_KANBAN_MIN_PANE_WIDTH,
  type StandaloneKanbanPane,
  type StandaloneKanbanWindowTarget,
} from '@shared/standalone-kanban-window';
import { openProvisionedTaskTab } from '@renderer/app/open-task-target';
import { EditorProvider } from '@renderer/features/tasks/editor/editor-provider';
import { useHostedTaskLifecycle } from '@renderer/features/tasks/hooks/use-hosted-task-lifecycle';
import {
  asProvisioned,
  getTaskStore,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { TaskViewWrapper } from '@renderer/features/tasks/task-view-context';
import { CommandShortcutBinder } from '@renderer/lib/commands/command-shortcut-binder';
import { ErrorBoundary } from '@renderer/lib/components/error-boundary';
import { MonacoKeyboardBridge } from '@renderer/lib/components/monaco-keyboard-bridge';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { events } from '@renderer/lib/ipc';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import { appState } from '@renderer/lib/stores/app-state';
import { Toaster } from '@renderer/lib/ui/toaster';
import { ConversationsPanel } from './conversations/conversations-panel';

/**
 * The standalone agent board: a detached window that renders the live sessions
 * of every task in the main window's kanban ranking, capped at the user's
 * configured max. Each card shows only the TUI — no sidebars, no chrome — so
 * the window is a pure "watch the agents work" surface. Closing it changes
 * nothing in the main workspace.
 *
 * The ranked pane list is resolved by the main window (which owns the kanban
 * ordering) and pushed over `standaloneKanbanPanesChangedChannel`.
 */
export const StandaloneKanbanWindow = observer(function StandaloneKanbanWindow({
  initialTarget,
}: {
  initialTarget: StandaloneKanbanWindowTarget;
}) {
  useTheme();
  const { t } = useTranslation();
  const [panes, setPanes] = useState<StandaloneKanbanPane[]>(initialTarget.panes);

  useEffect(() => {
    return events.on(standaloneKanbanPanesChangedChannel, (target) => {
      setPanes(target.panes);
    });
  }, []);

  // Each pane's task lives in its project; mount every distinct project.
  useEffect(() => {
    const projectIds = [...new Set(panes.map((pane) => pane.projectId))];
    void Promise.all(
      projectIds.map(async (id) => {
        const loaded = await appState.projects.ensureProjectLoaded(id);
        if (loaded) await appState.projects.mountProject(id);
      })
    ).catch(() => {});
  }, [panes]);

  return (
    <>
      <CommandShortcutBinder />
      <MonacoKeyboardBridge />
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background-secondary pl-20 pr-2 dark:bg-background [-webkit-app-region:drag]">
          <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden />
          <span className="min-w-0 truncate text-xs font-medium text-foreground-muted">
            {t('standaloneKanban.title', { count: panes.length })}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          {panes.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-foreground-muted">{t('standaloneKanban.emptyState')}</p>
            </div>
          ) : (
            <div className="flex h-full items-stretch gap-3 p-3">
              {panes.map((pane) => (
                <div
                  key={`${pane.projectId}:${pane.taskId}`}
                  className="flex-1 basis-0 overflow-hidden rounded-lg border border-border bg-background-1"
                  style={{ minWidth: STANDALONE_KANBAN_MIN_PANE_WIDTH }}
                >
                  <ErrorBoundary variant="inline" componentName="StandaloneKanbanCard">
                    <StandaloneKanbanCard projectId={pane.projectId} taskId={pane.taskId} />
                  </ErrorBoundary>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <ErrorBoundary variant="inline" componentName="ModalRenderer">
        <ModalRenderer />
      </ErrorBoundary>
      <Toaster />
    </>
  );
});

/**
 * One board card: the task's TUI only — no tabs, no sidebars, no bottom drawer.
 * The card force-opens the preferred conversation tab (mirroring a warm task
 * window), so a task that has never been clicked still shows its session.
 */
const StandaloneKanbanCard = observer(function StandaloneKanbanCard({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);
  const provisioned = asProvisioned(taskStore);

  useHostedTaskLifecycle(projectId, taskId, kind, taskStore);

  // Force-open the preferred conversation so a never-clicked task still shows
  // its agent (mirroring ReadyTaskTabWindow).
  useEffect(() => {
    if (kind !== 'ready' || !provisioned) return;
    const target = provisioned.taskView.tabManager.preferredConversationTarget;
    if (!target) return;
    void openProvisionedTaskTab(provisioned, target).catch(() => {});
  }, [kind, provisioned]);

  if (kind !== 'ready' || !provisioned) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-xs text-foreground-muted">{t('standaloneKanban.cardLoading')}</p>
      </div>
    );
  }

  return (
    <TaskViewWrapper
      projectId={projectId}
      taskId={taskId}
      kind={kind}
      provisionedTask={provisioned}
      hosted
    >
      <EditorProvider key={taskId} taskId={taskId} projectId={projectId}>
        <ConversationsPanel forceVisible />
      </EditorProvider>
    </TaskViewWrapper>
  );
});
