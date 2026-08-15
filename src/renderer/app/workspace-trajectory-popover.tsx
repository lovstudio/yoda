import { Copy, Timer, Trash2 } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useMcps } from '@renderer/features/mcp/components/useMcps';
import {
  clearTaskOpenTrajectories,
  getTaskOpenTrajectories,
  subscribeTaskOpenTrajectories,
  type TaskOpenTrajectory,
  type TaskOpenTrajectoryDetails,
} from '@renderer/features/tasks/task-open-trajectory';
import {
  analyzeTaskOpenTrajectory,
  TASK_OPEN_LANE_GROUPS,
  type TaskOpenGap,
  type TaskOpenLaneId,
  type TaskOpenLaneSegment,
  type TaskOpenLaneTrack,
} from '@renderer/features/tasks/task-open-trajectory-lanes';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { appState } from '@renderer/lib/stores/app-state';
import { DropdownMenuItem, DropdownMenuSeparator } from '@renderer/lib/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  WorkspaceBarCardHeader,
  WorkspaceBarCardMenu,
  WorkspaceBarCardSection,
} from './workspace-bar-card';

export function useTaskOpenTrajectories(): TaskOpenTrajectory[] {
  return useSyncExternalStore(subscribeTaskOpenTrajectories, getTaskOpenTrajectories);
}

export function formatTrajectoryDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

/**
 * The lane-label column and the left edge of every track have to agree: the
 * dead-air bands are one layer behind all the rows, so they can only line up
 * with the tracks if both are positioned from the same offset.
 */
const LANE_LABEL_CLASS = 'w-16 shrink-0 truncate text-[10px] leading-4 text-foreground-passive';
const TRACK_LEFT_CLASS = 'left-[4.5rem]';

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

/**
 * The one detail worth reading without opening the JSON: a stage that can be
 * entered for several different causes says which one it was.
 */
function stepReason(details: TaskOpenTrajectoryDetails): string | undefined {
  const reason = details.reason;
  return typeof reason === 'string' ? reason : undefined;
}

function segmentLabel(segment: TaskOpenLaneSegment): string {
  const reason = stepReason(segment.step.details);
  const at = formatTrajectoryDuration(segment.step.atMs);
  const waited = segment.isLaneStart
    ? ''
    : ` · waited ${formatTrajectoryDuration(segment.durationMs)}`;
  const retried =
    segment.step.repeats > 0
      ? ` · retried ${segment.step.repeats}× until ${formatTrajectoryDuration(segment.step.lastAtMs)}`
      : '';
  return `${segment.step.stage}${reason ? ` (${reason})` : ''} @ ${at}${waited}${retried}`;
}

/**
 * A lane is discrete marks joined by the time between them, not a run of filled
 * bars. Filling each interval made every lane read as one solid block from end
 * to end — the opposite of the question the chart exists to answer, which is
 * *when* each participant did something and how long it then sat idle.
 */
function LaneRow({
  track,
  slowest,
  spanMs,
  laneLabel,
}: {
  track: TaskOpenLaneTrack;
  slowest: TaskOpenLaneSegment | undefined;
  spanMs: number;
  laneLabel: (lane: TaskOpenLaneId) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={LANE_LABEL_CLASS}>{laneLabel(track.lane)}</span>
      <span className="relative h-4 min-w-0 flex-1">
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-border/50" />
        {track.segments.map((segment) => {
          const isSlowest = segment === slowest;
          const retrySpanMs = Math.max(0, segment.step.lastAtMs - segment.step.atMs);
          return (
            <span key={`${segment.step.stage}:${segment.step.atMs}`}>
              {segment.isLaneStart ? null : (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-1/2 -translate-y-1/2 rounded-full',
                    isSlowest ? 'h-[3px] bg-amber-500' : 'h-px bg-foreground-disabled'
                  )}
                  style={{
                    left: `${percent(segment.startMs, spanMs)}%`,
                    width: `${percent(segment.durationMs, spanMs)}%`,
                  }}
                />
              )}
              {retrySpanMs > 0 ? (
                // A retried wait occupied the lane for as long as it kept
                // re-entering. Without this the chip sits alone at its first
                // entry and the interval reads as nobody working, when in fact
                // this lane was spinning through it.
                <span
                  aria-hidden
                  className="absolute top-1/2 h-[5px] -translate-y-1/2 rounded-sm border-y border-dotted border-foreground-passive/60"
                  style={{
                    left: `${percent(segment.step.atMs, spanMs)}%`,
                    width: `${percent(retrySpanMs, spanMs)}%`,
                  }}
                />
              ) : null}
              <span
                title={segmentLabel(segment)}
                className={cn(
                  'absolute top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-[2px]',
                  isSlowest ? 'bg-amber-500' : 'bg-foreground-passive'
                )}
                style={{ left: `${percent(segment.step.atMs, spanMs)}%` }}
              />
            </span>
          );
        })}
      </span>
    </div>
  );
}

/**
 * Dead air belongs to the whole timeline, not to any one lane, so it is drawn
 * once behind every track. Repeating it per row made all six rows look like the
 * same full-width amber band.
 */
function GapBands({ gaps, spanMs }: { gaps: TaskOpenGap[]; spanMs: number }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-y-0 right-3', TRACK_LEFT_CLASS)}
    >
      {gaps.map((gap) => (
        <span
          key={`gap:${gap.startMs}`}
          className="absolute inset-y-0 border-l border-amber-500/40 bg-amber-500/10"
          style={{
            left: `${percent(gap.startMs, spanMs)}%`,
            width: `${percent(gap.durationMs, spanMs)}%`,
          }}
        />
      ))}
    </div>
  );
}

function TimeAxis({ spanMs }: { spanMs: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0" />
      <span className="relative h-3 min-w-0 flex-1 font-mono text-[9px] tabular-nums text-foreground-disabled">
        <span className="absolute left-0">0</span>
        <span className="absolute left-1/2 -translate-x-1/2">
          {formatTrajectoryDuration(spanMs / 2)}
        </span>
        <span className="absolute right-0">{formatTrajectoryDuration(spanMs)}</span>
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
  const message =
    gap.retries > 0
      ? t('workspaceRuntime.trajectory.gap.retry', {
          lane: laneLabel(gap.fromLane),
          stage: gap.fromStage,
          attempts: gap.retries,
          duration,
        })
      : gap.kind === 'handoff'
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
          });

  return (
    <div className="flex items-start gap-1.5 text-[10px] leading-4 text-foreground-passive">
      <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500" />
      <span className="min-w-0">{message}</span>
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
  const reason = stepReason(segment.step.details);

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
      <span className="w-12 shrink-0 truncate font-sans">{laneLabel(segment.lane)}</span>
      <span className="min-w-0 flex-1 truncate" title={segmentLabel(segment)}>
        {segment.step.stage}
        {reason ? <span className="text-foreground-disabled"> · {reason}</span> : null}
        {segment.step.repeats > 0 ? (
          <span className="text-amber-600 dark:text-amber-500"> ×{segment.step.repeats + 1}</span>
        ) : null}
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
      <>
        <WorkspaceBarCardHeader
          icon={Timer}
          title={t('workspaceRuntime.trajectory.title')}
          description={t('workspaceRuntime.trajectory.description')}
        />
        <WorkspaceBarCardSection>
          <p className="text-xs text-foreground-passive">
            {t('workspaceRuntime.trajectory.empty')}
          </p>
        </WorkspaceBarCardSection>
      </>
    );
  }

  const taskName = resolveTaskName(selected.projectId, selected.taskId);
  const slowest = analysis.slowest;

  return (
    <>
      <WorkspaceBarCardHeader
        icon={Timer}
        title={t('workspaceRuntime.trajectory.title')}
        description={t('workspaceRuntime.trajectory.description')}
        actions={
          <WorkspaceBarCardMenu>
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
              <Copy />
              {t('workspaceRuntime.trajectory.copy')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                clearTaskOpenTrajectories();
                setSelectedContextId(null);
              }}
            >
              <Trash2 />
              {t('workspaceRuntime.trajectory.clear')}
            </DropdownMenuItem>
          </WorkspaceBarCardMenu>
        }
      />

      <WorkspaceBarCardSection>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">
            {taskName ?? t('workspaceRuntime.trajectory.unnamedTask')}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-foreground-passive">
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
      </WorkspaceBarCardSection>
      <div className="relative px-3 py-2">
        <GapBands gaps={analysis.gaps} spanMs={analysis.spanMs} />
        <div className="relative space-y-1.5">
          <TimeAxis spanMs={analysis.spanMs} />
          {TASK_OPEN_LANE_GROUPS.map(({ group, lanes }) => {
            const groupTracks = analysis.tracks.filter((track) => lanes.includes(track.lane));
            if (groupTracks.length === 0) return null;
            return (
              <div key={group} className="space-y-0.5">
                <div className="text-[9px] tracking-wide text-foreground-disabled uppercase">
                  {t(`workspaceRuntime.trajectory.group.${group}`)}
                </div>
                {groupTracks.map((track) => (
                  <LaneRow
                    key={track.lane}
                    track={track}
                    slowest={slowest}
                    spanMs={analysis.spanMs}
                    laneLabel={laneLabel}
                  />
                ))}
              </div>
            );
          })}
        </div>
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
