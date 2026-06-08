import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Copy, Pencil, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { taskNamingUpdatedChannel } from '@shared/events/taskEvents';
import type { TaskNamingContextSnapshot, TaskNamingSnapshot } from '@shared/task-naming';
import { NamingConfigFields } from '@renderer/features/tasks/components/naming-config-fields';
import { PersistedDetails } from '@renderer/features/tasks/components/persisted-disclosure';
import {
  getRegisteredTaskData,
  getTaskManagerStore,
  getTaskStore,
  taskDisplayName,
} from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';

const NAMING_PANEL_REFRESH_MS = 3_000;
const MAX_REASONABLE_NAMING_DURATION_MS = 10 * 60 * 1000;

export const RenamePanel = observer(function RenamePanel({
  active,
  chromeless = false,
}: {
  active: boolean;
  chromeless?: boolean;
}) {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const taskStore = getTaskStore(projectId, taskId);
  const taskPayload = getRegisteredTaskData(projectId, taskId);
  const taskManager = getTaskManagerStore(projectId);
  const showRename = useShowModal('renameTaskModal');
  const queryClient = useQueryClient();
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerationStartedAt, setRegenerationStartedAt] = useState<number | null>(null);
  const [lastRegenerationDurationMs, setLastRegenerationDurationMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const taskName = taskDisplayName(taskStore) ?? taskPayload?.name ?? t('common.untitled');
  const branchName = provisioned.workspace.git.branchName ?? '-';

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
  const contextTitle = usingContextPreview
    ? t('tasks.rename.currentContextSources')
    : t('tasks.rename.contextSources');
  const noContextDescription = t(getNoContextDescriptionKey(snapshot, contextPreviewQuery.data));
  const namingModel = snapshot?.model || namingContext?.model || t('tasks.rename.modelUnavailable');
  const contextStats = getContextStats(namingContext);

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

  useEffect(() => {
    if (!active || !snapshot?.context?.debugTrace) return;
    console.log('[DEBUG][rename-panel] naming trace:', {
      taskId,
      status: snapshot.status,
      totalDurationMs: snapshot.context.debugTrace.totalDurationMs,
      stages: snapshot.context.debugTrace.stages,
      context: {
        sourceCount: snapshot.context.sourceCount,
        estimatedTokens: snapshot.context.estimatedTokens,
        estimatedCharacters: snapshot.context.estimatedCharacters,
        generationMethod: snapshot.context.generationMethod ?? null,
      },
    });
  }, [active, snapshot, taskId]);

  const openManualRename = () => {
    showRename({ projectId, taskId, currentName: taskName });
  };

  const regenerate = () => {
    if (!taskManager || isRegenerating) return;
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
        chromeless ? 'min-h-0' : 'h-full bg-background'
      )}
    >
      <div
        className={cn(
          'flex h-7 shrink-0 items-center gap-2 pr-1.5',
          chromeless ? 'justify-end pl-3' : 'justify-between border-b border-border/70 pl-3'
        )}
      >
        {chromeless ? null : (
          <MicroLabel className="truncate text-foreground-passive">
            {t('tasks.rename.panelTitle')}
          </MicroLabel>
        )}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-5 px-1.5 text-foreground-passive hover:text-foreground"
          onClick={openManualRename}
        >
          <Pencil className="size-3" />
          {t('common.rename')}
        </Button>
      </div>

      <div
        className={cn(
          'px-2.5',
          chromeless ? 'min-w-0 py-2' : 'min-h-0 flex-1 overflow-y-auto py-3'
        )}
      >
        <div className={cn('flex min-w-0 flex-col', chromeless ? 'gap-2' : 'gap-3')}>
          <section className="flex min-w-0 flex-col gap-1.5">
            <div className="grid gap-1 rounded-md border border-border bg-background-1/40 px-2 py-1.5">
              <NamingValue
                label={t('tasks.rename.status')}
                value={namingStatus}
                accent={snapshotGenerating || isRegenerating}
              />
              <NamingValue label={t('tasks.panel.model')} value={namingModel} mono />
              <NamingValue
                label={t('tasks.rename.durationEstimate')}
                value={namingDurationLabel}
                mono
              />
              <NamingValue
                label={t('tasks.rename.contextTokens')}
                value={formatTokenCount(namingContext?.estimatedTokens)}
                mono
              />
              <NamingDivider />
              <NamingValue label={t('tasks.rename.currentTaskName')} value={taskName} />
              <NamingValue
                label={t('tasks.rename.generatedTaskName')}
                value={snapshot?.generatedTaskName ?? t('tasks.panel.noGeneratedTaskName')}
              />
              <NamingValue
                label={t('tasks.rename.generatedBranchName')}
                value={snapshot?.generatedBranchName ?? branchName}
                mono
              />
            </div>

            {namingError ? (
              <div className="rounded-md border border-border-destructive/60 bg-background-destructive/40 p-2 text-xs leading-relaxed text-foreground-destructive">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <span className="min-w-0 whitespace-pre-wrap break-words">{namingError}</span>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="-mr-1 -mt-1 text-foreground-destructive hover:bg-background-destructive/60 hover:text-foreground-destructive"
                    aria-label={t('common.copy')}
                    title={t('common.copy')}
                    onClick={() => void copyNamingError(namingError)}
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant="default"
                className="flex-1"
                disabled={isRegenerating || !taskManager}
                onClick={regenerate}
              >
                <RefreshCw className={cn('size-3', isRegenerating && 'animate-spin')} />
                {isRegenerating ? t('common.loading') : t('tasks.panel.regenerateName')}
              </Button>
            </div>
          </section>

          <PersistedDetails
            id="rename:configure"
            className="group min-w-0 rounded-md border border-border"
            summary={
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-xs text-foreground-passive transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                <SlidersHorizontal className="size-3" />
                <span className="font-medium">{t('tasks.rename.configure')}</span>
              </summary>
            }
          >
            <div className="flex flex-col gap-2 border-t border-border/70 px-2 pb-2 pt-2">
              <p className="text-[11px] leading-relaxed text-foreground-passive">
                {t('tasks.rename.configureHint')}
              </p>
              <NamingConfigFields compact />
            </div>
          </PersistedDetails>

          <section className="flex min-w-0 flex-col gap-1.5">
            <div className="min-w-0 px-0.5">
              <MicroLabel className="text-foreground-passive">{contextTitle}</MicroLabel>
              <p className="mt-0.5 truncate text-[11px] text-foreground-passive">
                {contextStats
                  ? t('tasks.rename.contextStats', contextStats)
                  : t('tasks.rename.contextStatsUnavailable')}
              </p>
            </div>

            {namingQuery.isLoading || (!snapshot?.context && contextPreviewQuery.isLoading) ? (
              <RenamePanelEmpty>{t('common.loading')}</RenamePanelEmpty>
            ) : namingContext?.sources.length ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                {usingContextPreview ? (
                  <p className="rounded-md border border-border/70 bg-background-1/40 px-2 py-1.5 text-xs leading-relaxed text-foreground-passive">
                    {t('tasks.rename.currentContextHint')}
                  </p>
                ) : null}
                {namingContext.sources.map((source) => (
                  <PersistedDetails
                    key={source.id}
                    id={`rename:source:${source.id}`}
                    className="rounded-md border border-dashed border-border/80 bg-background-1/40 p-2"
                    summary={
                      <summary className="cursor-pointer text-xs text-foreground">
                        <span>{source.label}</span>
                        <span className="ml-1 text-foreground-passive">
                          {t('tasks.rename.sourceTokens', {
                            count: source.estimatedTokens,
                          })}
                        </span>
                        {source.truncated ? (
                          <span className="ml-1 text-foreground-passive">
                            {t('tasks.panel.truncated')}
                          </span>
                        ) : null}
                      </summary>
                    }
                  >
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground-muted">
                      {source.content}
                    </pre>
                  </PersistedDetails>
                ))}
              </div>
            ) : (
              <RenamePanelEmpty>
                <span className="font-medium text-foreground-muted">
                  {t('tasks.panel.noRenameContext')}
                </span>
                <span className="mt-1 block leading-relaxed">{noContextDescription}</span>
              </RenamePanelEmpty>
            )}
          </section>
        </div>
      </div>
    </div>
  );
});

function NamingValue({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-[11px] leading-tight">
      <span className="shrink-0 truncate text-foreground-passive" title={label}>
        {label}
      </span>
      <span
        className={cn(
          'min-w-0 truncate text-foreground-muted',
          mono && 'font-mono',
          accent && 'font-medium text-foreground'
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function NamingDivider() {
  return <div className="my-0.5 h-px bg-border/60" />;
}

function RenamePanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

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
    return { duration: formatDurationMs(nowMs - regenerationStartedAt), running: true };
  }

  const snapshotStartedAt = parseTimestamp(snapshot?.createdAt);
  if (snapshot?.status === 'generating' && snapshotStartedAt !== null) {
    return { duration: formatDurationMs(nowMs - snapshotStartedAt), running: true };
  }

  if (lastRegenerationDurationMs !== null) {
    return { duration: formatDurationMs(lastRegenerationDurationMs), running: false };
  }

  const snapshotUpdatedAt = parseTimestamp(snapshot?.updatedAt);
  if (snapshotStartedAt !== null && snapshotUpdatedAt !== null) {
    const durationMs = snapshotUpdatedAt - snapshotStartedAt;
    if (durationMs >= 0 && durationMs <= MAX_REASONABLE_NAMING_DURATION_MS) {
      return { duration: formatDurationMs(durationMs), running: false };
    }
  }

  return null;
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

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1_000) return '<1s';
  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatTokenCount(value: number | undefined): string {
  if (value === undefined) return '-';
  return String(value);
}

function getContextStats(
  context: TaskNamingContextSnapshot | null
): { sources: number; tokens: number; characters: number; method: string } | null {
  if (!context) return null;
  const sources = context.sourceCount ?? context.sources.length;
  const tokens =
    context.estimatedTokens ??
    context.sources.reduce((sum, source) => sum + source.estimatedTokens, 0);
  const characters =
    context.estimatedCharacters ??
    context.sources.reduce((sum, source) => sum + source.content.length, 0);
  return {
    sources,
    tokens,
    characters,
    method: context.generationMethod ?? '-',
  };
}
