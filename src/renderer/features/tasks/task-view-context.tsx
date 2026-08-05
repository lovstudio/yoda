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
// Ready-only consumers subscribe to a context whose value is immutable for
// the lifetime of their subtree. When a task leaves `ready`, React removes
// this provider with the keyed subtree instead of broadcasting `null` to
// every mounted ready consumer before their nearest guard can unmount them.
const ProvisionedTaskContext = createContext<ProvisionedTask | null>(null);

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
  const content =
    props.kind === 'ready' ? (
      <ProvisionedTaskContext.Provider value={props.provisionedTask}>
        {children}
      </ProvisionedTaskContext.Provider>
    ) : (
      children
    );

  return (
    <ProjectViewWrapper projectId={projectId}>
      <TaskViewContext.Provider key={snapshotBoundaryKey} value={value}>
        {content}
      </TaskViewContext.Provider>
    </ProjectViewWrapper>
  );
});

/** Nullable. Use at task-view readiness boundaries and from optional task-scoped UI. */
export function useProvisionedTask(): ProvisionedTask | null {
  return useContext(TaskViewContext)?.provisionedTask ?? null;
}

/** Non-nullable. Only use in a subtree mounted exclusively for a ready task. */
export function useRequireProvisionedTask(): ProvisionedTask {
  const lifetimeTask = useContext(ProvisionedTaskContext);
  const snapshotTask = useContext(TaskViewContext)?.provisionedTask ?? null;
  // The discriminated owner snapshot is authoritative. The lifetime context
  // keeps an already-mounted ready subtree stable while React removes it.
  // Reading both closes the inverse transition as well: when the owner has
  // published `ready`, a child must not fail merely because React has not yet
  // installed the nested lifetime provider in the same concurrent pass.
  const task = snapshotTask ?? lifetimeTask;
  if (!task) {
    throw new Error('Ready task content rendered outside its provisioned task boundary');
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
