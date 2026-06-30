import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { taskNamingUpdatedChannel } from '@shared/events/taskEvents';
import type { TaskNamingContextSnapshot, TaskNamingSnapshot } from '@shared/task-naming';
import {
  formatNamingDebugDurationMs,
  getNamingDebugContextStats,
  getNamingDebugDurationEstimate,
  NamingDebugContent,
} from '@renderer/features/tasks/components/naming-debug-ui';
import {
  buildNamingContextSection,
  buildNamingSummaryItems,
  buildNamingTextSections,
  NamingPanel,
  NamingPanelConfiguration,
} from '@renderer/features/tasks/components/naming-panel-shared';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import {
  getRegisteredTaskData,
  getTaskManagerStore,
  getTaskStore,
  taskDisplayName,
} from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';

const NAMING_PANEL_REFRESH_MS = 3_000;

export const RenamePanel = observer(function RenamePanel({
  active,
  chromeless = false,
  onManualRenameSuccess,
}: {
  active: boolean;
  chromeless?: boolean;
  onManualRenameSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const taskStore = getTaskStore(projectId, taskId);
  const taskPayload = getRegisteredTaskData(projectId, taskId);
  const taskManager = getTaskManagerStore(projectId);
  const taskSettings = useTaskSettings();
  const queryClient = useQueryClient();
  const taskName = taskDisplayName(taskStore) ?? taskPayload?.name ?? t('common.untitled');
  const branchName = provisioned.workspace.git.branchName ?? '-';
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerationStartedAt, setRegenerationStartedAt] = useState<number | null>(null);
  const [lastRegenerationDurationMs, setLastRegenerationDurationMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const namingQuery = useQuery<TaskNamingSnapshot | null>({
    queryKey: ['taskNamingSnapshot', taskId],
    queryFn: () => rpc.tasks.getTaskNamingSnapshot(taskId),
    enabled: active,
    refetchInterval: active ? NAMING_PANEL_REFRESH_MS : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });
  const snapshot = namingQuery.data ?? null;
  const contextPreviewQuery = useQuery<TaskNamingContextSnapshot | null>({
    queryKey: ['taskNamingContextPreview', projectId, taskId],
    queryFn: () => rpc.tasks.getTaskNamingContextPreview(projectId, taskId),
    enabled: active && !snapshot?.context,
    refetchOnWindowFocus: false,
  });
  const namingContext = snapshot?.context ?? contextPreviewQuery.data ?? null;
  const usingContextPreview = !snapshot?.context && Boolean(namingContext?.sources.length);
  const namingError = isRegenerating ? undefined : snapshot?.error;
  const snapshotGenerating = snapshot?.status === 'generating';
  const namingStatus = t(getNamingStatusKey(snapshot, isRegenerating));
  const namingDuration = getNamingDurationEstimate({
    snapshot,
    isRegenerating,
    regenerationStartedAt,
    lastRegenerationDurationMs,
    nowMs,
  });
  const namingDurationLabel = namingDuration
    ? t(namingDuration.running ? 'tasks.rename.durationRunning' : 'tasks.rename.durationLast', {
        duration: namingDuration.duration,
      })
    : t('tasks.rename.durationUnavailable');
  const namingTimeoutLabel = `${Math.round(taskSettings.namingRequestTimeoutMs / 1_000)}s`;
  const runningNamingDuration = namingDuration?.running ? namingDuration.duration : null;
  const regenerateLabel =
    isRegenerating || snapshotGenerating
      ? t('tasks.rename.aiNaming', {
          duration: runningNamingDuration ?? formatNamingDebugDurationMs(0),
        })
      : t('tasks.rename.aiName');
  const noContextDescription = t(getNoContextDescriptionKey(snapshot, contextPreviewQuery.data));
  const namingModel = snapshot?.model || namingContext?.model || t('tasks.rename.modelUnavailable');
  const contextStats = getNamingDebugContextStats(namingContext);
  const siblingNames = new Set(
    Array.from(taskManager?.tasks.values() ?? [])
      .filter((task) => task.state !== 'unregistered' && task.data.id !== taskId)
      .map((task) => task.data.name)
  );

  useEffect(() => {
    if (!active) return;
    return events.on(taskNamingUpdatedChannel, (nextSnapshot) => {
      if (nextSnapshot.projectId !== projectId || nextSnapshot.taskId !== taskId) return;
      console.log('[DEBUG][rename-panel] naming event received:', {
        taskId,
        status: nextSnapshot.status,
        generatedTaskName: nextSnapshot.generatedTaskName ?? null,
        generatedBranchName: nextSnapshot.generatedBranchName ?? null,
      });
      queryClient.setQueryData(['taskNamingSnapshot', taskId], nextSnapshot);
    });
  }, [active, projectId, queryClient, taskId]);

  useEffect(() => {
    setIsRegenerating(false);
    setRegenerationStartedAt(null);
    setLastRegenerationDurationMs(null);
  }, [taskId]);

  useEffect(() => {
    if (!active || (!isRegenerating && !snapshotGenerating)) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active, isRegenerating, snapshotGenerating]);

  const regenerate = () => {
    if (!taskManager || isRegenerating || snapshotGenerating || taskSettings.saving) return;
    const startedAt = Date.now();
    console.log('[DEBUG][rename-panel] regenerate click:', {
      projectId,
      taskId,
      hasTaskManager: Boolean(taskManager),
      snapshotStatus: snapshot?.status ?? null,
      contextSources: namingContext?.sourceCount ?? namingContext?.sources.length ?? null,
      contextTokens: namingContext?.estimatedTokens ?? null,
      contextCharacters: namingContext?.estimatedCharacters ?? null,
    });
    setRegenerationStartedAt(startedAt);
    setLastRegenerationDurationMs(null);
    setNowMs(startedAt);
    setIsRegenerating(true);
    void taskManager
      .regenerateTaskName(taskId)
      .then(() => {
        console.log('[DEBUG][rename-panel] regenerate rpc resolved:', {
          taskId,
          durationMs: Date.now() - startedAt,
        });
        return namingQuery.refetch();
      })
      .catch((error: unknown) => {
        console.log('[DEBUG][rename-panel] regenerate rpc failed:', {
          taskId,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        toast({
          title: t('tasks.panel.renameContextRegenerateFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      })
      .finally(() => {
        console.log('[DEBUG][rename-panel] regenerate complete:', {
          taskId,
          durationMs: Date.now() - startedAt,
        });
        setLastRegenerationDurationMs(Date.now() - startedAt);
        setRegenerationStartedAt(null);
        setIsRegenerating(false);
      });
  };

  const copyNamingError = async (errorMessage: string) => {
    const debugReport = buildNamingDebugReport({
      errorMessage,
      projectId,
      taskId,
      taskName,
      branchName,
      namingModel,
      snapshot,
      namingContext,
      usingContextPreview,
      contextStats,
    });
    try {
      const result = await rpc.app.clipboardWriteText(debugReport);
      if (!result?.success) throw new Error(result?.error ?? t('common.copyFailed'));
      toast({ title: t('common.copied') });
    } catch {
      toast({
        title: t('common.copyFailed'),
        description: t('tasks.panel.copyFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <div
      className={cn(
        'flex w-full flex-col overflow-hidden',
        chromeless ? 'min-h-0 flex-1' : 'h-full bg-background'
      )}
    >
      <div
        className={cn(
          'flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border/70 pl-3 pr-1.5'
        )}
      >
        <MicroLabel className="truncate text-foreground-passive">
          {t('tasks.rename.panelTitle')}
        </MicroLabel>
      </div>

      <NamingDebugContent chromeless={chromeless}>
        <NamingPanel
          tabStateId="rename:tab"
          manual={{
            currentName: taskName,
            onRename: async (name) => {
              if (!taskStore) throw new Error(t('tasks.rename.renameFailed'));
              await taskStore.rename(name);
              onManualRenameSuccess?.();
            },
            getConflicts: () => siblingNames,
            showBranchPreview: true,
          }}
          autoPanel={{
            summaryItems: buildNamingSummaryItems(t, {
              statusLabel: namingStatus,
              accent: snapshotGenerating || isRegenerating,
              model: namingModel,
              durationLabel: namingDurationLabel,
              timeoutLabel: namingTimeoutLabel,
              contextTokens: namingContext?.estimatedTokens,
              currentName: taskName,
              generatedName: snapshot?.generatedTaskName ?? t('tasks.panel.noGeneratedTaskName'),
              branchName: snapshot?.generatedBranchName ?? branchName,
            }),
            error: namingError
              ? {
                  message: namingError,
                  copyLabel: t('common.copy'),
                  onCopy: () => void copyNamingError(namingError),
                }
              : undefined,
            actions: (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="default"
                  className="flex-1"
                  disabled={
                    isRegenerating || snapshotGenerating || !taskManager || taskSettings.saving
                  }
                  onClick={regenerate}
                >
                  <RefreshCw
                    className={cn(
                      'size-3',
                      (isRegenerating || snapshotGenerating) && 'animate-spin'
                    )}
                  />
                  {regenerateLabel}
                </Button>
              </div>
            ),
            configuration: <NamingPanelConfiguration id="rename:configure" t={t} />,
            textSections: buildNamingTextSections(t, 'rename', {
              systemPrompt: snapshot?.systemPrompt,
              systemPromptTokens: snapshot?.systemPromptEstimatedTokens,
              prompt: snapshot?.prompt,
              promptTokens: snapshot?.promptEstimatedTokens,
            }),
            context: {
              ...buildNamingContextSection(t, {
                context: namingContext,
                isLoading:
                  namingQuery.isLoading || (!snapshot?.context && contextPreviewQuery.isLoading),
                sourceIdPrefix: 'rename',
                contextStats,
                usingPreview: usingContextPreview,
              }),
              emptyContent: (
                <>
                  <span className="font-medium text-foreground-muted">
                    {t('tasks.panel.noRenameContext')}
                  </span>
                  <span className="mt-1 block leading-relaxed">{noContextDescription}</span>
                </>
              ),
              previewHint: usingContextPreview ? (
                <p className="rounded-md border border-border/70 bg-background-1/40 px-2 py-1.5 text-xs leading-relaxed text-foreground-passive">
                  {t('tasks.rename.currentContextHint')}
                </p>
              ) : null,
            },
          }}
        />
      </NamingDebugContent>
    </div>
  );
});

function buildNamingDebugReport({
  errorMessage,
  projectId,
  taskId,
  taskName,
  branchName,
  namingModel,
  snapshot,
  namingContext,
  usingContextPreview,
  contextStats,
}: {
  errorMessage: string;
  projectId: string;
  taskId: string;
  taskName: string;
  branchName: string;
  namingModel: string;
  snapshot: TaskNamingSnapshot | null;
  namingContext: TaskNamingContextSnapshot | null;
  usingContextPreview: boolean;
  contextStats: { sources: number; tokens: number; characters: number; method: string } | null;
}): string {
  const lines = [
    '# Task Naming Debug Report',
    `error: ${errorMessage}`,
    `projectId: ${projectId}`,
    `taskId: ${taskId}`,
    `taskName: ${taskName}`,
    `branchName: ${branchName}`,
    `model: ${namingModel}`,
    `status: ${snapshot?.status ?? 'unknown'}`,
    `generatedTaskName: ${snapshot?.generatedTaskName ?? '-'}`,
    `generatedBranchName: ${snapshot?.generatedBranchName ?? '-'}`,
    `createdAt: ${snapshot?.createdAt ?? '-'}`,
    `updatedAt: ${snapshot?.updatedAt ?? '-'}`,
    `usingContextPreview: ${usingContextPreview}`,
    `context.sources: ${contextStats?.sources ?? '-'}`,
    `context.tokens: ${contextStats?.tokens ?? '-'}`,
    `context.characters: ${contextStats?.characters ?? '-'}`,
    `context.method: ${contextStats?.method ?? '-'}`,
  ];

  const debugTrace = snapshot?.context?.debugTrace;
  if (debugTrace) {
    lines.push(`trace.totalDurationMs: ${debugTrace.totalDurationMs}`);
    for (const stage of debugTrace.stages) {
      lines.push(`trace.stage: ${JSON.stringify(stage)}`);
    }
  }

  if (namingContext?.sources.length) {
    lines.push('', '## Context Sources');
    for (const source of namingContext.sources) {
      lines.push(
        `### ${source.label} (tokens=${source.estimatedTokens}${source.truncated ? ', truncated' : ''})`,
        source.content
      );
    }
  }

  return lines.join('\n');
}

function getNamingStatusKey(snapshot: TaskNamingSnapshot | null, isRegenerating: boolean): string {
  if (isRegenerating || snapshot?.status === 'generating') return 'tasks.rename.statusGenerating';
  if (snapshot?.status === 'ready') return 'tasks.rename.statusReady';
  if (snapshot?.status === 'failed') return 'tasks.rename.statusFailed';
  if (snapshot?.status === 'skipped') return 'tasks.rename.statusSkipped';
  return 'tasks.rename.statusIdle';
}

function getNamingDurationEstimate({
  snapshot,
  isRegenerating,
  regenerationStartedAt,
  lastRegenerationDurationMs,
  nowMs,
}: {
  snapshot: TaskNamingSnapshot | null;
  isRegenerating: boolean;
  regenerationStartedAt: number | null;
  lastRegenerationDurationMs: number | null;
  nowMs: number;
}): { duration: string; running: boolean } | null {
  if (isRegenerating && regenerationStartedAt !== null) {
    return getNamingDebugDurationEstimate({
      isRunning: true,
      nowMs,
      fallbackDurationMs: nowMs - regenerationStartedAt,
    });
  }

  return getNamingDebugDurationEstimate({
    status: snapshot?.status,
    createdAt: snapshot?.createdAt,
    updatedAt: snapshot?.updatedAt,
    nowMs,
    fallbackDurationMs: lastRegenerationDurationMs,
  });
}

function getNoContextDescriptionKey(
  snapshot: TaskNamingSnapshot | null,
  contextPreview: TaskNamingContextSnapshot | null | undefined
): string {
  if (!snapshot && contextPreview === null) return 'tasks.rename.noContextUnavailable';
  if (!snapshot && contextPreview?.sources.length === 0) return 'tasks.rename.noContextUnavailable';
  if (!snapshot) return 'tasks.rename.noContextNoRecord';
  if (!snapshot.context && contextPreview === null) return 'tasks.rename.noContextUnavailable';
  if (!snapshot.context && contextPreview?.sources.length === 0) {
    return 'tasks.rename.noContextUnavailable';
  }
  if (!snapshot.context) return 'tasks.rename.noContextNoRecord';
  return 'tasks.rename.noContextEmptySources';
}
