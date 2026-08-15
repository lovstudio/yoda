import { Ellipsis, Trash2 } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useMcps } from '@renderer/features/mcp/components/useMcps';
import {
  clearTaskOpenTrajectories,
  getTaskOpenTrajectories,
  slowestTaskOpenStep,
  subscribeTaskOpenTrajectories,
  type TaskOpenTrajectory,
  type TaskOpenTrajectoryStep,
} from '@renderer/features/tasks/task-open-trajectory';
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

/** Total the bars are scaled against — an open still running has no end yet. */
function trajectorySpan(trajectory: TaskOpenTrajectory): number {
  return Math.max(trajectory.totalMs ?? 0, trajectory.steps.at(-1)?.atMs ?? 0, 1);
}

function StepRow({
  step,
  span,
  isSlowest,
}: {
  step: TaskOpenTrajectoryStep;
  span: number;
  isSlowest: boolean;
}) {
  const start = ((step.atMs - step.durationMs) / span) * 100;
  const width = Math.max((step.durationMs / span) * 100, 0.75);

  return (
    <div className="flex items-center gap-2 py-[3px]">
      <span
        className={cn(
          'w-[40%] shrink-0 truncate font-mono text-[10px]',
          isSlowest ? 'text-foreground' : 'text-foreground-passive'
        )}
        title={step.stage}
      >
        {step.stage}
      </span>
      <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-background-2">
        <span
          className={cn(
            'absolute inset-y-0 rounded-full',
            isSlowest
              ? 'bg-amber-500'
              : step.source === 'main'
                ? 'bg-foreground-disabled'
                : 'bg-primary'
          )}
          style={{
            left: `${Math.min(start, 99)}%`,
            width: `${Math.min(width, 100 - Math.min(start, 99))}%`,
          }}
        />
      </span>
      <span
        className={cn(
          'w-12 shrink-0 text-right font-mono text-[10px] tabular-nums',
          isSlowest ? 'text-foreground' : 'text-foreground-passive'
        )}
      >
        {formatTrajectoryDuration(step.durationMs)}
      </span>
    </div>
  );
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
  const slowest = useMemo(() => (selected ? slowestTaskOpenStep(selected) : undefined), [selected]);
  const mcpCount = selected && isColdSpawn(selected) ? installed.length : 0;

  if (!selected) {
    return (
      <div className="p-4 text-xs text-foreground-passive">
        {t('workspaceRuntime.trajectory.empty')}
      </div>
    );
  }

  const span = trajectorySpan(selected);
  const taskName = resolveTaskName(selected.projectId, selected.taskId);

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
            {slowest && slowest.durationMs > 0 ? (
              <>
                <span aria-hidden>·</span>
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="truncate underline decoration-dotted" />}
                  >
                    {slowest.stage}
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

      <div className="max-h-72 overflow-y-auto px-3 py-2">
        {selected.steps.map((step) => (
          <StepRow
            key={`${step.source}:${step.stage}:${step.atMs}`}
            step={step}
            span={span}
            isSlowest={slowest !== undefined && step === slowest && step.durationMs > 0}
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
