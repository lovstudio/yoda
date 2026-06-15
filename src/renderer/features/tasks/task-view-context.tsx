import { observer } from 'mobx-react-lite';
import { createContext, useContext, type ReactNode } from 'react';
import { ProjectViewWrapper } from '@renderer/features/projects/components/project-view-wrapper';
import { type ProvisionedTask } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskStore,
  taskViewKind,
  type TaskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';

const ProvisionedTaskContext = createContext<ProvisionedTask | null>(null);

export const ProvisionedTaskProvider = observer(function ProvisionedTaskProvider({
  projectId,
  taskId,
  children,
}: {
  projectId: string;
  taskId: string;
  children: ReactNode;
}) {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return null;
  return (
    <ProvisionedTaskContext.Provider value={provisioned}>
      {children}
    </ProvisionedTaskContext.Provider>
  );
});

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
  hosted = false,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
  hosted?: boolean;
}) {
  return (
    <ProjectViewWrapper projectId={projectId}>
      <TaskViewContext.Provider value={{ projectId, taskId, hosted }}>
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
  const { projectId, taskId } = useTaskViewContext();
  return taskViewKind(getTaskStore(projectId, taskId), projectId);
}
