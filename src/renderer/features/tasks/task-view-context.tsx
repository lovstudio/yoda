import { observer } from 'mobx-react-lite';
import { createContext, useContext, type ReactNode } from 'react';
import { ProjectViewWrapper } from '@renderer/features/projects/components/project-view-wrapper';
import { type ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { type TaskViewKind } from '@renderer/features/tasks/stores/task-selectors';

type NonReadyTaskViewKind = Exclude<TaskViewKind, 'ready'>;

interface TaskViewContextBase {
  projectId: string;
  taskId: string;
  /**
   * True when this task view is HOSTED as a non-primary pane (a split-view
   * extra) rather than owning the global route + app-tab strip. Hosted panes
   * render their own self-contained chrome and must not show the global
   * AppTabStrip / nav cluster (which always reflect the routed task).
   */
  hosted: boolean;
}

/**
 * One discriminated snapshot owns both task readiness and its ready payload.
 * Keeping them in a single context makes the invalid state "ready without a
 * provisioned task" unrepresentable for descendants during MobX transitions.
 */
type TaskViewContext = TaskViewContextBase &
  (
    | { kind: 'ready'; provisionedTask: ProvisionedTask }
    | { kind: NonReadyTaskViewKind; provisionedTask: null }
  );

const TaskViewContext = createContext<TaskViewContext | null>(null);

type TaskViewWrapperProps = {
  children: ReactNode;
  projectId: string;
  taskId: string;
  hosted?: boolean;
} & (
  | { kind: 'ready'; provisionedTask: ProvisionedTask }
  | { kind: NonReadyTaskViewKind; provisionedTask?: never }
);

export const TaskViewWrapper = observer(function TaskViewWrapper(props: TaskViewWrapperProps) {
  const { children, projectId, taskId, hosted = false } = props;
  // Context updates reach every mounted consumer, including descendants that
  // the nearest ready guard is about to remove. Replace the subtree whenever
  // its entity or readiness boundary changes so an old ready consumer never
  // receives a different task's non-ready snapshot during reconciliation.
  const snapshotBoundaryKey = `${projectId}:${taskId}:${props.kind === 'ready' ? 'ready' : 'pending'}`;
  const value: TaskViewContext =
    props.kind === 'ready'
      ? {
          projectId,
          taskId,
          hosted,
          kind: props.kind,
          provisionedTask: props.provisionedTask,
        }
      : { projectId, taskId, hosted, kind: props.kind, provisionedTask: null };

  return (
    <ProjectViewWrapper projectId={projectId}>
      <TaskViewContext.Provider key={snapshotBoundaryKey} value={value}>
        {children}
      </TaskViewContext.Provider>
    </ProjectViewWrapper>
  );
});

/** Nullable. For components that also render outside a task view (e.g. the composer popover). */
export function useProvisionedTaskOrNull(): ProvisionedTask | null {
  return useContext(TaskViewContext)?.provisionedTask ?? null;
}

/** Non-nullable. Only call after the shared task-view snapshot reports `ready`. */
export function useProvisionedTask(): ProvisionedTask {
  const task = useProvisionedTaskOrNull();
  if (!task) {
    throw new Error('useProvisionedTask requires a ready task view snapshot');
  }
  return task;
}

export function useTaskViewContext(): TaskViewContext {
  const context = useContext(TaskViewContext);
  if (!context) {
    throw new Error('useTaskViewContext must be used within a TaskViewContextProvider');
  }
  return context;
}

/** True when rendered inside a hosted (non-primary, split-view extra) task pane. */
export function useIsHostedTaskView(): boolean {
  return useContext(TaskViewContext)?.hosted ?? false;
}

export function useTaskViewKind(): TaskViewKind {
  return useTaskViewContext().kind;
}
