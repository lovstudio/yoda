import { observer } from 'mobx-react-lite';
import { createContext, useContext, type ReactNode } from 'react';
import { ProjectViewWrapper } from '@renderer/features/projects/components/project-view-wrapper';
import { type ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { type TaskViewKind } from '@renderer/features/tasks/stores/task-selectors';

const ProvisionedTaskContext = createContext<ProvisionedTask | null>(null);

/** Uses the ready-state owner's captured task so provider and branch cannot disagree. */
export function ProvisionedTaskProvider({
  task,
  children,
}: {
  task: ProvisionedTask;
  children: ReactNode;
}) {
  return <ProvisionedTaskContext.Provider value={task}>{children}</ProvisionedTaskContext.Provider>;
}

/** Nullable. For components that also render outside a task view (e.g. the composer popover). */
export function useProvisionedTaskOrNull(): ProvisionedTask | null {
  return useContext(ProvisionedTaskContext);
}

/** Non-nullable. Only call inside a ProvisionedTaskProvider subtree (kind === 'ready'). */
export function useProvisionedTask(): ProvisionedTask {
  const ctx = useContext(ProvisionedTaskContext);
  if (!ctx) {
    throw new Error(
      'useProvisionedTask must be used inside ProvisionedTaskProvider (kind === "ready")'
    );
  }
  return ctx;
}

interface TaskViewContext {
  projectId: string;
  taskId: string;
  /**
   * Captured by the same owner that decides whether ProvisionedTaskProvider is
   * mounted. Consumers must use this snapshot instead of independently
   * deriving the task state, otherwise a child can observe `ready` one render
   * before its provider boundary is installed.
   */
  kind: TaskViewKind;
  /**
   * True when this task view is HOSTED as a non-primary pane (a split-view
   * extra) rather than owning the global route + app-tab strip. Hosted panes
   * render their own self-contained chrome and must not show the global
   * AppTabStrip / nav cluster (which always reflect the routed task).
   */
  hosted: boolean;
}

const TaskViewContext = createContext<TaskViewContext | null>(null);

export const TaskViewWrapper = observer(function TaskViewWrapper({
  children,
  projectId,
  taskId,
  kind,
  hosted = false,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
  kind: TaskViewKind;
  hosted?: boolean;
}) {
  return (
    <ProjectViewWrapper projectId={projectId}>
      <TaskViewContext.Provider value={{ projectId, taskId, kind, hosted }}>
        {children}
      </TaskViewContext.Provider>
    </ProjectViewWrapper>
  );
});

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
