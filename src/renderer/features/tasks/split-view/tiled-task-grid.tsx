import { X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, type ReactNode } from 'react';
import { TaskPaneHeader } from '@renderer/features/tasks/components/task-pane-header';
import { EditorProvider } from '@renderer/features/tasks/editor/editor-provider';
import { useHostedTaskLifecycle } from '@renderer/features/tasks/hooks/use-hosted-task-lifecycle';
import { TaskMainPanel } from '@renderer/features/tasks/main-panel';
import {
  asProvisioned,
  getTaskStore,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { TaskViewWrapper } from '@renderer/features/tasks/task-view-context';
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
  const provisioned = asProvisioned(taskStore);

  useHostedTaskLifecycle(projectId, taskId, kind, taskStore);

  if (kind !== 'ready') {
    return (
      <TaskViewWrapper projectId={projectId} taskId={taskId} kind={kind} hosted>
        <TaskMainPanel />
      </TaskViewWrapper>
    );
  }

  if (!provisioned) return null;

  return (
    <TaskViewWrapper
      projectId={projectId}
      taskId={taskId}
      kind={kind}
      provisionedTask={provisioned}
      hosted
    >
      <EditorProvider key={taskId} taskId={taskId} projectId={projectId}>
        <TaskMainPanel />
      </EditorProvider>
    </TaskViewWrapper>
  );
});

/** Slim header on extra panes: shared identity strip + close. */
const ExtraPaneHeader = observer(function ExtraPaneHeader({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { navigate } = useNavigate();

  return (
    <TaskPaneHeader
      projectId={projectId}
      taskId={taskId}
      onTitleClick={() => {
        // Promote this pane to primary: route to it and drop it from extras.
        splitViewStore.remove(taskId);
        navigate('task', { projectId, taskId });
      }}
    >
      <button
        type="button"
        aria-label="Close pane"
        onClick={() => splitViewStore.remove(taskId)}
        className="flex size-5 shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-background-2 hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </TaskPaneHeader>
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
