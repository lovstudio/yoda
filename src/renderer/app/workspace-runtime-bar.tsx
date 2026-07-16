import { useQuery } from '@tanstack/react-query';
import { Activity, Brain, ExternalLink, Gauge, MessageSquare, Route, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { MAAS_PLATFORMS } from '@shared/maas';
import {
  getRuntime,
  getRuntimeAccountProfile,
  isValidRuntimeId,
  type AgentAccountUsage,
  type RuntimeId,
} from '@shared/runtime-registry';
import { YODA_ACCOUNT_USAGE_DOC_URL } from '@shared/urls';
import { GatewayRuntimeSources } from '@renderer/features/agents/components/GatewayRuntimeSources';
import { useAiLogs } from '@renderer/features/ai-logs/use-ai-logs';
import { useMaasRuntimeBindings } from '@renderer/features/maas/useMaas';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useTaskStats } from '@renderer/features/tasks/hooks/useTaskStats';
import {
  resolveSessionPrompts,
  SESSION_PROMPTS_REFRESH_MS,
} from '@renderer/features/tasks/session-prompts';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { AgentInfoCard } from '@renderer/lib/components/agent-selector/agent-info-card';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { agentConfig } from '@renderer/utils/agentConfig';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';
import { getQuotaWindowLabel } from './workspace-runtime-bar-format';

export function explicitConversationRuntimeId(value: unknown): RuntimeId | null {
  return typeof value === 'string' && isValidRuntimeId(value) ? value : null;
}

export const WorkspaceRuntimeBar = observer(function WorkspaceRuntimeBar() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showConfirmActionModal = useShowModal('confirmActionModal');
  const { value: interfaceSettings, update: updateInterfaceSettings } =
    useAppSettingsKey('interface');
  const [isCompacting, setIsCompacting] = useState(false);
  const [isResettingAccountUsage, setIsResettingAccountUsage] = useState(false);
  const [sessionPromptCount, setSessionPromptCount] = useState<{
    conversationId: string;
    count: number;
  } | null>(null);
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
  const activeConversation = provisionedTask?.taskView.tabManager.activeConversation?.data ?? null;
  const runtime = runtimeId ? getRuntime(runtimeId) : null;
  const officialUsageUrl = runtimeId
    ? getRuntimeAccountProfile(runtimeId).officialSubscription.usageUrl
    : undefined;
  const runtimeConfig = runtimeId ? agentConfig[runtimeId] : null;
  const activeConversationId = provisionedTask?.taskView.tabManager.activeConversationId;
  const { data: taskStats } = useTaskStats(params?.projectId ?? '', params?.taskId ?? '', {
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
  const {
    data: accountUsage,
    refetch: refreshAccountUsageQuery,
    isFetching: isRefreshingUsage,
  } = useQuery<AgentAccountUsage>({
    queryKey: ['runtimeSettings', runtimeId, 'accountUsage'],
    queryFn: () => {
      if (!runtimeId) throw new Error('A runtime is required to read account usage.');
      return rpc.runtimeSettings.getAccountUsage(runtimeId) as Promise<AgentAccountUsage>;
    },
    enabled: runtimeId === 'codex' && !connectionId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const accountRateLimits =
    accountUsage && !accountUsage.error && accountUsage.rateLimits.length > 0
      ? accountUsage.rateLimits
      : (sessionContext?.rateLimits ?? []);
  const shortAccountWindow = accountRateLimits[0] ?? null;
  const sessionHistoryDocked = interfaceSettings?.dockSessionHistory ?? true;
  const displayedPromptCount =
    sessionPromptCount && sessionPromptCount.conversationId === activeConversation?.id
      ? sessionPromptCount.count
      : null;
  const sessionHistoryLabel = t('workspaceRuntime.sessionHistory', {
    count: displayedPromptCount ?? 0,
  });
  const maasBindings = useMaasRuntimeBindings();
  const runtimeGatewaySettings = useQuery<Record<string, RuntimeCustomConfig>>({
    queryKey: ['runtimeSettings', 'all'],
    queryFn: () => rpc.runtimeSettings.getAll() as Promise<Record<string, RuntimeCustomConfig>>,
    staleTime: 30_000,
  });
  const recentRuntimeLogs = useAiLogs(
    {
      ...(runtimeId ? { runtime: runtimeId } : {}),
      ...(activeConversationId ? { conversationId: activeConversationId } : {}),
      limit: 5,
    },
    Boolean(runtimeId && !connectionId)
  );
  const activeMaasBinding = runtimeId
    ? maasBindings.data?.find((binding) => binding.runtimeId === runtimeId)
    : undefined;
  const activeGatewayAuthProvider =
    runtimeId && !connectionId
      ? (runtimeGatewaySettings.data?.[runtimeId]?.authProvider ?? 'official-subscription')
      : null;
  const activeMaasPlatformId =
    activeGatewayAuthProvider === 'yoda-maas' ? (activeMaasBinding?.platformId ?? null) : null;
  const latestRuntimeLog = recentRuntimeLogs.data?.[0] ?? null;
  const latestVerifiedGatewayLog =
    recentRuntimeLogs.data?.find(
      (record) =>
        record.metadata?.authProvider === activeGatewayAuthProvider &&
        (activeGatewayAuthProvider !== 'yoda-maas' ||
          (record.metadata.maasEffective === 'true' &&
            (!activeMaasPlatformId || record.metadata.maasPlatformId === activeMaasPlatformId)))
    ) ?? null;
  const activeGatewaySourceLabel =
    activeGatewayAuthProvider === 'yoda-maas'
      ? activeMaasPlatformId
        ? MAAS_PLATFORMS[activeMaasPlatformId].name
        : t('workspaceRuntime.gateway.maas')
      : activeGatewayAuthProvider === 'official-api'
        ? t('workspaceRuntime.gateway.apiKey')
        : activeGatewayAuthProvider === 'official-subscription'
          ? t('workspaceRuntime.gateway.subscription')
          : t('workspaceRuntime.gateway.unconfigured');

  useEffect(() => {
    if (!activeConversation || !provisionedTask) return;
    let cancelled = false;
    const load = () =>
      resolveSessionPrompts(activeConversation, provisionedTask.path).then((prompts) => {
        if (!cancelled) {
          setSessionPromptCount({ conversationId: activeConversation.id, count: prompts.length });
        }
      });

    void load();
    const interval = window.setInterval(() => void load(), SESSION_PROMPTS_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeConversation, provisionedTask]);

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

  const handleAccountUsagePopoverOpen = (open: boolean) => {
    if (open && runtimeId === 'codex' && !connectionId) {
      void refreshAccountUsageQuery();
    }
  };

  const resetAccountUsage = async () => {
    if (!runtimeId || runtimeId !== 'codex' || connectionId) return;
    setIsResettingAccountUsage(true);
    try {
      const result = await rpc.runtimeSettings.resetAccountUsage(runtimeId);
      if (result.error || !result.outcome) {
        toast.error(t('workspaceRuntime.accountUsageResetFailed'));
        return;
      }
      if (result.outcome === 'nothingToReset') {
        toast(t('workspaceRuntime.accountUsageNothingToReset'));
        return;
      }
      if (result.outcome === 'noCredit') {
        toast.error(t('workspaceRuntime.accountUsageNoResetCredit'));
        await refreshAccountUsageQuery();
        return;
      }
      await refreshAccountUsageQuery();
      toast.success(t('workspaceRuntime.accountUsageResetSuccess'));
    } catch {
      toast.error(t('workspaceRuntime.accountUsageResetFailed'));
    } finally {
      setIsResettingAccountUsage(false);
    }
  };

  const confirmAccountUsageReset = () => {
    showConfirmActionModal({
      title: t('workspaceRuntime.confirmAccountUsageResetTitle'),
      description: t('workspaceRuntime.confirmAccountUsageResetDescription'),
      confirmLabel: t('workspaceRuntime.resetAccountUsage'),
      variant: 'default',
      onSuccess: () => void resetAccountUsage(),
    });
  };

  const toggleSessionHistoryDock = () => {
    updateInterfaceSettings({ dockSessionHistory: !sessionHistoryDocked });
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
              className="flex h-5 min-w-0 items-center gap-1.5 rounded-sm px-1 text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
              title={t('workspaceRuntime.currentSessionTitle', {
                name: runtime?.name ?? runtimeId,
              })}
            >
              {runtimeConfig ? (
                <AgentLogo
                  logo={runtimeConfig.logo}
                  alt=""
                  isSvg={runtimeConfig.isSvg}
                  invertInDark={runtimeConfig.invertInDark}
                  className="size-4 rounded-[2px]"
                />
              ) : null}
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
          {activeConversationId ? (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                aria-label={sessionHistoryLabel}
                aria-pressed={sessionHistoryDocked}
                title={sessionHistoryLabel}
                onClick={toggleSessionHistoryDock}
                className={cn(
                  'flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
                  sessionHistoryDocked && 'bg-background-2 text-foreground'
                )}
              >
                <MessageSquare className="size-3.5" />
                <span className="tabular-nums">{sessionHistoryLabel}</span>
              </button>
            </>
          ) : null}
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
          {shortAccountWindow || (runtimeId === 'codex' && !connectionId) ? (
            <>
              <span aria-hidden>·</span>
              <Popover onOpenChange={handleAccountUsagePopoverOpen}>
                <PopoverTrigger
                  aria-label={t('workspaceRuntime.accountUsage')}
                  className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
                  title={t('workspaceRuntime.accountUsage')}
                >
                  <Gauge className="size-3.5" />
                  <span>{t('workspaceRuntime.accountUsageShort')}</span>
                  {shortAccountWindow ? (
                    <ContextProgressBar
                      compact
                      percent={Math.round(shortAccountWindow.usedPercent)}
                      tone={getUsageTone(Math.round(shortAccountWindow.usedPercent))}
                    />
                  ) : null}
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
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <a
                        href={YODA_ACCOUNT_USAGE_DOC_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-xs text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
                      >
                        {t('workspaceRuntime.accountDocs')}
                        <ExternalLink aria-hidden className="size-3" />
                      </a>
                      {officialUsageUrl ? (
                        <a
                          href={officialUsageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex shrink-0 items-center gap-1 text-xs text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
                        >
                          {t('workspaceRuntime.officialAccountUsage', {
                            name: runtime?.name ?? runtimeId,
                          })}
                          <ExternalLink aria-hidden className="size-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="border-t border-border" />
                  <div className="flex flex-col gap-3 p-3">
                    {accountRateLimits.map((limit) => {
                      const percent = Math.round(limit.usedPercent);
                      const windowLabel = getQuotaWindowLabel(limit.windowMinutes);
                      return (
                        <div key={limit.windowMinutes} className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-foreground-muted">
                              {t(windowLabel.translationKey, {
                                value: windowLabel.value,
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
                  {runtimeId === 'codex' && !connectionId ? (
                    <div className="border-t border-border px-3 py-2.5 text-xs">
                      <span className="text-foreground-passive">
                        {t('workspaceRuntime.accountResetCredits')}
                      </span>
                      <span className="float-right font-mono tabular-nums text-foreground">
                        {accountUsage?.resetCreditsAvailable != null
                          ? t('workspaceRuntime.accountResetCreditsCount', {
                              count: accountUsage.resetCreditsAvailable,
                            })
                          : accountUsage?.error
                            ? t('workspaceRuntime.accountResetCreditsFailed')
                            : t('workspaceRuntime.accountResetCreditsLoading')}
                      </span>
                    </div>
                  ) : null}
                  <div className="border-t border-border p-3">
                    <p className="mb-2 text-[11px] leading-relaxed text-foreground-passive">
                      {t('workspaceRuntime.accountQuotaResetDescription')}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        disabled={
                          isRefreshingUsage ||
                          isResettingAccountUsage ||
                          accountUsage?.resetCreditsAvailable == null ||
                          accountUsage.resetCreditsAvailable <= 0
                        }
                        size="sm"
                        variant="outline"
                        onClick={confirmAccountUsageReset}
                      >
                        {isResettingAccountUsage
                          ? t('workspaceRuntime.resettingAccountUsage')
                          : accountUsage?.resetCreditsAvailable === 0
                            ? t('workspaceRuntime.noAccountResetCredits')
                            : t('workspaceRuntime.resetAccountUsage')}
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
      <Popover>
        <PopoverTrigger
          aria-label={t('workspaceRuntime.gateway.title')}
          className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          title={t('workspaceRuntime.gateway.title')}
        >
          <Route className="size-3.5" />
          <span>Gateway</span>
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              latestVerifiedGatewayLog
                ? 'bg-emerald-500'
                : runtimeId && !connectionId
                  ? 'bg-amber-500'
                  : 'bg-foreground-disabled'
            )}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className="w-[28rem] gap-0 border border-border bg-background p-0 text-foreground shadow-lg"
        >
          <div className="border-b border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t('workspaceRuntime.gateway.title')}</div>
                <div className="mt-0.5 text-xs text-foreground-passive">
                  {runtimeId && !connectionId
                    ? t('workspaceRuntime.gateway.currentSource', {
                        client: runtime?.name ?? runtimeId,
                        source: activeGatewaySourceLabel,
                      })
                    : t('workspaceRuntime.gateway.description')}
                </div>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                  latestVerifiedGatewayLog
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : runtimeId && !connectionId
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'bg-background-2 text-foreground-muted'
                )}
              >
                {latestVerifiedGatewayLog
                  ? t('workspaceRuntime.gateway.verified')
                  : runtimeId && !connectionId
                    ? t('workspaceRuntime.gateway.awaitingVerification')
                    : t('workspaceRuntime.gateway.global')}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-foreground-muted">
              <Activity className="size-3.5" />
              <span className="min-w-0 truncate">
                {latestVerifiedGatewayLog
                  ? t('workspaceRuntime.gateway.lastVerified', {
                      time: formatRuntimeTimestamp(latestVerifiedGatewayLog.startedAt),
                    })
                  : runtimeId && !connectionId && latestRuntimeLog
                    ? t('workspaceRuntime.gateway.restartRequired')
                    : runtimeId && !connectionId
                      ? t('workspaceRuntime.gateway.waitingForLog')
                      : t('workspaceRuntime.gateway.globalHint')}
              </span>
            </div>
          </div>
          <div className="grid gap-3 p-3">
            <GatewayRuntimeSources currentRuntimeId={!connectionId ? runtimeId : null} />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => appState.navigation.navigate('maas')}
              >
                {t('workspaceRuntime.gateway.manageMaas')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => appState.sidePane.pinView('settings', { tab: 'ai-logs' })}
              >
                {t('workspaceRuntime.gateway.openLogs')}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
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

function formatRuntimeTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

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
