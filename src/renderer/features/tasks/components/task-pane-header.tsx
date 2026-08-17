import { GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { SIDEBAR_REDACTED_CLASS } from '@renderer/features/sidebar/sidebar-redaction';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { branchColor } from '@renderer/utils/branch-color';
import { cn } from '@renderer/utils/utils';
import { TaskSessionStatusControl } from './task-session-status-control';

/**
 * The identity strip every surface that hosts a bare task pane puts on top:
 * agent status, task name, branch, project. Panes are stripped of the sidebar
 * and tab strip, so this header is the only thing telling the user *which*
 * session they are looking at — and it must read the same on all of them
 * (split-view extras, the comparison window, the standalone agent board).
 *
 * `children` is the trailing action slot; each host owns its own actions
 * (promote to primary, close, focus in main window).
 */
export const TaskPaneHeader = observer(function TaskPaneHeader({
  projectId,
  taskId,
  onTitleClick,
  titleTooltip,
  children,
}: {
  projectId: string;
  taskId: string;
  /** Given, the name becomes a button (e.g. promote this pane / focus the task). */
  onTitleClick?: () => void;
  titleTooltip?: string;
  children?: ReactNode;
}) {
  const task = getTaskStore(projectId, taskId);
  const name = task?.data.name ?? taskId.slice(0, 8);
  const project = getProjectStore(projectId);
  const projectName =
    project?.state === 'unregistered' ? projectId : (project?.displayName ?? projectId);
  const provisioned = asProvisioned(task);
  const branchName =
    provisioned?.workspace.git.branchName ??
    (task && 'taskBranch' in task.data ? task.data.taskBranch : undefined);
  // Privacy mode blurs task and project identity here for the same reason it
  // does in the sidebar: these panes are what gets screen-shared.
  const redacted = sidebarStore.isProjectRedacted(projectId) ? SIDEBAR_REDACTED_CLASS : undefined;

  const titleClassName = cn('min-w-0 truncate text-xs font-medium text-foreground-muted', redacted);

  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-background-1/50 pl-1.5 pr-1">
      {task && (
        <TaskSessionStatusControl task={task} className="shrink-0" align="start" side="bottom" />
      )}
      {onTitleClick ? (
        <button
          type="button"
          title={titleTooltip ?? name}
          onClick={onTitleClick}
          className={cn(titleClassName, 'flex-1 text-left hover:text-foreground')}
        >
          {name}
        </button>
      ) : (
        <span title={name} className={cn(titleClassName, 'flex-1')}>
          {name}
        </span>
      )}
      {branchName && (
        <span
          title={branchName}
          className={cn(
            'flex min-w-0 max-w-[40%] shrink items-center gap-1 text-foreground-tertiary-passive',
            redacted
          )}
        >
          <GitBranch className="size-3 shrink-0" style={{ color: branchColor(branchName) }} />
          <span className="min-w-0 truncate font-mono text-[10px] leading-4">{branchName}</span>
        </span>
      )}
      <span
        title={projectName}
        className={cn(
          'max-w-24 shrink-0 truncate rounded-sm bg-background-tertiary-2 px-1 text-[10px] uppercase tracking-wide text-foreground-tertiary',
          redacted
        )}
      >
        {projectName}
      </span>
      {children}
    </div>
  );
});
