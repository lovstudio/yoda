import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  Bot,
  Cpu,
  GitBranch,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  AppEventLoopMetrics,
  AppResourceSnapshot,
  WorktreeStorageItem,
  WorktreeStorageSnapshot,
} from '@shared/app-resource';
import { openTaskTarget } from '@renderer/app/open-task-target';
import {
  FilePathActionsDropdown,
  type FilePathTarget,
} from '@renderer/lib/components/file-path-actions';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { formatBytes } from '@renderer/utils/formatBytes';
import { cn } from '@renderer/utils/utils';
import {
  WorkspaceResourceDetailChart,
  type WorkspaceResourceDetailSeries,
} from './workspace-resource-detail-chart';
import {
  appendWorkspaceResourceSnapshot,
  getWorkspaceLatencyP95,
  type WorkspaceResourceHistoryPoint,
} from './workspace-resource-history';

export type WorkspaceResourceDetailKind = 'cpu' | 'memory' | 'latency' | 'worktrees';

type Props = BaseModalProps<void> & {
  kind: WorkspaceResourceDetailKind;
  initialSnapshot?: AppResourceSnapshot;
  initialHistory: WorkspaceResourceHistoryPoint[];
  initialWorktreeStorage?: WorktreeStorageSnapshot;
};

type ResourceProcessRow = {
  id: string;
  name: string;
  description: string;
  pid: number | null;
  cpuPercent: number;
  memoryBytes: number;
  agent: boolean;
};

export function WorkspaceResourceDetailsModal({
  kind,
  initialSnapshot,
  initialHistory,
  initialWorktreeStorage,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const queryClient = useQueryClient();
  const resourceDetailsQueryKey = ['app', 'resourceDetails'] as const;
  const { data: resourceDetails } = useQuery<{
    snapshot: AppResourceSnapshot | undefined;
    history: WorkspaceResourceHistoryPoint[];
  }>({
    queryKey: resourceDetailsQueryKey,
    queryFn: async () => {
      const nextSnapshot = await rpc.app.getResourceSnapshot();
      const current = queryClient.getQueryData<{
        snapshot: AppResourceSnapshot | undefined;
        history: WorkspaceResourceHistoryPoint[];
      }>(resourceDetailsQueryKey);
      return {
        snapshot: nextSnapshot,
        history: appendWorkspaceResourceSnapshot(current?.history ?? initialHistory, nextSnapshot),
      };
    },
    initialData: {
      snapshot: initialSnapshot,
      history: initialSnapshot
        ? appendWorkspaceResourceSnapshot(initialHistory, initialSnapshot)
        : initialHistory,
    },
    staleTime: 2_000,
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
  });
  const {
    data: worktreeStorage,
    isFetching: isScanningWorktrees,
    refetch: refreshWorktreeStorage,
  } = useQuery<WorktreeStorageSnapshot>({
    queryKey: ['projects', 'worktreeStorage'],
    queryFn: () => rpc.projects.getWorktreeStorageSnapshot(),
    enabled: kind === 'worktrees',
    initialData: initialWorktreeStorage,
    staleTime: 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  const copy = getDetailCopy(kind, t);
  const Icon = copy.icon;
  const snapshot = resourceDetails.snapshot;
  const history = resourceDetails.history;

  return (
    <>
      <DialogHeader className="min-w-0 flex-1 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-2 text-foreground-muted">
          <Icon aria-hidden className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-lg font-semibold tracking-normal text-foreground normal-case">
              {copy.title}
            </DialogTitle>
            <Badge variant="secondary">{t('workspaceRuntime.resources.details.live')}</Badge>
          </div>
          <DialogDescription className="mt-1 text-sm leading-relaxed">
            {copy.description}
          </DialogDescription>
        </div>
      </DialogHeader>
      <DialogContentArea className="gap-4 px-6 pb-6 pt-0">
        {kind === 'cpu' || kind === 'memory' ? (
          <ProcessResourceDetails
            kind={kind}
            snapshot={snapshot}
            history={history}
            sampledAt={snapshot?.sampledAt}
          />
        ) : kind === 'latency' ? (
          <LatencyDetails snapshot={snapshot} history={history} />
        ) : (
          <WorktreeDetails
            storage={worktreeStorage}
            isScanning={isScanningWorktrees}
            onRefresh={() => void refreshWorktreeStorage()}
            onOpenTask={(item) => {
              if (!item.activeTaskId) return;
              onClose();
              openTaskTarget({ projectId: item.projectId, taskId: item.activeTaskId }, navigate);
            }}
          />
        )}
      </DialogContentArea>
    </>
  );
}

function ProcessResourceDetails({
  kind,
  snapshot,
  history,
  sampledAt,
}: {
  kind: 'cpu' | 'memory';
  snapshot: AppResourceSnapshot | undefined;
  history: WorkspaceResourceHistoryPoint[];
  sampledAt: string | undefined;
}) {
  const { t } = useTranslation();
  const rows = buildProcessRows(snapshot, t);
  const sortedRows = [...rows].sort((left, right) =>
    kind === 'cpu' ? right.cpuPercent - left.cpuPercent : right.memoryBytes - left.memoryBytes
  );
  const value =
    kind === 'cpu'
      ? snapshot
        ? formatCpu(snapshot.cpuPercent)
        : '—'
      : snapshot
        ? formatBytes(snapshot.memoryBytes)
        : '—';
  const chartSeries: WorkspaceResourceDetailSeries[] =
    kind === 'cpu'
      ? [
          {
            key: 'cpu',
            label: t('workspaceRuntime.resources.cpu'),
            value,
            lineClassName: 'stroke-accent',
            dotClassName: 'fill-accent bg-accent',
            valueForPoint: (point) => point.cpuPercent,
          },
        ]
      : [
          {
            key: 'memory',
            label: t('workspaceRuntime.resources.memory'),
            value,
            lineClassName: 'stroke-foreground-diff-added',
            dotClassName: 'fill-foreground-diff-added bg-foreground-diff-added',
            valueForPoint: (point) => point.memoryBytes,
          },
        ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <ResourceSummaryCard
          className="sm:col-span-2"
          label={
            kind === 'cpu'
              ? t('workspaceRuntime.resources.details.currentCpu')
              : t('workspaceRuntime.resources.details.currentMemory')
          }
          value={value}
          description={formatSampleTime(sampledAt, t)}
        />
        <ResourceSummaryCard
          label={t('workspaceRuntime.resources.details.resourceSources')}
          value={String(rows.length)}
          description={t('workspaceRuntime.resources.details.sourceSummary', {
            processes: snapshot?.processes.length ?? 0,
            agents: snapshot?.agentSessions.length ?? 0,
          })}
        />
      </div>
      <section>
        <SectionHeading
          title={t('workspaceRuntime.resources.trendTitle')}
          detail={t('workspaceRuntime.resources.trendRefresh')}
        />
        <WorkspaceResourceDetailChart
          history={history}
          ariaLabel={
            kind === 'cpu'
              ? t('workspaceRuntime.resources.details.cpuChartLabel', { value })
              : t('workspaceRuntime.resources.details.memoryChartLabel', { value })
          }
          emptyLabel={t('workspaceRuntime.resources.details.waitingForSamples')}
          startLabel={t('workspaceRuntime.resources.details.minuteAgo')}
          endLabel={t('workspaceRuntime.resources.details.now')}
          series={chartSeries}
          minimumCeiling={kind === 'cpu' ? 100 : 1}
        />
      </section>
      <section>
        <SectionHeading
          title={t('workspaceRuntime.resources.details.breakdown')}
          detail={
            kind === 'cpu'
              ? t('workspaceRuntime.resources.details.sortedByCpu')
              : t('workspaceRuntime.resources.details.sortedByMemory')
          }
        />
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem] gap-3 border-b border-border bg-background-1 px-3 py-2 text-[10px] uppercase tracking-wide text-foreground-passive">
            <span>{t('workspaceRuntime.resources.details.source')}</span>
            <span className="text-right">{t('workspaceRuntime.resources.cpu')}</span>
            <span className="text-right">{t('workspaceRuntime.resources.memory')}</span>
          </div>
          {sortedRows.length > 0 ? (
            <div className="max-h-64 divide-y divide-border overflow-y-auto">
              {sortedRows.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem] items-center gap-3 px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-passive">
                      {row.agent ? (
                        <Bot aria-hidden className="size-3.5" />
                      ) : (
                        <Activity aria-hidden className="size-3.5" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {row.name}
                      </span>
                      <span className="block truncate text-[10px] text-foreground-passive">
                        {row.description}
                        {row.pid == null ? '' : ` · PID ${row.pid}`}
                      </span>
                    </span>
                  </div>
                  <span className="text-right font-mono text-xs tabular-nums text-foreground-muted">
                    {formatCpu(row.cpuPercent)}
                  </span>
                  <span className="text-right font-mono text-xs tabular-nums text-foreground-muted">
                    {formatBytes(row.memoryBytes)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyDetails>{t('workspaceRuntime.resources.details.noProcessData')}</EmptyDetails>
          )}
        </div>
      </section>
    </>
  );
}

function LatencyDetails({
  snapshot,
  history,
}: {
  snapshot: AppResourceSnapshot | undefined;
  history: WorkspaceResourceHistoryPoint[];
}) {
  const { t } = useTranslation();
  const rendererPerformance = snapshot?.rendererPerformance;
  const latencyP95 = getWorkspaceLatencyP95(snapshot);
  const value = latencyP95 == null ? '—' : formatMs(latencyP95);
  const latencyGroups: Array<{
    key: string;
    title: string;
    description: string;
    metrics: AppEventLoopMetrics | undefined;
  }> = [
    {
      key: 'input',
      title: t('workspaceRuntime.resources.details.inputLatency'),
      description: t('workspaceRuntime.resources.details.inputLatencyDescription'),
      metrics: rendererPerformance?.inputLatency,
    },
    {
      key: 'renderer',
      title: t('workspaceRuntime.resources.details.rendererLatency'),
      description: t('workspaceRuntime.resources.details.rendererLatencyDescription'),
      metrics: rendererPerformance?.eventLoop,
    },
    {
      key: 'main',
      title: t('workspaceRuntime.resources.details.mainLatency'),
      description: t('workspaceRuntime.resources.details.mainLatencyDescription'),
      metrics: snapshot?.mainEventLoop,
    },
  ];
  const chartSeries: WorkspaceResourceDetailSeries[] = [
    {
      key: 'input',
      label: t('workspaceRuntime.resources.details.input'),
      value: rendererPerformance ? formatMs(rendererPerformance.inputLatency.p95Ms) : '—',
      lineClassName: 'stroke-accent',
      dotClassName: 'fill-accent bg-accent',
      valueForPoint: (point) => point.inputLatencyP95Ms,
    },
    {
      key: 'renderer',
      label: t('workspaceRuntime.resources.details.renderer'),
      value: rendererPerformance ? formatMs(rendererPerformance.eventLoop.p95Ms) : '—',
      lineClassName: 'stroke-foreground-diff-added',
      dotClassName: 'fill-foreground-diff-added bg-foreground-diff-added',
      valueForPoint: (point) => point.rendererLatencyP95Ms,
    },
    {
      key: 'main',
      label: t('workspaceRuntime.resources.details.mainProcess'),
      value: snapshot ? formatMs(snapshot.mainEventLoop.p95Ms) : '—',
      lineClassName: 'stroke-foreground-muted',
      dotClassName: 'fill-foreground-muted bg-foreground-muted',
      valueForPoint: (point) => point.mainLatencyP95Ms,
    },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <ResourceSummaryCard
          className="sm:col-span-2"
          label={t('workspaceRuntime.resources.details.responseP95')}
          value={value}
          description={formatSampleTime(snapshot?.sampledAt, t)}
        />
        <ResourceSummaryCard
          label={t('workspaceRuntime.resources.details.longTasks')}
          value={String(rendererPerformance?.longTaskCount ?? 0)}
          description={t('workspaceRuntime.resources.details.longTasksDescription')}
        />
      </div>
      <section>
        <SectionHeading
          title={t('workspaceRuntime.resources.trendTitle')}
          detail={t('workspaceRuntime.resources.details.p95Trend')}
        />
        <WorkspaceResourceDetailChart
          history={history}
          ariaLabel={t('workspaceRuntime.resources.details.latencyChartLabel', { value })}
          emptyLabel={t('workspaceRuntime.resources.details.waitingForSamples')}
          startLabel={t('workspaceRuntime.resources.details.minuteAgo')}
          endLabel={t('workspaceRuntime.resources.details.now')}
          series={chartSeries}
        />
      </section>
      <section>
        <SectionHeading
          title={t('workspaceRuntime.resources.details.latencyDistribution')}
          detail={t('workspaceRuntime.resources.details.lowerIsBetter')}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {latencyGroups.map((group) => (
            <div key={group.key} className="rounded-lg border border-border bg-background p-3">
              <h3 className="text-xs font-medium text-foreground">{group.title}</h3>
              <p className="mt-1 min-h-8 text-[10px] leading-relaxed text-foreground-passive">
                {group.description}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <LatencyStat label="P50" value={group.metrics?.p50Ms} />
                <LatencyStat label="P95" value={group.metrics?.p95Ms} />
                <LatencyStat label="P99" value={group.metrics?.p99Ms} />
                <LatencyStat
                  label={t('workspaceRuntime.resources.details.maximum')}
                  value={group.metrics?.maxMs}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function WorktreeDetails({
  storage,
  isScanning,
  onRefresh,
  onOpenTask,
}: {
  storage: WorktreeStorageSnapshot | undefined;
  isScanning: boolean;
  onRefresh: () => void;
  onOpenTask: (item: WorktreeStorageItem) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const showConfirmActionModal = useShowModal('confirmActionModal');
  const items = [...(storage?.items ?? [])].sort((left, right) => right.sizeBytes - left.sizeBytes);

  const cleanupWorktrees = async () => {
    try {
      const result = await rpc.projects.cleanupUnusedWorktrees();
      await queryClient.invalidateQueries({ queryKey: ['projects', 'worktreeStorage'] });
      if (result.removedCount === 0) {
        toast(t('workspaceRuntime.resources.worktreeCleanupNone'));
      } else {
        toast.success(
          t('workspaceRuntime.resources.worktreeCleanupSuccess', {
            count: result.removedCount,
            size: formatBytes(result.reclaimedBytes),
          })
        );
      }
      if (result.failedPaths.length > 0) {
        toast.error(
          t('workspaceRuntime.resources.worktreeCleanupPartial', {
            count: result.failedPaths.length,
          })
        );
      }
    } catch {
      toast.error(t('workspaceRuntime.resources.worktreeCleanupFailed'));
    }
  };

  const confirmCleanup = () => {
    if (!storage?.reclaimableCount) return;
    showConfirmActionModal({
      title: t('workspaceRuntime.resources.confirmCleanupTitle'),
      description: t('workspaceRuntime.resources.confirmCleanupDescription', {
        count: storage.reclaimableCount,
        size: formatBytes(storage.reclaimableBytes),
      }),
      confirmLabel: t('workspaceRuntime.resources.cleanup'),
      variant: 'default',
      onSuccess: () => void cleanupWorktrees(),
    });
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <ResourceSummaryCard
          label={t('workspaceRuntime.resources.details.totalStorage')}
          value={storage ? formatBytes(storage.totalBytes) : '—'}
          description={t('workspaceRuntime.resources.details.worktreeCount', {
            count: storage?.worktreeCount ?? 0,
          })}
        />
        <ResourceSummaryCard
          label={t('workspaceRuntime.resources.details.reclaimableStorage')}
          value={storage ? formatBytes(storage.reclaimableBytes) : '—'}
          description={t('workspaceRuntime.resources.details.reclaimableCount', {
            count: storage?.reclaimableCount ?? 0,
          })}
        />
        <ResourceSummaryCard
          label={t('workspaceRuntime.resources.details.protectedStorage')}
          value={
            storage ? formatBytes(Math.max(0, storage.totalBytes - storage.reclaimableBytes)) : '—'
          }
          description={t('workspaceRuntime.resources.details.protectedDescription')}
        />
      </div>
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-medium text-foreground">
              {t('workspaceRuntime.resources.details.worktreeInventory')}
            </h2>
            <p className="mt-0.5 text-[10px] text-foreground-passive">
              {t('workspaceRuntime.resources.details.sortedBySize')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isScanning}
              onClick={onRefresh}
            >
              <RefreshCw aria-hidden className={cn('size-3.5', isScanning && 'animate-spin')} />
              {isScanning
                ? t('workspaceRuntime.resources.details.refreshing')
                : t('workspaceRuntime.resources.details.refresh')}
            </Button>
            {storage?.reclaimableCount ? (
              <Button type="button" variant="outline" size="sm" onClick={confirmCleanup}>
                {t('workspaceRuntime.resources.cleanup')}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          {isScanning && !storage ? (
            <EmptyDetails>{t('workspaceRuntime.resources.scanningWorktrees')}</EmptyDetails>
          ) : items.length > 0 ? (
            <div className="max-h-[22rem] divide-y divide-border overflow-y-auto">
              {items.map((item) => (
                <WorktreeRow
                  key={`${item.projectId}:${item.path}`}
                  item={item}
                  onOpenTask={onOpenTask}
                />
              ))}
            </div>
          ) : (
            <EmptyDetails>{t('workspaceRuntime.resources.details.noWorktrees')}</EmptyDetails>
          )}
        </div>
      </section>
    </>
  );
}

function WorktreeRow({
  item,
  onOpenTask,
}: {
  item: WorktreeStorageItem;
  onOpenTask: (item: WorktreeStorageItem) => void;
}) {
  const { t } = useTranslation();
  const target: FilePathTarget = {
    absolutePath: item.path,
    kind: 'directory',
    sshConnectionId: null,
  };
  const passiveStatus = item.reclaimable
    ? {
        label: t('workspaceRuntime.resources.details.reclaimable'),
        className: 'text-emerald-600 dark:text-emerald-400',
      }
    : item.dirty
      ? {
          label: t('workspaceRuntime.resources.details.hasChanges'),
          className: 'text-amber-600 dark:text-amber-400',
        }
      : {
          label: t('workspaceRuntime.resources.details.retained'),
          className: 'text-foreground-passive',
        };
  const taskLabel =
    item.activeTaskName?.trim() ||
    (item.activeTaskId
      ? t('workspaceRuntime.resources.details.taskFallback', {
          id: item.activeTaskId.slice(0, 8),
        })
      : null);
  const identity = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-passive">
        <GitBranch aria-hidden className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground">{item.projectName}</span>
          {item.branch ? (
            <span className="shrink-0 truncate font-mono text-[10px] text-foreground-passive">
              {item.branch}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-foreground-passive">
          {item.path}
        </span>
      </span>
    </>
  );
  const size = (
    <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-foreground-muted">
      {formatBytes(item.sizeBytes)}
    </span>
  );

  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
      {item.activeTaskId && taskLabel ? (
        <button
          type="button"
          aria-label={t('workspaceRuntime.resources.details.openTask', { task: taskLabel })}
          title={t('workspaceRuntime.resources.details.openTask', { task: taskLabel })}
          data-worktree-task-id={item.activeTaskId}
          className="-my-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-md px-1.5 py-1.5 text-left outline-none transition-colors hover:bg-background-2 focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => onOpenTask(item)}
        >
          {identity}
          <span className="inline-flex max-w-36 shrink-0 items-center gap-1 rounded-md bg-status-in-review/10 px-2 py-1 text-[10px] text-status-in-review">
            <span className="truncate">{taskLabel}</span>
            <ArrowUpRight aria-hidden className="size-3 shrink-0" />
          </span>
          {size}
        </button>
      ) : (
        <>
          {identity}
          <span className={cn('shrink-0 text-[10px]', passiveStatus.className)}>
            {passiveStatus.label}
          </span>
          {size}
        </>
      )}
      <FilePathActionsDropdown target={target} />
    </div>
  );
}

function ResourceSummaryCard({
  label,
  value,
  description,
  className,
}: {
  label: string;
  value: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-background p-4', className)}>
      <div className="text-[10px] uppercase tracking-wide text-foreground-passive">{label}</div>
      <div className="mt-2 font-mono text-2xl font-medium tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-foreground-passive">{description}</div>
    </div>
  );
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-xs font-medium text-foreground">{title}</h2>
      <span className="text-[10px] text-foreground-passive">{detail}</span>
    </div>
  );
}

function LatencyStat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-md bg-background-2 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-foreground-passive">{label}</div>
      <div className="mt-0.5 font-mono text-xs tabular-nums text-foreground">
        {value == null ? '—' : formatMs(value)}
      </div>
    </div>
  );
}

function EmptyDetails({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center px-4 py-8 text-xs text-foreground-passive">
      {children}
    </div>
  );
}

function buildProcessRows(
  snapshot: AppResourceSnapshot | undefined,
  t: ReturnType<typeof useTranslation>['t']
): ResourceProcessRow[] {
  if (!snapshot) return [];
  return [
    ...snapshot.processes.map((process) => ({
      id: `process:${process.pid}`,
      name: getProcessLabel(process.type, t),
      description: t('workspaceRuntime.resources.details.yodaProcess'),
      pid: process.pid,
      cpuPercent: process.cpuPercent,
      memoryBytes: process.memoryBytes,
      agent: false,
    })),
    ...snapshot.agentSessions.map((session) => ({
      id: `agent:${session.projectId}:${session.taskId}:${session.conversationId}`,
      name:
        session.title.trim() ||
        t('workspaceRuntime.resources.details.agentFallback', {
          id: session.conversationId.slice(0, 8),
        }),
      description: `${session.taskTitle} · ${session.runtimeId}`,
      pid: session.pid,
      cpuPercent: session.cpuPercent,
      memoryBytes: session.memoryBytes,
      agent: true,
    })),
  ];
}

function getProcessLabel(type: string, t: ReturnType<typeof useTranslation>['t']): string {
  const normalized = type.toLowerCase();
  if (normalized.includes('browser')) return t('workspaceRuntime.resources.details.mainProcess');
  if (normalized.includes('gpu')) return t('workspaceRuntime.resources.details.gpuProcess');
  if (normalized.includes('tab') || normalized.includes('renderer')) {
    return t('workspaceRuntime.resources.details.rendererProcess');
  }
  if (normalized.includes('utility')) {
    return t('workspaceRuntime.resources.details.utilityProcess');
  }
  return t('workspaceRuntime.resources.details.otherProcess', { type });
}

function getDetailCopy(
  kind: WorkspaceResourceDetailKind,
  t: ReturnType<typeof useTranslation>['t']
): { title: string; description: string; icon: LucideIcon } {
  switch (kind) {
    case 'cpu':
      return {
        title: t('workspaceRuntime.resources.details.cpuTitle'),
        description: t('workspaceRuntime.resources.details.cpuDescription'),
        icon: Cpu,
      };
    case 'memory':
      return {
        title: t('workspaceRuntime.resources.details.memoryTitle'),
        description: t('workspaceRuntime.resources.details.memoryDescription'),
        icon: MemoryStick,
      };
    case 'latency':
      return {
        title: t('workspaceRuntime.resources.details.latencyTitle'),
        description: t('workspaceRuntime.resources.details.latencyDescription'),
        icon: Timer,
      };
    case 'worktrees':
      return {
        title: t('workspaceRuntime.resources.details.worktreesTitle'),
        description: t('workspaceRuntime.resources.details.worktreesDescription'),
        icon: HardDrive,
      };
  }
}

function formatCpu(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function formatMs(value: number): string {
  return `${Math.round(value * 10) / 10} ms`;
}

function formatSampleTime(
  value: string | undefined,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!value) return t('workspaceRuntime.resources.details.waitingForSamples');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return t('workspaceRuntime.resources.details.waitingForSamples');
  }
  return t('workspaceRuntime.resources.details.sampledAt', {
    time: new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date),
  });
}
