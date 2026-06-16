import { X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, useEffect, type ReactNode } from 'react';
import { EditorProvider } from '@renderer/features/tasks/editor/editor-provider';
import { TaskMainPanel } from '@renderer/features/tasks/main-panel';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  ProvisionedTaskProvider,
  TaskViewWrapper,
} from '@renderer/features/tasks/task-view-context';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { cn } from '@renderer/utils/utils';
import { splitViewStore } from './split-view-store';

/**
 * A full, self-contained task view for an EXTRA (non-routed) pane. Mirrors the
 * route's TaskViewWrapperWithProviders but deliberately drops TopLevelTabSync /
 * TabManagerVisibilitySync — those couple a task to the GLOBAL route + app-tab
 * strip, which only the primary pane may own. Extra panes are driven by their
 * own internal tab state (switch tabs via the pane's own sidebar).
 */
export const SelfContainedTaskPane = observer(function SelfContainedTaskPane({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  // Auto-provision an idle task the same way the route does.
  useEffect(() => {
    if (kind !== 'idle') return;
    if (taskStore && 'archivedAt' in taskStore.data && taskStore.data.archivedAt) return;
    getTaskManagerStore(projectId)
      ?.provisionTask(taskId)
      .catch(() => {});
  }, [kind, projectId, taskId, taskStore]);

  if (kind !== 'ready') {
    return (
      <TaskViewWrapper projectId={projectId} taskId={taskId} hosted>
        <TaskMainPanel />
      </TaskViewWrapper>
    );
  }

  return (
    <TaskViewWrapper projectId={projectId} taskId={taskId} hosted>
      <ProvisionedTaskProvider projectId={projectId} taskId={taskId}>
        <EditorProvider key={taskId} taskId={taskId} projectId={projectId}>
          <TaskMainPanel />
        </EditorProvider>
      </ProvisionedTaskProvider>
    </TaskViewWrapper>
  );
});

/** Slim header on extra panes: name (click → make primary) + close. */
const ExtraPaneHeader = observer(function ExtraPaneHeader({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { navigate } = useNavigate();
  const name = getTaskStore(projectId, taskId)?.data.name ?? taskId.slice(0, 8);

  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-background-1/50 pl-2 pr-1">
      <button
        type="button"
        title={name}
        onClick={() => {
          // Promote this pane to primary: route to it and drop it from extras.
          splitViewStore.remove(taskId);
          navigate('task', { projectId, taskId });
        }}
        className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground-muted hover:text-foreground"
      >
        {name}
      </button>
      <button
        type="button"
        aria-label="Close pane"
        onClick={() => splitViewStore.remove(taskId)}
        className="flex size-5 shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-background-2 hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
});

/**
 * Tiles the routed task (primary) and the split-view extras side by side in the
 * main content area. The primary keeps the outer route providers + app-tab
 * strip; extras bring their own self-contained providers.
 */
export const TiledTaskGrid = observer(function TiledTaskGrid({ primary }: { primary: ReactNode }) {
  // Already scoped to the current primary task and de-duped against it.
  const extras = splitViewStore.panes;

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
    >
      <ResizablePanel id="split-primary" minSize="20%" className="min-h-0 min-w-0 overflow-hidden">
        <div className="h-full min-h-0 min-w-0 overflow-hidden">{primary}</div>
      </ResizablePanel>
      {extras.map((pane) => (
        <Fragment key={pane.taskId}>
          <ResizableHandle />
          <ResizablePanel
            id={`split-${pane.taskId}`}
            minSize="20%"
            className={cn('min-h-0 min-w-0 overflow-hidden')}
          >
            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              <ExtraPaneHeader projectId={pane.projectId} taskId={pane.taskId} />
              <div className="min-h-0 flex-1 overflow-hidden">
                <SelfContainedTaskPane projectId={pane.projectId} taskId={pane.taskId} />
              </div>
            </div>
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
});
