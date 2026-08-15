import { Ellipsis, Trash2 } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useMcps } from '@renderer/features/mcp/components/useMcps';
import {
  clearTaskOpenTrajectories,
  getTaskOpenTrajectories,
  subscribeTaskOpenTrajectories,
  type TaskOpenTrajectory,
} from '@renderer/features/tasks/task-open-trajectory';
import {
  analyzeTaskOpenTrajectory,
  TASK_OPEN_LANE_GROUPS,
  type TaskOpenAnalysis,
  type TaskOpenGap,
  type TaskOpenLaneId,
  type TaskOpenLaneSegment,
  type TaskOpenLaneTrack,
} from '@renderer/features/tasks/task-open-trajectory-lanes';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

export function useTaskOpenTrajectories(): TaskOpenTrajectory[] {
  return useSyncExternalStore(subscribeTaskOpenTrajectories, getTaskOpenTrajectories);
}

export function formatTrajectoryDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

function percent(value: number, span: number): number {
  return Math.min(100, Math.max(0, (value / span) * 100));
}

/**
 * A cold provider spawn pays every configured MCP server's startup; a tmux
 * reattach does not. Only the former is worth telling the user about.
 */
function isColdSpawn(trajectory: TaskOpenTrajectory): boolean {
  let spawned = false;
  for (const step of trajectory.steps) {
    if (step.stage === 'tmux-reattach-confirm') return false;
    if (step.stage === 'provider-spawn') spawned = true;
  }
  return spawned;
}

function LaneRow({
  track,
  analysis,
  laneLabel,
}: {
  track: TaskOpenLaneTrack;
  analysis: TaskOpenAnalysis;
  laneLabel: (lane: TaskOpenLaneId) => string;
}) {
  const { spanMs, gaps, slowest } = analysis;

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 truncate text-[10px] text-foreground-passive">
        {laneLabel(track.lane)}
      </span>
      <span className="relative h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-background-2">
        {gaps.map((gap) => (
          <span
            key={`gap:${gap.startMs}`}
            aria-hidden
            className="absolute inset-y-0 bg-amber-500/15"
            style={{
              left: `${percent(gap.startMs, spanMs)}%`,
              width: `${percent(gap.durationMs, spanMs)}%`,
            }}
          />
        ))}
        {track.segments.map((segment) => {
          const isSlowest = segment === slowest;
          const label = `${segment.step.stage} · ${formatTrajectoryDuration(segment.durationMs)} @ ${formatTrajectoryDuration(segment.step.atMs)}`;
          if (segment.isLaneStart) {
            return (
              <span
                key={`start:${segment.step.stage}:${segment.step.atMs}`}
                title={label}
                className="absolute inset-y-1 w-[3px] rounded-full bg-foreground-passive"
                style={{ left: `calc(${percent(segment.step.atMs, spanMs)}% - 1px)` }}
              />
            );
          }
          return (
            <span
              key={`seg:${segment.step.stage}:${segment.step.atMs}`}
              title={label}
              className={cn(
                'absolute inset-y-1 rounded-full',
                isSlowest ? 'bg-amber-500' : 'bg-foreground-disabled'
              )}
              style={{
                left: `${percent(segment.startMs, spanMs)}%`,
                width: `max(2px, ${percent(segment.durationMs, spanMs)}%)`,
              }}
            />
          );
        })}
      </span>
    </div>
  );
}

function GapFinding({
  gap,
  laneLabel,
}: {
  gap: TaskOpenGap;
  laneLabel: (lane: TaskOpenLaneId) => string;
}) {
  const { t } = useTranslation();
  const duration = formatTrajectoryDuration(gap.durationMs);

  return (
    <div className="flex items-start gap-1.5 text-[10px] leading-4 text-foreground-passive">
      <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500" />
      <span className="min-w-0">
        {gap.kind === 'handoff'
          ? t('workspaceRuntime.trajectory.gap.handoff', {
              from: laneLabel(gap.fromLane),
              to: laneLabel(gap.toLane),
              stage: gap.fromStage,
              duration,
            })
          : t('workspaceRuntime.trajectory.gap.stall', {
              lane: laneLabel(gap.fromLane),
              stage: gap.fromStage,
              duration,
            })}
      </span>
    </div>
  );
}

function StepRow({
  segment,
  isSlowest,
  laneLabel,
}: {
  segment: TaskOpenLaneSegment;
  isSlowest: boolean;
  laneLabel: (lane: TaskOpenLaneId) => string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-[2px] font-mono text-[10px] tabular-nums',
        isSlowest ? 'text-foreground' : 'text-foreground-passive'
      )}
    >
      <span className="w-10 shrink-0 text-right">
        {formatTrajectoryDuration(segment.step.atMs)}
      </span>
      <span className="w-14 shrink-0 truncate font-sans">{laneLabel(segment.lane)}</span>
      <span className="min-w-0 flex-1 truncate" title={segment.step.stage}>
        {segment.step.stage}
      </span>
      <span className="w-12 shrink-0 text-right">
        {segment.isLaneStart ? '—' : formatTrajectoryDuration(segment.durationMs)}
      </span>
    </div>
  );
}

export function WorkspaceTrajectoryPopover({
  trajectories,
  resolveTaskName,
}: {
  trajectories: TaskOpenTrajectory[];
  resolveTaskName: (projectId: string, taskId: string) => string | undefined;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { installed } = useMcps();
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);

  const selected =
    trajectories.find((trajectory) => trajectory.contextId === selectedContextId) ??
    trajectories[0];
  const analysis = useMemo(
    () => (selected ? analyzeTaskOpenTrajectory(selected) : undefined),
    [selected]
  );
  const laneLabel = (lane: TaskOpenLaneId) => t(`workspaceRuntime.trajectory.lane.${lane}`);
  const mcpCount = selected && isColdSpawn(selected) ? installed.length : 0;

  if (!selected || !analysis) {
    return (
      <div className="p-4 text-xs text-foreground-passive">
        {t('workspaceRuntime.trajectory.empty')}
      </div>
    );
  }

  const taskName = resolveTaskName(selected.projectId, selected.taskId);
  const slowest = analysis.slowest;

  return (
    <>
      <div className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {taskName ?? t('workspaceRuntime.trajectory.title')}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-foreground-passive">
            <span className="font-mono tabular-nums">
              {selected.totalMs === null ? '—' : formatTrajectoryDuration(selected.totalMs)}
            </span>
            <span aria-hidden>·</span>
            <span>{t(`workspaceRuntime.trajectory.outcome.${selected.outcome}`)}</span>
            {slowest ? (
              <>
                <span aria-hidden>·</span>
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="truncate underline decoration-dotted" />}
                  >
                    {slowest.step.stage}
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {t('workspaceRuntime.trajectory.slowestHint')}
                  </TooltipContent>
                </Tooltip>
              </>
            ) : null}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.more')}
                className="shrink-0"
              />
            }
          >
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={6} className="w-52">
            <DropdownMenuItem
              onClick={() => {
                void copyTextToClipboard(JSON.stringify(selected, null, 2)).then(
                  () => toast({ title: t('workspaceRuntime.trajectory.copied') }),
                  () =>
                    toast({
                      title: t('workspaceRuntime.trajectory.copyFailed'),
                      variant: 'destructive',
                    })
                );
              }}
            >
              {t('workspaceRuntime.trajectory.copy')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                clearTaskOpenTrajectories();
                setSelectedContextId(null);
              }}
            >
              <Trash2 />
              {t('workspaceRuntime.trajectory.clear')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="space-y-1.5 px-3 py-2">
        {TASK_OPEN_LANE_GROUPS.map(({ group, lanes }) => {
          const groupTracks = analysis.tracks.filter((track) => lanes.includes(track.lane));
          if (groupTracks.length === 0) return null;
          return (
            <div key={group} className="space-y-0.5">
              <div className="text-[9px] tracking-wide text-foreground-disabled uppercase">
                {t(`workspaceRuntime.trajectory.group.${group}`)}
              </div>
              {groupTracks.map((track) => (
                <LaneRow key={track.lane} track={track} analysis={analysis} laneLabel={laneLabel} />
              ))}
            </div>
          );
        })}
      </div>

      {analysis.gaps.length > 0 ? (
        <div className="space-y-1 border-t border-border px-3 py-2">
          {analysis.gaps.map((gap) => (
            <GapFinding key={`${gap.startMs}:${gap.toStage}`} gap={gap} laneLabel={laneLabel} />
          ))}
        </div>
      ) : null}

      <div className="max-h-40 overflow-y-auto border-t border-border px-3 py-1.5">
        {analysis.segments.map((segment) => (
          <StepRow
            key={`${segment.lane}:${segment.step.stage}:${segment.step.atMs}`}
            segment={segment}
            isSlowest={segment === slowest}
            laneLabel={laneLabel}
          />
        ))}
      </div>

      {trajectories.length > 1 ? (
        <div className="flex items-center gap-1 overflow-x-auto border-t border-border px-2 py-1.5">
          {trajectories.map((trajectory) => (
            <button
              key={trajectory.contextId}
              type="button"
              onClick={() => setSelectedContextId(trajectory.contextId)}
              title={resolveTaskName(trajectory.projectId, trajectory.taskId) ?? trajectory.taskId}
              className={cn(
                'shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors',
                trajectory.contextId === selected.contextId
                  ? 'bg-background-2 text-foreground'
                  : 'text-foreground-passive hover:bg-background-2 hover:text-foreground'
              )}
            >
              {trajectory.totalMs === null ? '—' : formatTrajectoryDuration(trajectory.totalMs)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[10px] text-foreground-passive">
        <span className="min-w-0 truncate">
          {mcpCount > 0
            ? t('workspaceRuntime.trajectory.mcpHint', { serverCount: mcpCount })
            : t('workspaceRuntime.trajectory.legend')}
        </span>
        {mcpCount > 0 ? (
          <button
            type="button"
            onClick={() => appState.sidePane.pinView('settings', { tab: 'mcp' })}
            className="shrink-0 underline underline-offset-2 hover:text-foreground"
          >
            {t('workspaceRuntime.trajectory.mcpManage')}
          </button>
        ) : null}
      </div>
    </>
  );
}
