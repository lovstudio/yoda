import {
  FileDiff,
  FolderOpen,
  Info,
  ListChecks,
  Pencil,
  Pin,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { Issue } from '@shared/tasks';
import {
  asMounted,
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import {
  getRegisteredTaskData,
  getTaskStore,
  taskDisplayName,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { ConnectionStatusDot } from '@renderer/lib/components/connection-status-dot';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Separator } from '@renderer/lib/ui/separator';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Toggle } from '@renderer/lib/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { DevServerPills } from './components/dev-server-pills';
import { ProviderLogo } from './components/issue-selector/issue-selector';
import { TaskGitDiffStats } from './components/task-git-diff-stats';
import { type SidebarTab } from './types';

export const TaskTitlebar = observer(function TaskTitlebar() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  if (kind !== 'ready') {
    return <PendingTaskTitlebar taskId={taskId} projectId={projectId} />;
  }

  return <ActiveTaskTitlebar taskId={taskId} projectId={projectId} />;
});

const PendingTaskTitlebar = observer(function PendingTaskTitlebar({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId)!;
  const projectName = projectDisplayName(getProjectStore(projectId));
  const name = taskDisplayName(taskStore);

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2 text-sm text-foreground-muted">
          <span className="flex items-center gap-1">
            <span className="text-sm text-foreground-passive">{projectName}</span>
            <span className="text-sm text-foreground-passive">/</span>
            {name}
          </span>
        </div>
      }
    />
  );
});

const ActiveTaskTitlebar = observer(function ActiveTaskTitlebar({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const taskStore = getTaskStore(projectId, taskId)!;
  const taskPayload = getRegisteredTaskData(projectId, taskId)!;
  const linkedIssues =
    taskPayload.linkedIssues ?? (taskPayload.linkedIssue ? [taskPayload.linkedIssue] : []);
  const provisionedTask = useProvisionedTask();
  const { taskView } = provisionedTask;
  const showRename = useShowModal('renameTaskModal');

  const projectStore = asMounted(getProjectStore(projectId));

  const projectName = projectDisplayName(getProjectStore(projectId));
  const taskName = taskDisplayName(taskStore);

  const isRemoteProject = projectStore?.data.type === 'ssh';
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2 min-w-0">
          <div className="flex min-w-0 items-center gap-1 text-sm">
            <button
              type="button"
              className="-mx-1 inline-flex min-w-0 items-baseline gap-1 rounded px-1 text-foreground-passive hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => navigate('project', { projectId })}
              title={t('sidebar.openProjectDetails')}
              aria-label={t('sidebar.openProjectDetails')}
            >
              <span className="truncate">{projectName}</span>
              <span className="max-w-28 shrink-0 truncate font-mono text-[11px] text-foreground-passive/70">
                ({provisionedTask.workspace.git.branchName})
              </span>
            </button>
            <span className="shrink-0 text-foreground-passive">/</span>
            <button
              type="button"
              className="-mx-1 flex min-w-0 items-center gap-1.5 rounded px-1 text-foreground-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => {
                if (!taskName) return;
                showRename({ projectId, taskId, currentName: taskName });
              }}
              title={t('tasks.rename.title')}
            >
              <span className="truncate">{taskName}</span>
              <ConnectionStatusDot state={provisionedTask.workspace.connectionState} />
            </button>
          </div>
          <TaskGitDiffStats task={taskStore} />
          <LinkedIssuesBadgeGroup issues={linkedIssues} />
          <button
            className={cn(
              'text-foreground-muted ml-1',
              taskPayload.isPinned && 'text-muted-foreground'
            )}
            onClick={() => taskStore.setPinned(!taskPayload.isPinned)}
          >
            <Pin
              className={cn('size-3.5', taskPayload.isPinned && 'text-foreground-muted')}
              fill={taskPayload.isPinned ? 'currentColor' : 'none'}
            />
          </button>
        </div>
      }
      rightSlot={
        <div className="flex items-center gap-2">
          <DevServerPills projectId={projectId} taskId={taskId} />
          {!isRemoteProject && (
            <OpenInMenu path={provisionedTask.path} className="h-7 bg-background" borderless />
          )}
          <Separator orientation="vertical" className="h-5 self-center!" />
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="sm"
                  pressed={taskView.isTerminalDrawerOpen}
                  className="border-none"
                  onPressedChange={() =>
                    taskView.setTerminalDrawerOpen(!taskView.isTerminalDrawerOpen)
                  }
                >
                  <Terminal className="size-3.5" />
                </Toggle>
              }
            />
            <TooltipContent>
              {t('tasks.toggleTerminal')} <ShortcutHint settingsKey="toggleTerminalDrawer" />
            </TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="h-5 self-center!" />
          <ToggleGroup
            value={taskView.isSidebarCollapsed ? [] : [taskView.sidebarTab]}
            onValueChange={([tab]) => {
              if (!tab) {
                taskView.setSidebarCollapsed(true);
                return;
              }
              if (!isSidebarTab(tab)) return;
              taskView.setSidebarTab(tab);
              taskView.setSidebarCollapsed(false);
            }}
            size="icon-sm"
            className="border-none"
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    size="icon-sm"
                    value="session"
                    aria-label={t('tasks.sessionInfo.title')}
                  >
                    <Info className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>{t('tasks.sessionInfo.title')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    size="icon-sm"
                    value="context"
                    aria-label={t('tasks.contextTab')}
                  >
                    <Sparkles className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>{t('tasks.contextTab')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem size="icon-sm" value="task" aria-label="Task">
                    <ListChecks className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>Task</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem size="icon-sm" value="changes" aria-label={t('tasks.changes')}>
                    <FileDiff className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>{t('tasks.changes')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem size="icon-sm" value="files" aria-label={t('tasks.files')}>
                    <FolderOpen className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>{t('tasks.files')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    size="icon-sm"
                    value="rename"
                    aria-label={t('tasks.rename.panelTitle')}
                  >
                    <Pencil className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>{t('tasks.rename.panelTitle')}</TooltipContent>
            </Tooltip>
          </ToggleGroup>
        </div>
      }
    />
  );
});

function isSidebarTab(value: string): value is SidebarTab {
  return (
    value === 'session' ||
    value === 'task' ||
    value === 'conversations' ||
    value === 'changes' ||
    value === 'files' ||
    value === 'context' ||
    value === 'rename'
  );
}

function LinkedIssuesBadgeGroup({ issues }: { issues: Issue[] }) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;

  const visibleIssues = issues.slice(0, 2);
  const hiddenIssues = issues.slice(2);

  return (
    <div className="flex min-w-0 items-center gap-1">
      {visibleIssues.map((issue) => (
        <LinkedIssueBadge key={issue.url || issue.identifier} issue={issue} />
      ))}
      {hiddenIssues.length > 0 ? (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground-muted hover:bg-muted/30"
              >
                {t('issues.moreIssues', { count: hiddenIssues.length })}
              </button>
            }
          />
          <PopoverContent align="start" className="w-80 p-2">
            <div className="px-2 pb-2 text-xs font-medium text-foreground-muted">
              {t('issues.linkedIssues')}
            </div>
            <div className="max-h-64 overflow-y-auto">
              {issues.map((issue) => (
                <button
                  key={issue.url || issue.identifier}
                  type="button"
                  disabled={!issue.url}
                  className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:cursor-default disabled:opacity-60"
                  onClick={() => {
                    if (issue.url) void rpc.app.openExternal(issue.url);
                  }}
                >
                  <ProviderLogo provider={issue.provider} className="h-3.5 w-3.5" />
                  <span className="shrink-0 font-mono text-xs text-foreground-muted">
                    {issue.identifier}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

function LinkedIssueBadge({ issue }: { issue: Issue }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            disabled={!issue.url}
            onClick={() => {
              if (issue.url) void rpc.app.openExternal(issue.url);
            }}
            className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground-muted hover:bg-muted/30 disabled:cursor-default disabled:opacity-60"
          >
            <ProviderLogo provider={issue.provider} className="h-3 w-3" />
            <span className="font-mono">{issue.identifier}</span>
          </button>
        }
      />
      <TooltipContent>{issue.title || issue.identifier}</TooltipContent>
    </Tooltip>
  );
}
