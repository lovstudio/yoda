import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FileDiff,
  FolderOpen,
  GitBranch,
  MessageSquare,
  Pin,
  RefreshCcw,
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
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Separator } from '@renderer/lib/ui/separator';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Toggle } from '@renderer/lib/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { DevServerPills } from './components/dev-server-pills';
import { IssueSelector, ProviderLogo } from './components/issue-selector/issue-selector';
import { type SidebarTab } from './types';
import { useGitActions } from './use-git-actions';

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
  const taskStore = getTaskStore(projectId, taskId)!;
  const taskPayload = getRegisteredTaskData(projectId, taskId)!;
  const provisionedTask = useProvisionedTask();
  const { taskView } = provisionedTask;

  const {
    hasUpstream,
    aheadCount,
    behindCount,
    fetch,
    pull,
    push,
    publish,
    isPublishing,
    isFetching,
    isPulling,
    isPushing,
  } = useGitActions(projectId, taskId);

  const projectStore = asMounted(getProjectStore(projectId));

  const projectName = projectDisplayName(getProjectStore(projectId));

  const isRemoteProject = projectStore?.data.type === 'ssh';
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2 min-w-0">
          <Popover>
            <PopoverTrigger className="flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground min-w-0">
              <span className="flex items-center gap-1 min-w-0">
                <span className="text-sm text-foreground-passive shrink-0">{projectName}</span>
                <span className="text-sm text-foreground-passive shrink-0">/</span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{taskDisplayName(taskStore)}</span>
                  <ConnectionStatusDot state={provisionedTask.workspace.connectionState} />
                </span>
              </span>
              <ChevronDown className="size-3.5 shrink-0" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-96 p-4 flex flex-col gap-2">
              <div className="flex flex-col gap-1 w-full">
                <MicroLabel className="text-foreground-passive items-center flex">
                  {t('tasks.task')}
                </MicroLabel>
                <span className="text-sm tracking-tight">{taskDisplayName(taskStore)}</span>
              </div>
              <OpenInMenu path={provisionedTask.path} />
              <div className="flex flex-col gap-1 border border-border rounded-md p-2">
                <span className="flex items-center gap-1 text-foreground-muted">
                  <GitBranch className="size-3.5" />
                  <span>{provisionedTask.workspace.git.branchName}</span>
                </span>
                {taskPayload.sourceBranch && (
                  <span className="flex items-center gap-2 text-foreground-passive">
                    {t('tasks.git.createdFrom')}
                    <span className="flex items-center gap-1 text-foreground-muted">
                      <GitBranch className="size-3.5" /> {taskPayload.sourceBranch.branch}
                    </span>
                  </span>
                )}
                <div className="flex items-center gap-1 w-full">
                  {hasUpstream ? (
                    <>
                      <Tooltip>
                        <TooltipTrigger className="flex-1">
                          <Button
                            className="w-full"
                            variant="outline"
                            size="xs"
                            disabled={isFetching}
                            onClick={() => fetch()}
                          >
                            <RefreshCcw className="size-3" />
                            {isFetching ? t('tasks.git.fetching') : t('tasks.git.fetch')}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isFetching ? t('tasks.git.fetching') : t('tasks.git.fetchChanges')}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger className="flex-1">
                          <Button
                            className="w-full"
                            variant="outline"
                            disabled={isPulling || behindCount === 0}
                            size="xs"
                            onClick={() => pull()}
                          >
                            <ArrowDown className="size-3" />
                            {isPulling ? (
                              t('tasks.git.pulling')
                            ) : (
                              <span className="flex items-center gap-1">
                                {t('tasks.git.pull')}
                                <Badge variant="secondary" className="shrink-0">
                                  {behindCount}
                                </Badge>
                              </span>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isPulling
                            ? t('tasks.git.pulling')
                            : behindCount === 0
                              ? t('tasks.git.nothingToPull')
                              : t('tasks.git.pullChanges')}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger className="flex-1">
                          <Button
                            className="w-full"
                            variant="outline"
                            disabled={isPushing || aheadCount === 0}
                            size="xs"
                            onClick={() => push()}
                          >
                            <ArrowUp className="size-3" />
                            {isPushing ? (
                              t('tasks.git.pushing')
                            ) : (
                              <span className="flex items-center gap-1">
                                {t('tasks.git.push')}
                                <Badge variant="secondary" className="shrink-0">
                                  {aheadCount}
                                </Badge>
                              </span>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isPushing
                            ? t('tasks.git.pushing')
                            : aheadCount === 0
                              ? t('tasks.git.nothingToPush')
                              : t('tasks.git.pushChanges')}
                        </TooltipContent>
                      </Tooltip>
                    </>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger className="flex-1">
                        <Button
                          className="w-full"
                          variant="outline"
                          disabled={isPublishing}
                          size="xs"
                          onClick={() => publish()}
                        >
                          <ArrowUp className="size-3" />
                          {isPublishing ? t('tasks.git.publishing') : t('tasks.git.publish')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isPublishing ? t('tasks.git.publishing') : t('tasks.git.publishBranch')}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
              <IssueSelector
                value={taskPayload.linkedIssue ?? null}
                onValueChange={(issue) => {
                  void taskStore.updateLinkedIssue(issue ?? undefined);
                }}
                projectId={projectId}
                repositoryUrl={provisionedTask.repositoryStore.repositoryUrl ?? ''}
                projectPath={provisionedTask.path}
                excludeTaskId={taskId}
              />
            </PopoverContent>
          </Popover>
          {taskPayload.linkedIssue ? <LinkedIssueBadge issue={taskPayload.linkedIssue} /> : null}
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
            <TooltipTrigger>
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
            </TooltipTrigger>
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
              } else {
                taskView.setSidebarTab(tab as SidebarTab);
                taskView.setSidebarCollapsed(false);
              }
            }}
            size="icon-sm"
            className="border-none"
          >
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem size="icon-sm" value="changes" aria-label={t('tasks.changes')}>
                  <FileDiff className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{t('tasks.changes')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem
                  size="icon-sm"
                  value="conversations"
                  aria-label={t('tasks.conversations')}
                >
                  <MessageSquare className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{t('tasks.conversations')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem size="icon-sm" value="files" aria-label={t('tasks.files')}>
                  <FolderOpen className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{t('tasks.files')}</TooltipContent>
            </Tooltip>
          </ToggleGroup>
        </div>
      }
    />
  );
});

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
