import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Bot,
  Boxes,
  Brain,
  ClipboardCheck,
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
import type { Conversation } from '@shared/conversations';
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
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { SkillQuickSearchPopover } from '@renderer/features/skills/components/SkillQuickSearchPopover';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useTaskStats } from '@renderer/features/tasks/hooks/useTaskStats';
import {
  resolveSessionPrompts,
  startVisibleSessionRefresh,
} from '@renderer/features/tasks/session-prompts';
import { registeredTaskData } from '@renderer/features/tasks/stores/task';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { AgentInfoCard } from '@renderer/lib/components/agent-selector/agent-info-card';
import type { SessionModelSettings } from '@renderer/lib/components/agent-selector/session-model-editor';
import { runtimeSnapshotQueryKey } from '@renderer/lib/components/agent-selector/use-runtime-snapshot';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';
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
import {
  WORKSPACE_RESOURCE_QUERY_KEY,
  WORKSPACE_RESOURCE_QUERY_TIMING,
} from './workspace-resource-monitoring';
import { WorkspaceResourceTrend } from './workspace-resource-trend';
import { getDistinctAgentTaskTitle, getQuotaWindowLabel } from './workspace-runtime-bar-format';

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

const RUNTIME_BAR_ACTION_CLASS =
  'flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border';
const RUNTIME_BAR_ACTION_LABEL_CLASS = 'hidden @min-[1441px]:inline';

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
  const showArchiveWithNote = useShowModal('archiveTaskWithNoteModal');
  const showResourceDetailsModal = useShowModal('workspaceResourceDetailsModal');
  const { value: interfaceSettings, update: updateInterfaceSettings } =
    useAppSettingsKey('interface');
  const { value: homeDraft, update: updateHomeDraft } = useAppSettingsKey('homeDraft');
  const { value: taskSettings, update: updateTaskSettings } = useAppSettingsKey('tasks');
  const { value: defaultRuntime } = useAppSettingsKey('defaultRuntime');
  const [isCompacting, setIsCompacting] = useState(false);
  const [isResettingAccountUsage, setIsResettingAccountUsage] = useState(false);
  const [isRuntimePopoverOpen, setIsRuntimePopoverOpen] = useState(false);
  const [sessionRuntimeOverride, setSessionRuntimeOverride] = useState<
    | (SessionModelSettings & {
        conversationId: string;
      })
    | null
  >(null);
  const [isAgentPopoverOpen, setIsAgentPopoverOpen] = useState(false);
  const [agentPanelTab, setAgentPanelTab] = useState<AgentPanelTab>('all');
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
  const activeMountedProject = activeProjectId
    ? asMounted(getProjectStore(activeProjectId))
    : undefined;
  const activeMountedProjectData = activeMountedProject?.data ?? null;
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
  const { data: runtimeSnapshot } = useQuery({
    queryKey: runtimeId
      ? runtimeSnapshotQueryKey(runtimeId, connectionId)
      : (['runtimeSnapshot', 'inactive', connectionId ?? 'local'] as const),
    queryFn: () => {
      if (!runtimeId) throw new Error('A runtime is required to read its model.');
      return rpc.runtimeSettings.getRuntimeSnapshot(runtimeId, { connectionId });
    },
    enabled: Boolean(runtimeId),
    staleTime: 30_000,
  });
  const { data: sessionModelDetails } = useActiveSessionModelDetails({
    runtimeId,
    cwd: provisionedTask?.path,
    conversation: activeConversation,
    connectionId,
  });
  const optimisticSessionSettings =
    sessionRuntimeOverride && sessionRuntimeOverride.conversationId === activeConversation?.id
      ? sessionRuntimeOverride
      : null;
  const optimisticSessionModel = optimisticSessionSettings?.model ?? null;
  const activeSessionModel = optimisticSessionModel ?? sessionModelDetails?.model ?? null;
  const displayedReasoningEffort =
    optimisticSessionSettings?.reasoningEffort ?? sessionModelDetails?.reasoningEffort ?? null;
  const displayedFastMode =
    optimisticSessionSettings?.fastMode ?? sessionModelDetails?.fastMode ?? false;
  const displayedModel =
    activeSessionModel ??
    runtimeSnapshot?.model.defaultModel ??
    runtimeSnapshot?.model.nativeModel ??
    null;
  useEffect(() => {
    if (
      sessionRuntimeOverride &&
      sessionRuntimeOverride.conversationId === activeConversation?.id &&
      sessionModelDetails?.model === sessionRuntimeOverride.model &&
      (sessionRuntimeOverride.reasoningEffort === undefined ||
        sessionModelDetails.reasoningEffort === sessionRuntimeOverride.reasoningEffort) &&
      (sessionRuntimeOverride.fastMode === undefined ||
        sessionModelDetails.fastMode === sessionRuntimeOverride.fastMode)
    ) {
      setSessionRuntimeOverride(null);
    }
  }, [activeConversation?.id, sessionModelDetails, sessionRuntimeOverride]);
  const dependency = runtimeId
    ? connectionId
      ? appState.dependencies.getRemote(connectionId).data?.[runtimeId]
      : appState.dependencies.agentStatuses[runtimeId]
    : undefined;
  const taskTerminalActive = Boolean(
    provisionedTask?.taskView.isTerminalDrawerOpen &&
      provisionedTask.taskView.activeBottomPanelTab === 'terminals'
  );
  const terminalActive = taskTerminalActive || workspaceTerminalStore.isOpen;
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
    queryKey: WORKSPACE_RESOURCE_QUERY_KEY,
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
  const pendingAcceptanceTasks: PendingAcceptanceTask[] = Array.from(
    appState.projects.projects.values()
  ).flatMap((project) => {
    const mountedProject = asMounted(project);
    if (!mountedProject) return [];
    const projectName = project.displayName;
    return Array.from(mountedProject.taskManager.tasks.values()).flatMap((task) => {
      const taskData = registeredTaskData(task);
      if (!taskData || taskData.archivedAt || !taskData.needsReview) return [];
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
    void workspaceTerminalStore.syncActiveProject(activeMountedProjectData).catch(() => {});
  }, [activeMountedProjectData]);

  useEffect(() => {
    if (!activeConversation || !provisionedTask) return;
    let cancelled = false;
    const load = () =>
      resolveSessionPrompts(activeConversation, provisionedTask.path).then((prompts) => {
        if (!cancelled) {
          setSessionPromptCount({ conversationId: activeConversation.id, count: prompts.length });
        }
      });

    const stopRefresh = startVisibleSessionRefresh(load);
    return () => {
      cancelled = true;
      stopRefresh();
    };
  }, [activeConversation, provisionedTask]);

  const toggleTerminal = () => {
    if (workspaceTerminalStore.isOpen) {
      workspaceTerminalStore.close();
      return;
    }
    if (provisionedTask) {
      if (taskTerminalActive) {
        provisionedTask.taskView.setTerminalDrawerOpen(false);
        return;
      }
      // A project quick action opens its persisted workspace Terminal. Keep
      // that Terminal as the next toggle target after it is closed, instead
      // of switching to this task's unrelated Terminal drawer.
      if (workspaceTerminalStore.activeProjectId === activeMountedProject?.data.id) {
        void workspaceTerminalStore.toggleProject(activeMountedProject.data).catch(() => {});
        return;
      }
      provisionedTask.taskView.setBottomPanelTab('terminals');
      provisionedTask.taskView.setTerminalDrawerOpen(true);
      provisionedTask.taskView.setFocusedRegion('bottom');
      return;
    }
    if (activeMountedProject) {
      void workspaceTerminalStore.toggleProject(activeMountedProject.data).catch(() => {});
      return;
    }
    void workspaceTerminalStore.toggleGlobal().catch(() => {});
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

  const manageModels = () => {
    setIsRuntimePopoverOpen(false);
    appState.sidePane.pinView('settings', { tab: 'models' });
  };

  const restartCurrentSessionWithModel = async (settings: SessionModelSettings) => {
    if (!provisionedTask || !activeConversation || !runtime?.modelFlagOnResume) {
      throw new Error(t('workspaceRuntime.model.restartUnavailable'));
    }
    await provisionedTask.conversations.restartConversation(
      activeConversation.id,
      undefined,
      undefined,
      undefined,
      settings
    );
    setSessionRuntimeOverride({ conversationId: activeConversation.id, ...settings });
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
      className="@container flex h-7 min-w-0 shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap border-t border-border bg-background-secondary px-2 text-[11px] text-foreground-muted @min-[1441px]:gap-2"
    >
      {runtimeId ? (
        <div className="flex min-w-0 items-center gap-0.5 overflow-hidden @min-[1121px]:gap-1.5">
          <Popover open={isRuntimePopoverOpen} onOpenChange={setIsRuntimePopoverOpen}>
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
              <span className="truncate font-medium text-foreground @max-[720px]:hidden">
                {runtime?.name ?? runtimeId}
              </span>
              {displayedModel ? (
                <>
                  <span aria-hidden className="text-foreground-passive @max-[720px]:hidden">
                    ·
                  </span>
                  <span className="max-w-52 truncate font-mono text-[10px] text-foreground">
                    {displayedModel}
                  </span>
                  {displayedReasoningEffort ? (
                    <span className="max-w-16 truncate rounded-sm bg-background-2 px-1 font-mono text-[9px] text-foreground-passive @max-[960px]:hidden">
                      {displayedReasoningEffort}
                    </span>
                  ) : null}
                  {displayedFastMode ? (
                    <span className="rounded-sm bg-violet-500/15 px-1 text-[9px] font-medium text-violet-700 @max-[960px]:hidden dark:text-violet-300">
                      {t('workspaceRuntime.model.fastSpeed')}
                    </span>
                  ) : null}
                </>
              ) : null}
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              sideOffset={8}
              className="w-auto border border-border bg-background p-0 text-foreground shadow-lg"
            >
              <AgentInfoCard
                id={runtimeId}
                dependency={dependency}
                selectedModel={activeSessionModel}
                selectedModelSource="currentSession"
                connectionId={connectionId}
                modelEditing={
                  activeConversation && runtime?.modelFlagOnResume
                    ? {
                        reasoningEffort: displayedReasoningEffort,
                        fastMode: displayedFastMode,
                        onRestartWithModel: restartCurrentSessionWithModel,
                        onManageModels: manageModels,
                        allowDefaultChange: !connectionId,
                      }
                    : undefined
                }
              />
            </PopoverContent>
          </Popover>
          {activeConversationId ? (
            <>
              <span aria-hidden className="@max-[1120px]:hidden">
                ·
              </span>
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
                <span className="tabular-nums @max-[1120px]:hidden">{sessionHistoryLabel}</span>
                <span className="hidden tabular-nums @max-[1120px]:inline">
                  {displayedPromptCount ?? 0}
                </span>
              </button>
            </>
          ) : null}
          {sessionContext && contextPercent != null ? (
            <>
              <span aria-hidden className="@max-[1120px]:hidden">
                ·
              </span>
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
                  <span className="@max-[1120px]:hidden">
                    {t('workspaceRuntime.contextUsageShort')}
                  </span>
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
              <span aria-hidden className="@max-[1120px]:hidden">
                ·
              </span>
              <Popover onOpenChange={handleAccountUsagePopoverOpen}>
                <PopoverTrigger
                  aria-label={t('workspaceRuntime.accountUsage')}
                  className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
                  title={t('workspaceRuntime.accountUsage')}
                >
                  <Gauge className="size-3.5" />
                  <span className="@max-[1120px]:hidden">
                    {t('workspaceRuntime.accountUsageShort')}
                  </span>
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
      <Popover open={isConfigPopoverOpen} onOpenChange={setIsConfigPopoverOpen}>
        <PopoverTrigger
          aria-label={t('workspaceRuntime.config.title')}
          className={cn(
            RUNTIME_BAR_ACTION_CLASS,
            isConfigPopoverOpen && 'bg-background-2 text-foreground'
          )}
          title={t('workspaceRuntime.config.title')}
        >
          <Settings2 className="size-3.5" />
          <span className={RUNTIME_BAR_ACTION_LABEL_CLASS}>
            {t('workspaceRuntime.config.title')}
          </span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
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
      <span className="flex-1" />
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
          <Bot className="size-3.5" />
          <span className="tabular-nums @max-[1440px]:hidden">{agentTriggerText}</span>
          <span className="hidden tabular-nums @max-[1440px]:inline">{agentSessionCount}</span>
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
                      <ClipboardCheck
                        aria-hidden
                        className="size-4 shrink-0 text-status-in-review"
                      />
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
        </PopoverContent>
      </Popover>
      <Popover open={isResourcePopoverOpen} onOpenChange={setIsResourcePopoverOpen}>
        <PopoverTrigger
          aria-label={t('workspaceRuntime.resources.triggerLabel')}
          className={cn(RUNTIME_BAR_ACTION_CLASS, 'text-foreground-passive')}
          title={t('workspaceRuntime.resources.triggerLabel')}
        >
          <Activity aria-hidden className="size-3.5" />
          <span className={RUNTIME_BAR_ACTION_LABEL_CLASS}>
            {t('workspaceRuntime.resources.triggerShort')}
          </span>
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
            RUNTIME_BAR_ACTION_CLASS,
            globalMaasBinding.data?.enabled ? 'text-foreground' : 'text-foreground-passive'
          )}
          title={t('workspaceRuntime.maas.title')}
        >
          <Cloud className="size-3.5" />
          <span
            className={cn(
              RUNTIME_BAR_ACTION_LABEL_CLASS,
              'max-w-48 truncate @min-[1441px]:inline-block'
            )}
          >
            {selectedMaasLabel}
          </span>
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
            RUNTIME_BAR_ACTION_CLASS,
            isSkillPopoverOpen && 'bg-background-2 text-foreground'
          )}
          title={t('workspaceRuntime.skill')}
        >
          <Sparkles className="size-3.5" />
          <span className={RUNTIME_BAR_ACTION_LABEL_CLASS}>{t('workspaceRuntime.skill')}</span>
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
        className={cn(RUNTIME_BAR_ACTION_CLASS, 'text-foreground-passive')}
      >
        <Stethoscope className="size-3.5" />
        <span className={RUNTIME_BAR_ACTION_LABEL_CLASS}>{t('workspaceRuntime.doctor')}</span>
      </button>
      <button
        type="button"
        title={t('workspaceRuntime.terminal')}
        aria-label={t('workspaceRuntime.terminal')}
        aria-pressed={terminalActive}
        onClick={toggleTerminal}
        className={cn(
          RUNTIME_BAR_ACTION_CLASS,
          terminalActive && 'bg-background-2 text-foreground'
        )}
      >
        <Terminal className="size-3.5" />
        <span className={RUNTIME_BAR_ACTION_LABEL_CLASS}>{t('workspaceRuntime.terminal')}</span>
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
        compact ? 'h-1 w-9 @max-[720px]:hidden' : 'h-1.5 w-full'
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

type ActiveSessionModelDetails = {
  model: string | null;
  reasoningEffort: string | null;
  fastMode: boolean | null;
};

function useActiveSessionModelDetails({
  runtimeId,
  cwd,
  conversation,
  connectionId,
}: {
  runtimeId: RuntimeId | null;
  cwd?: string;
  conversation: Conversation | null;
  connectionId?: string;
}) {
  const supportedRuntime = !connectionId && (runtimeId === 'codex' || runtimeId === 'claude');
  return useQuery<ActiveSessionModelDetails | null>({
    queryKey: [
      'workspaceSessionModel',
      runtimeId ?? 'none',
      cwd ?? '',
      conversation?.id ?? '',
      conversation?.title ?? '',
      conversation?.createdAt ?? '',
      connectionId ?? 'local',
    ],
    queryFn: async () => {
      if (!runtimeId || !cwd || !conversation) return null;
      if (runtimeId === 'codex') {
        const context = await rpc.conversations.getCodexSessionContext(
          cwd,
          conversation.id,
          conversation.title,
          conversation.createdAt ?? null,
          'harness'
        );
        if (!context) return null;
        const currentTurn = context.turnContexts.at(-1);
        return {
          model: context.model,
          reasoningEffort: currentTurn?.effort ?? null,
          fastMode: isCodexFastServiceTier(currentTurn?.serviceTier),
        };
      }
      if (runtimeId === 'claude') {
        const sessionId =
          conversation.sessionSource?.runtimeId === 'claude'
            ? conversation.sessionSource.sessionId
            : conversation.id;
        const metadata = await rpc.conversations.getClaudeSessionMetadata(cwd, sessionId);
        return metadata ? { model: metadata.model, reasoningEffort: null, fastMode: null } : null;
      }
      return null;
    },
    enabled: Boolean(supportedRuntime && cwd && conversation),
    staleTime: 3_000,
    refetchInterval: supportedRuntime && cwd && conversation ? 5_000 : false,
    refetchOnWindowFocus: true,
  });
}

function isCodexFastServiceTier(serviceTier: string | null | undefined): boolean {
  return serviceTier === 'fast' || serviceTier === 'priority';
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
