import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Boxes, ClipboardCheck } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppAgentSessionResource, TmuxReclamationSnapshot } from '@shared/app-resource';
import { openTaskTarget } from '@renderer/app/open-task-target';
import { rankWorkspaceAgentSessions } from '@renderer/app/workspace-agent-sessions';
import {
  WORKSPACE_BAR_ACTION_COUNT_CLASS,
  WORKSPACE_BAR_ACTION_INLINE_DOT_CLASS,
  WorkspaceBarActionGlyph,
} from '@renderer/app/workspace-bar-action-indicator';
import {
  WORKSPACE_BAR_CARD_CLASS,
  WorkspaceBarCardFooter,
  WorkspaceBarCardHeader,
} from '@renderer/app/workspace-bar-card';
import { WorkspaceResourceMetric } from '@renderer/app/workspace-resource-metric';
import { WORKSPACE_RESOURCE_QUERY_KEY } from '@renderer/app/workspace-resource-monitoring';
import { getDistinctAgentTaskTitle } from '@renderer/app/workspace-runtime-bar-format';
import { asMounted } from '@renderer/features/projects/stores/project-selectors';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { registeredTaskData } from '@renderer/features/tasks/stores/task';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { RUNTIME_BAR_ACTION_CLASS } from '../bar-chrome';
import { formatBytes } from '../display';
import { useFreshAgentProcesses, useWorkspaceResourceSnapshot } from '../resource-snapshot';
import { explicitConversationRuntimeId } from '../session-context';

/**
 * A session the OS reports and a session the app knows about are not the same
 * set: a process can outlive its record, and a just-started conversation has no
 * process yet. Both are merged so neither kind goes unseen.
 */
type WorkspaceAgentSession = Omit<AppAgentSessionResource, 'runtimeId' | 'title' | 'taskTitle'> & {
  runtimeId?: AppAgentSessionResource['runtimeId'];
  title?: string;
  taskTitle?: string;
};

type PendingAcceptanceTask = {
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  updatedAt: string;
};

type AgentPanelTab = 'all' | 'working' | 'needs-reply' | 'pending-acceptance';

function agentSessionKey(
  session: Pick<AppAgentSessionResource, 'projectId' | 'taskId' | 'conversationId'>
): string {
  return `${session.projectId}\0${session.taskId}\0${session.conversationId}`;
}

/**
 * Every agent running anywhere in the workspace, plus the work waiting on the
 * user. The counts are the point of the trigger: one glance answers "is
 * something waiting for me?" without opening anything.
 */
export const RuntimeBarAgentSessionsItem = observer(function RuntimeBarAgentSessionsItem() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { navigate } = useNavigate();
  const queryClient = useQueryClient();
  const showConfirmActionModal = useShowModal('confirmActionModal');
  const showArchiveWithNote = useShowModal('archiveTaskWithNoteModal');
  const [isAgentPopoverOpen, setIsAgentPopoverOpen] = useState(false);
  const [isReclaimingTmux, setIsReclaimingTmux] = useState(false);
  const [agentPanelTab, setAgentPanelTab] = useState<AgentPanelTab>('all');
  // Per-process figures are only worth their cost while this panel is open.
  useFreshAgentProcesses(isAgentPopoverOpen);
  const { data: resourceSnapshot, refetch: refreshResourceSnapshot } =
    useWorkspaceResourceSnapshot();
  useEffect(() => {
    if (isAgentPopoverOpen) void refreshResourceSnapshot();
  }, [isAgentPopoverOpen, refreshResourceSnapshot]);
  const {
    data: tmuxReclamation,
    isFetching: isScanningTmux,
    refetch: refreshTmuxReclamation,
  } = useQuery<TmuxReclamationSnapshot>({
    queryKey: ['app', 'tmuxReclamation'],
    queryFn: () => rpc.app.getTmuxReclamationSnapshot(),
    enabled: isAgentPopoverOpen,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  const agentSessionByKey = new Map<string, WorkspaceAgentSession>(
    (resourceSnapshot?.agentSessions ?? []).map((session) => [agentSessionKey(session), session])
  );
  for (const session of appState.agentRuntime.runningSessions()) {
    const key = agentSessionKey(session);
    if (agentSessionByKey.has(key)) continue;
    const task = getTaskStore(session.projectId, session.taskId);
    const conversation = asProvisioned(task)?.conversations.conversations.get(
      session.conversationId
    )?.data;
    agentSessionByKey.set(key, {
      ...session,
      pid: null,
      cpuPercent: 0,
      memoryBytes: 0,
      outputBytesPerSecond: 0,
      lastActivityAt: null,
      ringBufferBytes: 0,
      ringBufferCapBytes: 0,
      rendererConsumers: 0,
      lifecycle: 'warm',
      tmuxBacked: false,
      runtimeId: explicitConversationRuntimeId(conversation?.runtimeId) ?? undefined,
      title: conversation?.title,
      taskTitle: task?.data.name,
    });
  }
  const agentSessions = rankWorkspaceAgentSessions(Array.from(agentSessionByKey.values()));
  const agentSessionCount = agentSessions.length;
  const workingAgentCount = agentSessions.filter((session) => session.status === 'working').length;
  const attentionAgentCount = agentSessions.filter(
    (session) => session.status === 'awaiting-input'
  ).length;
  const pendingAcceptanceTasks: PendingAcceptanceTask[] = Array.from(
    appState.projects.projects.values()
  ).flatMap((project) => {
    const mountedProject = asMounted(project);
    if (!mountedProject) return [];
    const projectName = project.displayName;
    return mountedProject.taskManager.tasksNeedingReview.flatMap((task) => {
      const taskData = registeredTaskData(task);
      if (!taskData) return [];
      return [
        {
          projectId: taskData.projectId,
          projectName,
          taskId: taskData.id,
          taskName: taskData.name,
          updatedAt: taskData.updatedAt,
        },
      ];
    });
  });
  pendingAcceptanceTasks.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const displayedAgentSessions = agentSessions.filter((session) => {
    if (agentPanelTab === 'all') return true;
    if (agentPanelTab === 'working') return session.status === 'working';
    if (agentPanelTab === 'needs-reply') return session.status === 'awaiting-input';
    return false;
  });
  const agentTriggerText =
    attentionAgentCount > 0
      ? t('workspaceRuntime.agents.triggerAttention', {
          count: agentSessionCount,
          attention: attentionAgentCount,
        })
      : workingAgentCount > 0
        ? t('workspaceRuntime.agents.triggerWorking', {
            count: agentSessionCount,
            working: workingAgentCount,
          })
        : String(agentSessionCount);

  const cleanupTmuxSessions = async () => {
    setIsReclaimingTmux(true);
    try {
      const result = await rpc.app.cleanupReclaimableTmuxSessions();
      await Promise.all([
        refreshTmuxReclamation(),
        queryClient.invalidateQueries({ queryKey: WORKSPACE_RESOURCE_QUERY_KEY }),
      ]);
      if (result.terminatedCount > 0 || result.alreadyStoppedCount > 0) {
        toast.success(
          t('workspaceRuntime.agents.reclamationSuccess', {
            count: result.terminatedCount + result.alreadyStoppedCount,
          })
        );
      } else {
        toast(t('workspaceRuntime.agents.reclamationNone'));
      }
      if (result.failedSessionIds.length > 0 || result.skippedCount > 0) {
        toast.error(
          t('workspaceRuntime.agents.reclamationPartial', {
            count: result.failedSessionIds.length + result.skippedCount,
          })
        );
      }
    } catch {
      toast.error(t('workspaceRuntime.agents.reclamationFailed'));
    } finally {
      setIsReclaimingTmux(false);
    }
  };

  const confirmTmuxCleanup = () => {
    if (!tmuxReclamation?.reclaimableCount) return;
    showConfirmActionModal({
      title: t('workspaceRuntime.agents.confirmReclamationTitle'),
      description: t('workspaceRuntime.agents.confirmReclamationDescription', {
        count: tmuxReclamation.reclaimableCount,
      }),
      confirmLabel: t('workspaceRuntime.agents.reclaim'),
      variant: 'default',
      onSuccess: () => void cleanupTmuxSessions(),
    });
  };

  const openAgentSession = (session: WorkspaceAgentSession) => {
    setIsAgentPopoverOpen(false);
    openTaskTarget(
      {
        projectId: session.projectId,
        taskId: session.taskId,
        conversationId: session.conversationId,
      },
      navigate
    );
  };

  const openPendingAcceptanceTask = (task: PendingAcceptanceTask) => {
    setIsAgentPopoverOpen(false);
    openTaskTarget({ projectId: task.projectId, taskId: task.taskId }, navigate);
  };

  const restorePendingAcceptanceTask = (task: PendingAcceptanceTask) => {
    void getTaskStore(task.projectId, task.taskId)?.setNeedsReview(false);
  };

  const archivePendingAcceptanceTask = (task: PendingAcceptanceTask) => {
    showArchiveWithNote({
      projectId: task.projectId,
      taskId: task.taskId,
      taskName: task.taskName,
    });
  };

  return (
    <Popover open={isAgentPopoverOpen} onOpenChange={setIsAgentPopoverOpen}>
      <PopoverTrigger
        aria-label={t('workspaceRuntime.agents.triggerLabel', {
          count: agentSessionCount,
          working: workingAgentCount,
          attention: attentionAgentCount,
        })}
        className={cn(
          RUNTIME_BAR_ACTION_CLASS,
          attentionAgentCount > 0 ? 'text-foreground' : 'text-foreground-passive'
        )}
        title={t('workspaceRuntime.agents.triggerLabel', {
          count: agentSessionCount,
          working: workingAgentCount,
          attention: attentionAgentCount,
        })}
      >
        <WorkspaceBarActionGlyph icon={Bot}>
          <span
            className={cn(
              WORKSPACE_BAR_ACTION_COUNT_CLASS,
              attentionAgentCount > 0
                ? 'text-amber-600 dark:text-amber-300'
                : workingAgentCount > 0
                  ? 'text-primary'
                  : 'text-foreground-passive'
            )}
          >
            {agentSessionCount}
          </span>
        </WorkspaceBarActionGlyph>
        <span className="tabular-nums @max-[1440px]:hidden">{agentTriggerText}</span>
        {attentionAgentCount > 0 || workingAgentCount > 0 ? (
          <span
            aria-hidden
            className={cn(
              WORKSPACE_BAR_ACTION_INLINE_DOT_CLASS,
              attentionAgentCount > 0 ? 'bg-amber-500' : 'bg-primary'
            )}
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className={cn(WORKSPACE_BAR_CARD_CLASS, 'w-[440px]')}
      >
        <WorkspaceBarCardHeader
          icon={Bot}
          title={t('workspaceRuntime.agents.title')}
          description={t('workspaceRuntime.agents.description')}
        />
        <div className="grid grid-cols-4 gap-px bg-border">
          <WorkspaceResourceMetric
            label={t('workspaceRuntime.agents.sessions')}
            value={String(agentSessionCount)}
            ariaLabel={t('workspaceRuntime.agents.sessions')}
            controls="agent-panel-list"
            expanded={agentPanelTab === 'all'}
            selected={agentPanelTab === 'all'}
            onClick={() => setAgentPanelTab('all')}
          />
          <WorkspaceResourceMetric
            label={t('workspaceRuntime.agents.working')}
            value={String(workingAgentCount)}
            ariaLabel={t('workspaceRuntime.agents.working')}
            controls="agent-panel-list"
            expanded={agentPanelTab === 'working'}
            selected={agentPanelTab === 'working'}
            onClick={() => setAgentPanelTab('working')}
          />
          <WorkspaceResourceMetric
            label={t('workspaceRuntime.agents.attention')}
            value={String(attentionAgentCount)}
            ariaLabel={t('workspaceRuntime.agents.attention')}
            controls="agent-panel-list"
            expanded={agentPanelTab === 'needs-reply'}
            selected={agentPanelTab === 'needs-reply'}
            onClick={() => setAgentPanelTab('needs-reply')}
          />
          <WorkspaceResourceMetric
            label={t('workspaceRuntime.agents.pendingAcceptance')}
            value={String(pendingAcceptanceTasks.length)}
            ariaLabel={t('workspaceRuntime.agents.pendingAcceptance')}
            controls="agent-panel-list"
            expanded={agentPanelTab === 'pending-acceptance'}
            selected={agentPanelTab === 'pending-acceptance'}
            onClick={() => setAgentPanelTab('pending-acceptance')}
          />
        </div>
        {agentPanelTab !== 'pending-acceptance' ? (
          displayedAgentSessions.length > 0 ? (
            <div id="agent-panel-list" className="max-h-80 overflow-y-auto p-2">
              {displayedAgentSessions.map((session) => {
                const title =
                  (session.runtimeId
                    ? formatConversationTitleForDisplay(
                        session.runtimeId,
                        session.title ?? ''
                      ).trim()
                    : session.title?.trim()) ||
                  t('workspaceRuntime.agents.sessionFallback', {
                    id: session.conversationId.slice(0, 8),
                  });
                const taskTitle =
                  session.taskTitle?.trim() ||
                  t('workspaceRuntime.agents.taskFallback', {
                    id: session.taskId.slice(0, 8),
                  });
                const taskContext = getDistinctAgentTaskTitle(title, taskTitle);
                const config = session.runtimeId ? agentConfig[session.runtimeId] : undefined;
                return (
                  <button
                    key={agentSessionKey(session)}
                    type="button"
                    aria-label={t('workspaceRuntime.agents.openSession', { title })}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-background-2 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => openAgentSession(session)}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      {config ? (
                        <AgentLogo
                          logo={config.logo}
                          alt={config.alt}
                          isSvg={config.isSvg}
                          invertInDark={config.invertInDark}
                          className="size-4"
                        />
                      ) : (
                        <Bot aria-hidden className="size-4" />
                      )}
                    </span>
                    <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm leading-5 text-foreground" title={title}>
                        {title}
                      </span>
                      <span className="font-mono text-[10px] leading-4 tabular-nums text-foreground-passive">
                        {formatBytes(session.memoryBytes)}
                      </span>
                      <span className="col-span-2 flex min-w-0 items-center gap-1.5 text-[10px] leading-4">
                        {taskContext ? (
                          <span
                            className="min-w-0 flex-1 truncate text-[11px] text-foreground-passive"
                            title={taskContext}
                          >
                            {taskContext}
                          </span>
                        ) : null}
                        <span className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded-sm bg-background-2 px-1 text-foreground-muted">
                          <AgentStatusIndicator
                            status={session.status}
                            disableTooltip
                            boxClassName="size-3.5"
                          />
                          {t(`agentStatus.${session.status}`)}
                        </span>
                        {session.tmuxBacked ? (
                          <span title={t('workspaceRuntime.agents.tmuxRunning')}>
                            <Boxes
                              aria-label={t('workspaceRuntime.agents.tmuxRunning')}
                              className="size-3 shrink-0 text-foreground-passive"
                            />
                          </span>
                        ) : null}
                        <span className="ml-auto shrink-0 font-mono tabular-nums text-foreground-passive">
                          {Math.round(session.cpuPercent)}% CPU · PID {session.pid ?? '—'}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div
              id="agent-panel-list"
              className="px-3 py-6 text-center text-xs text-foreground-passive"
            >
              {t('workspaceRuntime.agents.empty')}
            </div>
          )
        ) : pendingAcceptanceTasks.length > 0 ? (
          <div id="agent-panel-list" className="p-2">
            <div className="px-1 py-1.5">
              <div className="text-sm font-medium">
                {t('workspaceRuntime.agents.pendingAcceptanceQueue')}
              </div>
              <div className="mt-0.5 text-xs text-foreground-passive">
                {t('workspaceRuntime.agents.pendingAcceptanceDescription')}
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {pendingAcceptanceTasks.map((task) => (
                <div
                  key={`${task.projectId}:${task.taskId}`}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-background-2"
                >
                  <button
                    type="button"
                    aria-label={t('workspaceRuntime.agents.openPendingAcceptance', {
                      title: task.taskName,
                    })}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => openPendingAcceptanceTask(task)}
                  >
                    <ClipboardCheck aria-hidden className="size-4 shrink-0 text-status-in-review" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">
                        {task.taskName}
                      </span>
                      <span className="block truncate text-[11px] text-foreground-passive">
                        {task.projectName}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => restorePendingAcceptanceTask(task)}
                  >
                    {t('workspaceRuntime.agents.restorePendingAcceptance')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => archivePendingAcceptanceTask(task)}
                  >
                    {t('workspaceRuntime.agents.archivePendingAcceptance')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            id="agent-panel-list"
            className="px-3 py-6 text-center text-xs text-foreground-passive"
          >
            {t('workspaceRuntime.agents.pendingAcceptanceEmpty')}
          </div>
        )}
        <WorkspaceBarCardFooter className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-foreground-muted">
              {isScanningTmux && !tmuxReclamation
                ? t('workspaceRuntime.agents.scanningBackgroundSessions')
                : t('workspaceRuntime.agents.backgroundSessionSummary', {
                    count: tmuxReclamation?.sessionCount ?? 0,
                    reclaimable: tmuxReclamation?.reclaimableCount ?? 0,
                  })}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-foreground-passive">
              {t('workspaceRuntime.agents.reclamationPolicy')}
            </div>
          </div>
          {tmuxReclamation?.reclaimableCount ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={isScanningTmux || isReclaimingTmux}
              onClick={confirmTmuxCleanup}
            >
              {isReclaimingTmux
                ? t('workspaceRuntime.agents.reclaiming')
                : t('workspaceRuntime.agents.reclaim')}
            </Button>
          ) : null}
        </WorkspaceBarCardFooter>
      </PopoverContent>
    </Popover>
  );
});
