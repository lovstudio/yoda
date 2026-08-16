import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { startRendererPerformanceReporter } from '@renderer/app/renderer-performance-reporter';
import { WORKSPACE_BAR_CARD_CLASS, WorkspaceBarCardHeader } from '@renderer/app/workspace-bar-card';
import type { WorkspaceResourceDetailKind } from '@renderer/app/workspace-resource-details-modal';
import {
  getWorkspaceLatencyP95,
  workspaceResourceHistoryStore,
} from '@renderer/app/workspace-resource-history';
import { WorkspaceResourceMetric } from '@renderer/app/workspace-resource-metric';
import { WorkspaceResourceTrend } from '@renderer/app/workspace-resource-trend';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { RUNTIME_BAR_ACTION_CLASS, RUNTIME_BAR_ACTION_LABEL_CLASS } from '../bar-chrome';
import { formatBytes } from '../display';
import { useWorkspaceResourceSnapshot } from '../resource-snapshot';

/**
 * What the machine is spending on this workspace. The four metrics are the ones
 * a stall is usually traced to, and each opens the detail view rather than
 * trying to explain itself in a tile.
 */
export const RuntimeBarResourcesItem = observer(function RuntimeBarResourcesItem() {
  const { t } = useTranslation();
  const showResourceDetailsModal = useShowModal('workspaceResourceDetailsModal');
  const [isResourcePopoverOpen, setIsResourcePopoverOpen] = useState(false);
  const { data: resourceSnapshot } = useWorkspaceResourceSnapshot();
  const resourceHistory = useSyncExternalStore(
    workspaceResourceHistoryStore.subscribe,
    workspaceResourceHistoryStore.getSnapshot,
    workspaceResourceHistoryStore.getSnapshot
  );
  useEffect(() => startRendererPerformanceReporter(), []);
  useEffect(() => {
    if (!resourceSnapshot) return;
    workspaceResourceHistoryStore.append(resourceSnapshot);
  }, [resourceSnapshot]);

  const { data: worktreeStorage, isFetching: isFetchingWorktreeStorage } = useQuery({
    queryKey: ['projects', 'worktreeStorage'],
    queryFn: () => rpc.projects.getWorktreeStorageSnapshot(),
    enabled: isResourcePopoverOpen,
    staleTime: 60_000,
    refetchInterval: (query) =>
      (query.state.data?.pendingInspectionCount ?? 0) > 0 ||
      query.state.data?.unregisteredUnknownScanInProgress
        ? 1_000
        : false,
    refetchOnWindowFocus: false,
  });
  const isScanningWorktrees =
    isFetchingWorktreeStorage ||
    (worktreeStorage?.pendingInspectionCount ?? 0) > 0 ||
    worktreeStorage?.unregisteredUnknownScanInProgress === true;
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
        className={cn(WORKSPACE_BAR_CARD_CLASS, 'w-[420px]')}
      >
        <WorkspaceBarCardHeader
          icon={Activity}
          title={t('workspaceRuntime.resources.title')}
          description={t('workspaceRuntime.resources.description')}
        />
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
  );
});
