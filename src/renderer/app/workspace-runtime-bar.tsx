import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Bot,
  Boxes,
  Brain,
  Cloud,
  ExternalLink,
  Gauge,
  MessageSquare,
  Settings2,
  Sparkles,
  Stethoscope,
  Terminal,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppAgentSessionResource } from '@shared/app-resource';
import { getMaasPlatformDefinition } from '@shared/maas';
import type { ComposerDefaults } from '@shared/project-settings';
import {
  getRuntime,
  getRuntimeAccountProfile,
  isValidRuntimeId,
  type AgentAccountUsage,
  type RuntimeId,
} from '@shared/runtime-registry';
import { YODA_ACCOUNT_USAGE_DOC_URL } from '@shared/urls';
import { openTaskTarget } from '@renderer/app/open-task-target';
import { MaasGlobalSelector } from '@renderer/features/maas/components/MaasGlobalSelector';
import { useMaasConnections, useMaasGlobalBinding } from '@renderer/features/maas/useMaas';
import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { SkillQuickSearchPopover } from '@renderer/features/skills/components/SkillQuickSearchPopover';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
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
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { agentConfig } from '@renderer/utils/agentConfig';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';
import { dualField, withComposerDefault } from './composer-project-overrides';
import {
  ComposerSettingsContent,
  DEFAULT_INPUT_PROMPT_LANGUAGE,
  DEFAULT_SUMMARY_OUTPUT_LANGUAGE,
  DEFAULT_TASK_OUTPUT_LANGUAGE,
} from './composer-settings-content';
import { startRendererPerformanceReporter } from './renderer-performance-reporter';
import { rankWorkspaceAgentSessions } from './workspace-agent-sessions';
import type { WorkspaceResourceDetailKind } from './workspace-resource-details-modal';
import {
  getWorkspaceLatencyP95,
  workspaceResourceHistoryStore,
} from './workspace-resource-history';
import { WorkspaceResourceMetric } from './workspace-resource-metric';
import { WORKSPACE_RESOURCE_QUERY_TIMING } from './workspace-resource-monitoring';
import { WorkspaceResourceTrend } from './workspace-resource-trend';
import { getQuotaWindowLabel } from './workspace-runtime-bar-format';

type WorkspaceAgentSession = Omit<AppAgentSessionResource, 'runtimeId' | 'title' | 'taskTitle'> & {
  runtimeId?: AppAgentSessionResource['runtimeId'];
  title?: string;
  taskTitle?: string;
};

function agentSessionKey(
  session: Pick<AppAgentSessionResource, 'projectId' | 'taskId' | 'conversationId'>
): string {
  return `${session.projectId}\0${session.taskId}\0${session.conversationId}`;
}

export function explicitConversationRuntimeId(value: unknown): RuntimeId | null {
  return typeof value === 'string' && isValidRuntimeId(value) ? value : null;
}

export const WorkspaceRuntimeBar = observer(function WorkspaceRuntimeBar() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { navigate } = useNavigate();
  const showDoctorModal = useShowModal('doctorModal');
  const showConfirmActionModal = useShowModal('confirmActionModal');
  const showResourceDetailsModal = useShowModal('workspaceResourceDetailsModal');
  const { value: interfaceSettings, update: updateInterfaceSettings } =
    useAppSettingsKey('interface');
  const { value: homeDraft, update: updateHomeDraft } = useAppSettingsKey('homeDraft');
  const { value: taskSettings, update: updateTaskSettings } = useAppSettingsKey('tasks');
  const { value: defaultRuntime } = useAppSettingsKey('defaultRuntime');
  const [isCompacting, setIsCompacting] = useState(false);
  const [isResettingAccountUsage, setIsResettingAccountUsage] = useState(false);
  const [isAgentPopoverOpen, setIsAgentPopoverOpen] = useState(false);
  const [isResourcePopoverOpen, setIsResourcePopoverOpen] = useState(false);
  const [isConfigPopoverOpen, setIsConfigPopoverOpen] = useState(false);
  const [isSkillPopoverOpen, setIsSkillPopoverOpen] = useState(false);
  const resourceHistory = useSyncExternalStore(
    workspaceResourceHistoryStore.subscribe,
    workspaceResourceHistoryStore.getSnapshot,
    workspaceResourceHistoryStore.getSnapshot
  );
  const [sessionPromptCount, setSessionPromptCount] = useState<{
    conversationId: string;
    count: number;
  } | null>(null);

  useEffect(() => startRendererPerformanceReporter(), []);
  const route = appState.navigation.currentViewId;
  const params = appState.navigation.viewParamsStore[route] as
    | { projectId?: string; taskId?: string }
    | undefined;
  const provisionedTask =
    route === 'task' && params?.projectId && params.taskId
      ? asProvisioned(getTaskStore(params.projectId, params.taskId))
      : undefined;
  const activeProjectId = params?.projectId;
  const projectSettingsStore = activeProjectId
    ? getProjectSettingsStore(activeProjectId)
    : undefined;
  const projectSettings = projectSettingsStore?.settings ?? null;
  const composerDefaults = projectSettings?.composerDefaults;
  const setComposerDefault = useCallback(
    <K extends keyof ComposerDefaults>(field: K, value: ComposerDefaults[K] | undefined) => {
      if (!projectSettingsStore || !projectSettings) return;
      void projectSettingsStore.save({
        ...projectSettings,
        composerDefaults: withComposerDefault(projectSettings.composerDefaults, field, value),
      });
    },
    [projectSettingsStore, projectSettings]
  );
  const attachImagesField = dualField<boolean>({
    override: composerDefaults?.attachImagesAsPaths,
    globalValue: homeDraft?.attachImagesAsPaths ?? false,
    setGlobal: (value) => updateHomeDraft({ attachImagesAsPaths: value }),
    setOverride: (value) => setComposerDefault('attachImagesAsPaths', value),
    hasProject: Boolean(activeProjectId),
  });
  const inputPromptLanguageField = dualField({
    override: composerDefaults?.inputPromptLanguage,
    globalValue: taskSettings?.inputPromptLanguage ?? DEFAULT_INPUT_PROMPT_LANGUAGE,
    setGlobal: (value) => updateTaskSettings({ inputPromptLanguage: value }),
    setOverride: (value) => setComposerDefault('inputPromptLanguage', value),
    hasProject: Boolean(activeProjectId),
  });
  const namingLanguageField = dualField({
    override: composerDefaults?.namingLanguage,
    globalValue: taskSettings?.namingLanguage ?? DEFAULT_TASK_OUTPUT_LANGUAGE,
    setGlobal: (value) => updateTaskSettings({ namingLanguage: value }),
    setOverride: (value) => setComposerDefault('namingLanguage', value),
    hasProject: Boolean(activeProjectId),
  });
  const summaryLanguageField = dualField({
    override: composerDefaults?.summaryLanguage,
    globalValue: taskSettings?.summaryLanguage ?? DEFAULT_SUMMARY_OUTPUT_LANGUAGE,
    setGlobal: (value) => updateTaskSettings({ summaryLanguage: value }),
    setOverride: (value) => setComposerDefault('summaryLanguage', value),
    hasProject: Boolean(activeProjectId),
  });
  const runtimeId = explicitConversationRuntimeId(
    provisionedTask?.taskView.tabManager.activeConversation?.data.runtimeId
  );
  const configRuntimeId =
    runtimeId ??
    composerDefaults?.runtimeId ??
    (isValidRuntimeId(homeDraft?.runtimeOverride) ? homeDraft.runtimeOverride : null) ??
    (isValidRuntimeId(defaultRuntime) ? defaultRuntime : 'claude');
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
  const hostedQuickAction = Boolean(
    provisionedTask && workspaceShellStore.isCommandHostedInTask(provisionedTask.taskId)
  );
  const hostedQuickActionActive = Boolean(
    hostedQuickAction && provisionedTask?.taskView.isTerminalDrawerOpen
  );
  const terminalActive = provisionedTask
    ? taskTerminalActive || hostedQuickActionActive
    : workspaceShellStore.isShellOpen;
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
  const globalMaasBinding = useMaasGlobalBinding();
  const { data: maasConnections } = useMaasConnections();
  const selectedMaasPlatformId = globalMaasBinding.data?.enabled
    ? globalMaasBinding.data.platformId
    : null;
  const selectedMaasConnection = maasConnections?.find(
    (connection) => connection.platformId === selectedMaasPlatformId
  );
  const selectedMaasLabel = selectedMaasPlatformId
    ? `MaaS (${selectedMaasConnection?.displayName ?? getMaasPlatformDefinition(selectedMaasPlatformId).name})`
    : 'MaaS';
  const { data: resourceSnapshot } = useQuery({
    queryKey: ['app', 'resourceSnapshot'],
    queryFn: () => rpc.app.getResourceSnapshot(),
    ...WORKSPACE_RESOURCE_QUERY_TIMING,
  });
  const { data: worktreeStorage, isFetching: isFetchingWorktreeStorage } = useQuery({
    queryKey: ['projects', 'worktreeStorage'],
    queryFn: () => rpc.projects.getWorktreeStorageSnapshot(),
    enabled: isResourcePopoverOpen,
    staleTime: 60_000,
    refetchInterval: (query) =>
      query.state.data?.pendingInspectionCount && query.state.data.pendingInspectionCount > 0
        ? 1_000
        : false,
    refetchOnWindowFocus: false,
  });
  const isScanningWorktrees =
    isFetchingWorktreeStorage || (worktreeStorage?.pendingInspectionCount ?? 0) > 0;
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
  const tmuxSessionCount = agentSessions.filter((session) => session.tmuxBacked).length;
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
  const resourceLatencyP95 = getWorkspaceLatencyP95(resourceSnapshot);
  const latencyTitle = resourceSnapshot?.rendererPerformance
    ? t('workspaceRuntime.resources.latencyDetails', {
        input: resourceSnapshot.rendererPerformance.inputLatency.p95Ms,
        renderer: resourceSnapshot.rendererPerformance.eventLoop.p95Ms,
      })
    : undefined;
  const worktreeMetricValue = worktreeStorage
    ? formatBytes(worktreeStorage.totalBytes)
    : isScanningWorktrees
      ? '…'
      : '—';
  const worktreeMetricTitle = worktreeStorage
    ? t('workspaceRuntime.resources.worktreeSummary', {
        count: worktreeStorage.worktreeCount,
        reclaimable: worktreeStorage.reclaimableCount,
        size: formatBytes(worktreeStorage.reclaimableBytes),
      })
    : t('workspaceRuntime.resources.scanningWorktrees');

  useEffect(() => {
    if (!resourceSnapshot) return;
    workspaceResourceHistoryStore.append(resourceSnapshot);
  }, [resourceSnapshot]);

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
      if (hostedQuickAction) {
        const nextOpen = !provisionedTask.taskView.isTerminalDrawerOpen;
        provisionedTask.taskView.setBottomPanelOpen(nextOpen);
        if (nextOpen) provisionedTask.taskView.setFocusedRegion('bottom');
        return;
      }
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

  const handleSkillInstalled = (skill: { key: string; displayName: string }) => {
    setIsSkillPopoverOpen(false);
    if (!provisionedTask || !activeConversation || connectionId) return;
    showConfirmActionModal({
      title: t('skills.quickSearch.reloadTitle'),
      description: t('skills.quickSearch.reloadDescription', { name: skill.displayName }),
      confirmLabel: t('skills.quickSearch.reloadConfirm'),
      variant: 'default',
      onSuccess: () =>
        void provisionedTask.conversations.restartConversation(
          activeConversation.id,
          undefined,
          undefined,
          skill.key
        ),
    });
  };

  const openSkillsManagement = () => {
    setIsSkillPopoverOpen(false);
    appState.navigation.navigate('skills');
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

  const openResourceDetails = (kind: WorkspaceResourceDetailKind) => {
    setIsResourcePopoverOpen(false);
    showResourceDetailsModal({
      kind,
      initialSnapshot: resourceSnapshot,
      initialHistory: resourceHistory,
      initialWorktreeStorage: worktreeStorage,
    });
  };

  return (
    <footer
      data-yoda-surface="workspace-runtime-bar"
      className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-background-secondary px-2 text-[11px] text-foreground-muted"
    >
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
      <Popover open={isConfigPopoverOpen} onOpenChange={setIsConfigPopoverOpen}>
        <PopoverTrigger
          aria-label={t('workspaceRuntime.config.title')}
          className={cn(
            'flex h-5 shrink-0 items-center gap-1 rounded px-1.5 transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
            isConfigPopoverOpen && 'bg-background-2 text-foreground'
          )}
          title={t('workspaceRuntime.config.title')}
        >
          <Settings2 className="size-3.5" />
          <span>{t('workspaceRuntime.config.title')}</span>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="max-h-[min(32rem,calc(100vh-3rem))] w-96 gap-0 overflow-y-auto border border-border bg-background p-0 text-foreground shadow-lg"
        >
          <div className="border-b border-border p-3">
            <div className="text-sm font-medium">{t('workspaceRuntime.config.title')}</div>
            <div className="mt-0.5 text-xs text-foreground-passive">
              {t('workspaceRuntime.config.description')}
            </div>
          </div>
          <div className="p-3">
            <ComposerSettingsContent
              runtimeId={configRuntimeId}
              projectId={activeProjectId}
              projectPath={connectionId ? undefined : provisionedTask?.path}
              attachImagesAsPaths={attachImagesField.value}
              inputPromptLanguage={inputPromptLanguageField.value}
              namingLanguage={namingLanguageField.value}
              summaryLanguage={summaryLanguageField.value}
              onAttachImagesAsPathsChange={attachImagesField.setValue}
              onInputPromptLanguageChange={inputPromptLanguageField.setValue}
              onNamingLanguageChange={namingLanguageField.setValue}
              onSummaryLanguageChange={summaryLanguageField.setValue}
              onManagePrompts={() => {
                setIsConfigPopoverOpen(false);
                appState.navigation.navigate('library', { section: 'prompts' });
              }}
            />
          </div>
        </PopoverContent>
      </Popover>
      <Popover open={isAgentPopoverOpen} onOpenChange={setIsAgentPopoverOpen}>
        <PopoverTrigger
          aria-label={t('workspaceRuntime.agents.triggerLabel', {
            count: agentSessionCount,
            working: workingAgentCount,
            attention: attentionAgentCount,
          })}
          className={cn(
            'flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
            attentionAgentCount > 0 ? 'text-foreground' : 'text-foreground-passive'
          )}
          title={t('workspaceRuntime.agents.triggerLabel', {
            count: agentSessionCount,
            working: workingAgentCount,
            attention: attentionAgentCount,
          })}
        >
          <Bot className="size-3.5" />
          <span className="tabular-nums">{agentTriggerText}</span>
          {attentionAgentCount > 0 || workingAgentCount > 0 ? (
            <span
              aria-hidden
              className={cn(
                'size-1.5 rounded-full',
                attentionAgentCount > 0 ? 'bg-amber-500' : 'bg-primary'
              )}
            />
          ) : null}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-[440px] gap-0 border border-border bg-background p-0 text-foreground shadow-lg"
        >
          <div className="border-b border-border p-3">
            <div className="text-sm font-medium">{t('workspaceRuntime.agents.title')}</div>
            <div className="mt-0.5 text-xs text-foreground-passive">
              {t('workspaceRuntime.agents.description')}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-px bg-border">
            <WorkspaceResourceMetric
              label={t('workspaceRuntime.agents.sessions')}
              value={String(agentSessionCount)}
            />
            <WorkspaceResourceMetric
              label={t('workspaceRuntime.agents.working')}
              value={String(workingAgentCount)}
            />
            <WorkspaceResourceMetric
              label={t('workspaceRuntime.agents.attention')}
              value={String(attentionAgentCount)}
            />
            <WorkspaceResourceMetric
              label={t('workspaceRuntime.agents.tmux')}
              value={String(tmuxSessionCount)}
            />
          </div>
          {agentSessions.length > 0 ? (
            <div className="max-h-80 overflow-y-auto p-2">
              {agentSessions.map((session) => {
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
                const config = session.runtimeId ? agentConfig[session.runtimeId] : undefined;
                return (
                  <button
                    key={agentSessionKey(session)}
                    type="button"
                    aria-label={t('workspaceRuntime.agents.openSession', { title })}
                    className="flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-background-2 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => openAgentSession(session)}
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center">
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
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-foreground-passive">
                          {formatBytes(session.memoryBytes)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-foreground-passive">
                        {taskTitle}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className="inline-flex items-center gap-1 rounded-full bg-background-2 px-1.5 py-0.5 text-foreground-muted">
                          <AgentStatusIndicator
                            status={session.status}
                            disableTooltip
                            boxClassName="size-3"
                          />
                          {t(`agentStatus.${session.status}`)}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
                            session.tmuxBacked
                              ? 'bg-status-in-review/10 text-status-in-review'
                              : 'bg-background-2 text-foreground-passive'
                          )}
                        >
                          <Boxes aria-hidden className="size-3" />
                          {session.tmuxBacked
                            ? t('workspaceRuntime.agents.tmuxRunning')
                            : t('workspaceRuntime.agents.noTmux')}
                        </span>
                        <span className="font-mono tabular-nums text-foreground-passive">
                          {Math.round(session.cpuPercent)}% CPU · PID {session.pid ?? '—'}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-xs text-foreground-passive">
              {t('workspaceRuntime.agents.empty')}
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Popover open={isResourcePopoverOpen} onOpenChange={setIsResourcePopoverOpen}>
        <PopoverTrigger
          aria-label={t('workspaceRuntime.resources.triggerLabel')}
          className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          title={t('workspaceRuntime.resources.triggerLabel')}
        >
          <Activity aria-hidden className="size-3.5" />
          <span>{t('workspaceRuntime.resources.triggerShort')}</span>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-[420px] gap-0 border border-border bg-background p-0 text-foreground shadow-lg"
        >
          <div className="border-b border-border p-3">
            <div className="text-sm font-medium">{t('workspaceRuntime.resources.title')}</div>
            <div className="mt-0.5 text-xs text-foreground-passive">
              {t('workspaceRuntime.resources.description')}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px bg-border">
            <WorkspaceResourceMetric
              label={t('workspaceRuntime.resources.cpu')}
              value={resourceSnapshot ? `${Math.round(resourceSnapshot.cpuPercent)}%` : '—'}
              ariaLabel={t('workspaceRuntime.resources.details.openMetric', {
                metric: t('workspaceRuntime.resources.cpu'),
              })}
              opensDialog
              onClick={() => openResourceDetails('cpu')}
            />
            <WorkspaceResourceMetric
              label={t('workspaceRuntime.resources.memory')}
              value={resourceSnapshot ? formatBytes(resourceSnapshot.memoryBytes) : '—'}
              ariaLabel={t('workspaceRuntime.resources.details.openMetric', {
                metric: t('workspaceRuntime.resources.memory'),
              })}
              opensDialog
              onClick={() => openResourceDetails('memory')}
            />
            <WorkspaceResourceMetric
              label={t('workspaceRuntime.resources.latency')}
              value={resourceLatencyP95 == null ? '—' : `${resourceLatencyP95} ms`}
              title={latencyTitle}
              ariaLabel={t('workspaceRuntime.resources.details.openMetric', {
                metric: t('workspaceRuntime.resources.latency'),
              })}
              opensDialog
              onClick={() => openResourceDetails('latency')}
            />
            <WorkspaceResourceMetric
              label={t('workspaceRuntime.resources.worktrees')}
              value={worktreeMetricValue}
              title={worktreeMetricTitle}
              ariaLabel={t('workspaceRuntime.resources.details.openMetric', {
                metric: t('workspaceRuntime.resources.worktrees'),
              })}
              opensDialog
              onClick={() => openResourceDetails('worktrees')}
            />
          </div>
          <WorkspaceResourceTrend
            history={resourceHistory}
            title={t('workspaceRuntime.resources.trendTitle')}
            refreshLabel={t('workspaceRuntime.resources.trendRefresh')}
            cpuLabel={t('workspaceRuntime.resources.cpu')}
            cpuValue={resourceSnapshot ? `${Math.round(resourceSnapshot.cpuPercent)}%` : '—'}
            cpuAriaLabel={t('workspaceRuntime.resources.cpuTrendLabel', {
              value: resourceSnapshot ? `${Math.round(resourceSnapshot.cpuPercent)}%` : '—',
            })}
            memoryLabel={t('workspaceRuntime.resources.memory')}
            memoryValue={resourceSnapshot ? formatBytes(resourceSnapshot.memoryBytes) : '—'}
            memoryAriaLabel={t('workspaceRuntime.resources.memoryTrendLabel', {
              value: resourceSnapshot ? formatBytes(resourceSnapshot.memoryBytes) : '—',
            })}
          />
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger
          aria-label={t('workspaceRuntime.maas.title')}
          className={cn(
            'flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
            globalMaasBinding.data?.enabled ? 'text-foreground' : 'text-foreground-passive'
          )}
          title={t('workspaceRuntime.maas.title')}
        >
          <Cloud className="size-3.5" />
          <span>{selectedMaasLabel}</span>
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              globalMaasBinding.data?.effective
                ? 'bg-emerald-500'
                : globalMaasBinding.data?.enabled
                  ? 'bg-amber-500'
                  : 'bg-foreground-disabled'
            )}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className="w-[22rem] gap-0 border border-border bg-background p-0 text-foreground shadow-lg"
        >
          <div className="border-b border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t('workspaceRuntime.maas.title')}</div>
                <div className="mt-0.5 text-xs text-foreground-passive">
                  {t('workspaceRuntime.maas.description')}
                </div>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                  globalMaasBinding.data?.effective
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : globalMaasBinding.data?.enabled
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'bg-background-2 text-foreground-muted'
                )}
              >
                {globalMaasBinding.data?.effective
                  ? t('workspaceRuntime.maas.effective')
                  : globalMaasBinding.data?.enabled
                    ? t('workspaceRuntime.maas.needsAttention')
                    : t('workspaceRuntime.maas.disabled')}
              </span>
            </div>
          </div>
          <div className="grid gap-3 p-3">
            <MaasGlobalSelector
              onManagePlatform={() => appState.navigation.navigate('maas')}
              onOpenMarketplace={() =>
                appState.navigation.navigate('marketplace', { section: 'extensions' })
              }
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => appState.navigation.navigate('maas')}
              >
                {t('workspaceRuntime.maas.manage')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => appState.sidePane.pinView('settings', { tab: 'ai-logs' })}
              >
                {t('workspaceRuntime.maas.openLogs')}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Popover open={isSkillPopoverOpen} onOpenChange={setIsSkillPopoverOpen}>
        <PopoverTrigger
          aria-label={t('workspaceRuntime.skill')}
          className={cn(
            'flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
            isSkillPopoverOpen && 'bg-background-2 text-foreground'
          )}
          title={t('workspaceRuntime.skill')}
        >
          <Sparkles className="size-3.5" />
          <span>{t('workspaceRuntime.skill')}</span>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-[26rem] gap-0 border border-border bg-background p-0 text-foreground shadow-lg"
        >
          <SkillQuickSearchPopover
            onInstalled={handleSkillInstalled}
            onManageSkills={openSkillsManagement}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        title={t('workspaceRuntime.doctor')}
        aria-label={t('workspaceRuntime.doctor')}
        onClick={() => showDoctorModal({})}
        className="flex h-5 items-center gap-1 rounded px-1.5 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
      >
        <Stethoscope className="size-3.5" />
        <span>{t('workspaceRuntime.doctor')}</span>
      </button>
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
    </footer>
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
