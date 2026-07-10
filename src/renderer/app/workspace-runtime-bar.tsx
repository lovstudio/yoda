import { Brain, Gauge, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getRuntime, isValidRuntimeId, type RuntimeId } from '@shared/runtime-registry';
import { useTaskStats } from '@renderer/features/tasks/hooks/useTaskStats';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { AgentInfoCard } from '@renderer/lib/components/agent-selector/agent-info-card';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';

export function explicitConversationRuntimeId(value: unknown): RuntimeId | null {
  return typeof value === 'string' && isValidRuntimeId(value) ? value : null;
}

export const WorkspaceRuntimeBar = observer(function WorkspaceRuntimeBar() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isCompacting, setIsCompacting] = useState(false);
  const route = appState.navigation.currentViewId;
  const params = appState.navigation.viewParamsStore[route] as
    | { projectId?: string; taskId?: string }
    | undefined;
  const provisionedTask =
    route === 'task' && params?.projectId && params.taskId
      ? asProvisioned(getTaskStore(params.projectId, params.taskId))
      : undefined;
  const runtimeId = explicitConversationRuntimeId(
    provisionedTask?.taskView.tabManager.activeConversation?.data.runtimeId
  );
  const runtime = runtimeId ? getRuntime(runtimeId) : null;
  const activeConversationId = provisionedTask?.taskView.tabManager.activeConversationId;
  const {
    data: taskStats,
    refetch: refreshTaskStats,
    isRefetching: isRefreshingUsage,
  } = useTaskStats(params?.projectId ?? '', params?.taskId ?? '', {
    enabled: Boolean(
      route === 'task' && params?.projectId && params.taskId && activeConversationId
    ),
    // Codex appends live context-window snapshots to its rollout while a turn
    // is running. Keep the status bar current without waiting for session exit.
    refetchInterval: activeConversationId ? 15_000 : false,
  });
  const activeSessionUsage =
    route === 'task' && activeConversationId
      ? (taskStats?.conversations.find((item) => item.conversationId === activeConversationId) ??
        null)
      : null;
  const sessionTokens = activeSessionUsage?.tokens ?? null;
  const sessionContext = activeSessionUsage?.context ?? null;
  const contextPercent = sessionContext
    ? Math.round((sessionContext.usedTokens / sessionContext.limitTokens) * 100)
    : null;
  const contextRemaining = sessionContext
    ? Math.max(0, sessionContext.limitTokens - sessionContext.usedTokens)
    : null;
  const contextTone = contextPercent != null ? getUsageTone(contextPercent) : 'bg-emerald-500';
  const contextTitle = sessionContext
    ? [
        t('workspaceRuntime.contextUsageTitle', {
          used: formatCompactNumber(sessionContext.usedTokens),
          limit: formatCompactNumber(sessionContext.limitTokens),
          percent: contextPercent,
        }),
        ...(sessionTokens
          ? [
              t('workspaceRuntime.sessionTokenTotal', {
                tokens: formatCompactNumber(sessionTokens.total),
              }),
            ]
          : []),
        ...(sessionContext.resetCount > 0
          ? [
              t('workspaceRuntime.contextResets', { count: sessionContext.resetCount }),
              ...(sessionContext.lastResetAt
                ? [
                    t('workspaceRuntime.contextLastReset', {
                      time: new Intl.DateTimeFormat(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(sessionContext.lastResetAt)),
                    }),
                  ]
                : []),
            ]
          : []),
      ].join('\n')
    : null;
  const connectionId = provisionedTask?.workspace.sshConnectionId;
  const dependency = runtimeId
    ? connectionId
      ? appState.dependencies.getRemote(connectionId).data?.[runtimeId]
      : appState.dependencies.agentStatuses[runtimeId]
    : undefined;
  const taskTerminalActive = Boolean(
    provisionedTask?.taskView.isTerminalDrawerOpen &&
      provisionedTask.taskView.activeBottomPanelTab === 'terminals'
  );
  const terminalActive = provisionedTask ? taskTerminalActive : workspaceShellStore.isShellOpen;
  const canCompactContext = Boolean(
    runtimeId === 'codex' && params?.projectId && params.taskId && activeConversationId
  );
  const shortAccountWindow = sessionContext?.rateLimits[0] ?? null;

  const toggleTerminal = () => {
    if (provisionedTask) {
      if (workspaceShellStore.isOpen) workspaceShellStore.close();
      if (taskTerminalActive) {
        provisionedTask.taskView.setTerminalDrawerOpen(false);
        return;
      }
      provisionedTask.taskView.setBottomPanelTab('terminals');
      provisionedTask.taskView.setTerminalDrawerOpen(true);
      provisionedTask.taskView.setFocusedRegion('bottom');
      return;
    }
    void workspaceShellStore.toggleShell().catch(() => {});
  };

  const compactContext = async () => {
    if (
      !canCompactContext ||
      !params?.projectId ||
      !params.taskId ||
      !activeConversationId ||
      !runtimeId
    ) {
      toast.error(t('workspaceRuntime.compactContextUnavailable'));
      return;
    }
    setIsCompacting(true);
    try {
      const injected = await rpc.conversations.injectConversationPrompt({
        projectId: params.projectId,
        taskId: params.taskId,
        conversationId: activeConversationId,
        runtime: runtimeId,
        prompt: '/compact',
      });
      if (!injected) {
        toast.error(t('workspaceRuntime.compactContextUnavailable'));
        return;
      }
      toast.success(t('workspaceRuntime.compactContextStarted'));
    } catch {
      toast.error(t('workspaceRuntime.compactContextUnavailable'));
    } finally {
      setIsCompacting(false);
    }
  };

  const manageAccount = () => {
    if (!runtimeId || connectionId) return;
    appState.sidePane.pinView('settings', { tab: 'clis-models', runtimeId });
  };

  const refreshAccountUsage = async () => {
    await refreshTaskStats();
    toast.success(t('workspaceRuntime.accountUsageRefreshed'));
  };

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-background-secondary px-2 text-[11px] text-foreground-muted">
      {runtimeId ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <Popover>
            <PopoverTrigger
              aria-label={t('workspaceRuntime.currentSessionTitle', {
                name: runtime?.name ?? runtimeId,
              })}
              className="flex h-5 min-w-0 items-center rounded-sm px-1 text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
              title={t('workspaceRuntime.currentSessionTitle', {
                name: runtime?.name ?? runtimeId,
              })}
            >
              <span className="truncate font-medium text-foreground">
                {runtime?.name ?? runtimeId}
              </span>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              sideOffset={8}
              className="w-auto border border-border bg-background p-0 text-foreground shadow-lg"
            >
              <AgentInfoCard id={runtimeId} dependency={dependency} connectionId={connectionId} />
            </PopoverContent>
          </Popover>
          {sessionContext && contextPercent != null ? (
            <>
              <span aria-hidden>·</span>
              <Popover>
                <PopoverTrigger
                  aria-label={t('workspaceRuntime.contextUsage', {
                    used: formatCompactNumber(sessionContext.usedTokens),
                    limit: formatCompactNumber(sessionContext.limitTokens),
                    percent: contextPercent,
                  })}
                  className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
                  title={contextTitle ?? undefined}
                >
                  <Brain className="size-3.5" />
                  <span>{t('workspaceRuntime.contextUsageShort')}</span>
                  <ContextProgressBar percent={contextPercent} tone={contextTone} compact />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="top"
                  sideOffset={8}
                  className="w-80 gap-0 border border-border bg-background p-0 text-foreground shadow-lg"
                >
                  <div className="flex flex-col gap-3 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">
                          {t('workspaceRuntime.contextPopoverTitle')}
                        </div>
                        <div className="mt-0.5 text-xs text-foreground-passive">
                          {t('workspaceRuntime.contextPopoverDescription')}
                        </div>
                      </div>
                      <span className="font-mono text-sm tabular-nums text-foreground-muted">
                        {contextPercent}%
                      </span>
                    </div>
                    <ContextProgressBar percent={contextPercent} tone={contextTone} />
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <div className="font-mono text-2xl leading-none tabular-nums">
                          {formatCompactNumber(sessionContext.usedTokens)}
                        </div>
                        <div className="mt-1 text-xs text-foreground-passive">
                          {t('workspaceRuntime.contextOfTotal', {
                            total: formatCompactNumber(sessionContext.limitTokens),
                          })}
                        </div>
                      </div>
                      <div className="text-right text-xs text-foreground-passive">
                        <div>{t('workspaceRuntime.contextRemaining')}</div>
                        <div className="mt-0.5 font-mono tabular-nums text-foreground-muted">
                          {formatCompactNumber(contextRemaining ?? 0)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-border" />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-3 text-xs">
                    <ContextMetric
                      label={t('workspaceRuntime.sessionTokenTotalLabel')}
                      value={sessionTokens ? formatCompactNumber(sessionTokens.total) : '—'}
                    />
                    <ContextMetric
                      label={t('workspaceRuntime.contextCompactionsLabel')}
                      value={String(sessionContext.resetCount)}
                    />
                    {sessionContext.lastResetAt ? (
                      <ContextMetric
                        label={t('workspaceRuntime.contextLastCompactionLabel')}
                        value={formatPopoverTime(sessionContext.lastResetAt)}
                      />
                    ) : null}
                  </div>
                  {canCompactContext ? (
                    <div className="border-t border-border p-3">
                      <Button
                        className="w-full"
                        disabled={isCompacting}
                        size="sm"
                        variant="outline"
                        onClick={() => void compactContext()}
                      >
                        {isCompacting
                          ? t('workspaceRuntime.compactingContext')
                          : t('workspaceRuntime.compactContext')}
                      </Button>
                    </div>
                  ) : null}
                </PopoverContent>
              </Popover>
            </>
          ) : null}
          {shortAccountWindow && sessionContext ? (
            <>
              <span aria-hidden>·</span>
              <Popover>
                <PopoverTrigger
                  aria-label={t('workspaceRuntime.accountUsage')}
                  className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
                  title={t('workspaceRuntime.accountUsage')}
                >
                  <Gauge className="size-3.5" />
                  <span>{t('workspaceRuntime.accountUsageShort')}</span>
                  <ContextProgressBar
                    compact
                    percent={Math.round(shortAccountWindow.usedPercent)}
                    tone={getUsageTone(Math.round(shortAccountWindow.usedPercent))}
                  />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="top"
                  sideOffset={8}
                  className="w-72 gap-0 border border-border bg-background p-0 text-foreground shadow-lg"
                >
                  <div className="p-3">
                    <div className="text-sm font-medium">{t('workspaceRuntime.accountUsage')}</div>
                    <div className="mt-0.5 text-xs text-foreground-passive">
                      {t('workspaceRuntime.accountUsageDescription')}
                    </div>
                  </div>
                  <div className="border-t border-border" />
                  <div className="flex flex-col gap-3 p-3">
                    {sessionContext.rateLimits.map((limit) => {
                      const percent = Math.round(limit.usedPercent);
                      return (
                        <div key={limit.windowMinutes} className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-foreground-muted">
                              {t('workspaceRuntime.quotaWindow', {
                                minutes: limit.windowMinutes,
                              })}
                            </span>
                            <span className="font-mono tabular-nums text-foreground">
                              {percent}%
                            </span>
                          </div>
                          <ContextProgressBar percent={percent} tone={getUsageTone(percent)} />
                          <span className="text-[11px] text-foreground-passive">
                            {t('workspaceRuntime.accountQuotaStatus', {
                              remaining: Math.max(0, 100 - percent),
                              reset: limit.resetsAt
                                ? formatResetCountdown(limit.resetsAt)
                                : t('tasks.sessionInfo.unknown'),
                            })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-border p-3">
                    <p className="mb-2 text-[11px] leading-relaxed text-foreground-passive">
                      {t('workspaceRuntime.accountQuotaProviderControlled')}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        disabled={isRefreshingUsage}
                        size="sm"
                        variant="outline"
                        onClick={() => void refreshAccountUsage()}
                      >
                        {isRefreshingUsage
                          ? t('workspaceRuntime.refreshingAccountUsage')
                          : t('workspaceRuntime.refreshAccountUsage')}
                      </Button>
                      {!connectionId ? (
                        <Button
                          className="flex-1"
                          size="sm"
                          variant="outline"
                          onClick={manageAccount}
                        >
                          {t('workspaceRuntime.manageAccount')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </>
          ) : null}
        </div>
      ) : null}
      <span className="flex-1" />
      <button
        type="button"
        title={t('workspaceRuntime.terminal')}
        aria-label={t('workspaceRuntime.terminal')}
        aria-pressed={terminalActive}
        onClick={toggleTerminal}
        className={cn(
          'flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-background-2 hover:text-foreground',
          terminalActive && 'bg-background-2 text-foreground'
        )}
      >
        <Terminal className="size-3.5" />
        <span>{t('workspaceRuntime.terminal')}</span>
      </button>
    </div>
  );
});

function ContextProgressBar({
  percent,
  tone,
  compact = false,
}: {
  percent: number;
  tone: string;
  compact?: boolean;
}) {
  return (
    <span
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className={cn(
        'overflow-hidden rounded-full bg-foreground-muted/20',
        compact ? 'h-1 w-9' : 'h-1.5 w-full'
      )}
      role="progressbar"
    >
      <span
        className={cn('block h-full rounded-full transition-[width] duration-300', tone)}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </span>
  );
}

function ContextMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-foreground-passive">{label}</div>
      <div className="mt-0.5 truncate font-mono tabular-nums text-foreground-muted">{value}</div>
    </div>
  );
}

function formatPopoverTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value)
  );
}

function formatResetCountdown(value: string): string {
  const remainingMinutes = Math.max(
    0,
    Math.ceil((new Date(value).getTime() - Date.now()) / 60_000)
  );
  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: 'always',
    style: 'short',
  });

  if (remainingMinutes < 60) return formatter.format(remainingMinutes, 'minute');

  const remainingHours = Math.ceil(remainingMinutes / 60);
  if (remainingHours < 48) return formatter.format(remainingHours, 'hour');

  return formatter.format(Math.ceil(remainingHours / 24), 'day');
}

function getUsageTone(percent: number): string {
  if (percent >= 95) return 'bg-red-500';
  if (percent >= 80) return 'bg-amber-500';
  return 'bg-emerald-500';
}
