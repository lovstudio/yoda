import { Archive, ArrowUpRight, ChartColumn, Info, Loader2 } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectUsage, TokenBuckets, UsageOverview } from '@shared/stats';
import { useUsageOverview } from '@renderer/features/usage/useUsageOverview';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { agentConfig, type AgentInfo } from '@renderer/utils/agentConfig';
import {
  formatCompactNumber,
  formatCompactNumberParts,
} from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';

const DAILY_WINDOW_DAYS = 30;
const TOP_TASKS_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

// Same green ramp as the usage heatmap — one hue, intensity = how "real" the
// cost is (output is the actual burn, cache reads are nearly free).
const BUCKET_SEGMENTS = [
  { key: 'output', labelKey: 'projects.tokenUsage.output', className: 'bg-foreground-diff-added' },
  { key: 'input', labelKey: 'projects.tokenUsage.input', className: 'bg-foreground-diff-added/70' },
  {
    key: 'cacheCreation',
    labelKey: 'projects.tokenUsage.cacheWrite',
    className: 'bg-foreground-diff-added/40',
  },
  {
    key: 'cacheRead',
    labelKey: 'projects.tokenUsage.cacheRead',
    className: 'bg-foreground-diff-added/15',
  },
] as const satisfies ReadonlyArray<{
  key: keyof TokenBuckets;
  labelKey: string;
  className: string;
}>;

/**
 * Project-scoped token consumption: lifetime total with a bucket composition
 * bar, a 30-day burn chart, and runtime / top-task breakdowns. All data comes
 * from one project-filtered `stats.getUsageOverview` call.
 */
export function TokenUsageCard({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data: overview, isLoading, isError, refetch } = useUsageOverview(projectId);

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-foreground inline-flex items-center gap-2">
          <ChartColumn className="size-3.5" />
          {t('projects.tokenUsage.title')}
          <span
            title={t('usage.caliber.tokens')}
            aria-label={t('usage.caliber.tokens')}
            className="inline-flex shrink-0 cursor-help"
          >
            <Info className="size-3 text-foreground-passive" />
          </span>
        </h2>
        {overview && overview.daily.length > 0 && (
          <span className="text-xs text-foreground-muted">
            {t('projects.tokenUsage.activeDays', { count: overview.daily.length })}
          </span>
        )}
      </header>
      {isError ? (
        <div className="flex items-center gap-3">
          <p className="text-xs text-foreground-muted">{t('usage.loadFailed')}</p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            {t('usage.retry')}
          </Button>
        </div>
      ) : isLoading || !overview ? (
        <div className="flex items-center gap-2 py-2 text-foreground-passive">
          <Loader2 className="size-3.5 animate-spin" />
          <p className="text-xs">{t('usage.loadingHint')}</p>
        </div>
      ) : !overview.tokens ? (
        <p className="text-xs text-foreground-muted">{t('usage.cards.tokensNone')}</p>
      ) : (
        <TokenUsageContent overview={overview} tokens={overview.tokens} projectId={projectId} />
      )}
    </section>
  );
}

function TokenUsageContent({
  overview,
  tokens,
  projectId,
}: {
  overview: UsageOverview;
  tokens: TokenBuckets;
  projectId: string;
}) {
  const { t } = useTranslation();
  const totalParts = formatCompactNumberParts(tokens.total);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <span className="flex items-baseline gap-1 text-2xl font-semibold tabular-nums leading-none">
          {totalParts.value}
          {totalParts.unit && (
            <span className="text-sm text-foreground-passive">{totalParts.unit}</span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {BUCKET_SEGMENTS.map((segment) => (
            <span
              key={segment.key}
              className="flex items-center gap-1.5 text-[11px] text-foreground-muted"
            >
              <span className={cn('size-2 rounded-[2px]', segment.className)} />
              {t(segment.labelKey)}
              <span className="font-mono tabular-nums text-foreground-passive">
                {formatCompactNumber(tokens[segment.key])}
              </span>
            </span>
          ))}
        </div>
      </div>

      <CompositionBar tokens={tokens} />
      <DailyBurnChart daily={overview.daily} />

      {(overview.byProject.length > 1 ||
        overview.byModel.length > 0 ||
        overview.byRuntime.length > 0 ||
        overview.topTasks.length > 0) && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {overview.byProject.length > 1 && (
            <BreakdownList title={t('usage.byProject')}>
              {overview.byProject.map((entry) => (
                <ProjectBreakdownRow
                  key={entry.projectId}
                  entry={entry}
                  currentProjectId={projectId}
                  maxTotal={overview.byProject[0]!.tokens.total}
                />
              ))}
            </BreakdownList>
          )}
          {overview.byModel.length > 0 && (
            <BreakdownList title={t('usage.byModel')}>
              {overview.byModel.map((entry) => (
                <BreakdownRow
                  key={entry.model ?? 'unknown'}
                  leading={
                    <span className="truncate font-mono text-xs" title={entry.model ?? undefined}>
                      {entry.model ?? t('usage.modelUnknown')}
                    </span>
                  }
                  total={entry.tokens.total}
                  maxTotal={overview.byModel[0]!.tokens.total}
                />
              ))}
            </BreakdownList>
          )}
          {overview.byRuntime.length > 0 && (
            <BreakdownList title={t('usage.byRuntime')}>
              {overview.byRuntime.map((entry) => (
                <BreakdownRow
                  key={entry.runtimeId}
                  leading={<RuntimeLabel runtimeId={entry.runtimeId} />}
                  meta={t('usage.sessionCount', { count: entry.sessionCount })}
                  total={entry.tokens.total}
                  maxTotal={overview.byRuntime[0]!.tokens.total}
                />
              ))}
            </BreakdownList>
          )}
          {overview.topTasks.length > 0 && (
            <BreakdownList title={t('projects.tokenUsage.topTasks')}>
              {overview.topTasks.slice(0, TOP_TASKS_LIMIT).map((task) => (
                <TopTaskRow
                  key={task.taskId}
                  projectId={projectId}
                  taskId={task.taskId}
                  name={task.name}
                  archived={task.archived}
                  total={task.tokens.total}
                  maxTotal={overview.topTasks[0]!.tokens.total}
                />
              ))}
            </BreakdownList>
          )}
        </div>
      )}
    </div>
  );
}

/** Single full-width stacked bar showing the share of each token bucket. */
function CompositionBar({ tokens }: { tokens: TokenBuckets }) {
  if (tokens.total <= 0) return null;
  return (
    <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full">
      {BUCKET_SEGMENTS.filter((segment) => tokens[segment.key] > 0).map((segment) => (
        <span
          key={segment.key}
          className={cn('h-full rounded-[1px]', segment.className)}
          style={{ width: `${Math.max(1, (tokens[segment.key] / tokens.total) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Last 30 local days as stacked bars: the intense bottom segment is real burn
 * (input + output), the faint top is cache traffic. Pure flexbox — heights
 * are relative to the busiest day in the window.
 */
function DailyBurnChart({ daily }: { daily: UsageOverview['daily'] }) {
  const { t } = useTranslation();

  const byDate = new Map(daily.map((day) => [day.date, day.tokens]));
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Array.from({ length: DAILY_WINDOW_DAYS }, (_, index) => {
    const date = new Date(todayStart.getTime() - (DAILY_WINDOW_DAYS - 1 - index) * DAY_MS);
    const key = localDateKey(date);
    return { key, tokens: byDate.get(key) };
  });
  const maxTotal = Math.max(...days.map((day) => day.tokens?.total ?? 0));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-14 items-end gap-[3px]">
        {days.map((day) => {
          const total = day.tokens?.total ?? 0;
          const real = day.tokens ? day.tokens.input + day.tokens.output : 0;
          const title =
            total > 0
              ? t('usage.heatmap.dayTooltip', {
                  date: day.key,
                  tokens: formatCompactNumber(total),
                })
              : t('usage.heatmap.emptyDayTooltip', { date: day.key });
          return (
            <div
              key={day.key}
              title={title}
              className="flex h-full flex-1 flex-col justify-end gap-px"
            >
              {total > 0 && maxTotal > 0 ? (
                <>
                  <span
                    className="w-full rounded-t-[2px] bg-foreground-diff-added/20"
                    style={{ height: `${((total - real) / maxTotal) * 100}%` }}
                  />
                  <span
                    className="w-full rounded-[1px] bg-foreground-diff-added"
                    style={{ height: `${Math.max(2, (real / maxTotal) * 100)}%` }}
                  />
                </>
              ) : (
                <span className="h-0.5 w-full rounded-full bg-background-tertiary-2" />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] leading-none text-foreground-passive">
        <span>{days[0]!.key}</span>
        <span>{t('projects.tokenUsage.daily')}</span>
        <span>{days[days.length - 1]!.key}</span>
      </div>
    </div>
  );
}

function BreakdownList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="text-xs font-medium text-foreground-muted">{title}</h3>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function BreakdownRow({
  leading,
  meta,
  total,
  maxTotal,
}: {
  leading: ReactNode;
  meta?: string;
  total: number;
  maxTotal: number;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0">
      <span className="flex min-w-0 flex-1 items-center gap-2">{leading}</span>
      {meta && <span className="shrink-0 text-[11px] text-foreground-passive">{meta}</span>}
      <ProportionBar total={total} maxTotal={maxTotal} />
      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-foreground-muted">
        {formatCompactNumber(total)}
      </span>
    </div>
  );
}

/**
 * One source in the per-project split. Registered auxiliary projects navigate
 * to their own project view for details; the current project and plain
 * directories are static rows.
 */
function ProjectBreakdownRow({
  entry,
  currentProjectId,
  maxTotal,
}: {
  entry: ProjectUsage;
  currentProjectId: string;
  maxTotal: number;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const isCurrent = entry.projectId === currentProjectId;
  const clickable = !isCurrent && !entry.external;

  const body = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={cn(
            'truncate text-xs text-foreground-muted',
            clickable && 'transition-colors group-hover:text-foreground'
          )}
          title={entry.name}
        >
          {isCurrent ? t('projects.tokenUsage.thisProject', { name: entry.name }) : entry.name}
        </span>
        {clickable && (
          <ArrowUpRight
            className="size-3 shrink-0 text-foreground-passive opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        )}
      </span>
      <span className="shrink-0 text-[11px] text-foreground-passive">
        {t('usage.sessionCount', { count: entry.sessionCount })}
      </span>
      <ProportionBar total={entry.tokens.total} maxTotal={maxTotal} />
      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-foreground-muted">
        {formatCompactNumber(entry.tokens.total)}
      </span>
    </>
  );

  if (!clickable) {
    return (
      <div className="flex items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => navigate('project', { projectId: entry.projectId })}
      className="group flex w-full items-center gap-2 border-b border-border/40 py-1.5 text-left last:border-b-0"
    >
      {body}
    </button>
  );
}

function TopTaskRow({
  projectId,
  taskId,
  name,
  archived,
  total,
  maxTotal,
}: {
  projectId: string;
  taskId: string;
  name: string;
  archived: boolean;
  total: number;
  maxTotal: number;
}) {
  const { navigate } = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate('task', { projectId, taskId })}
      className="group flex items-center gap-2 border-b border-border/40 py-1.5 text-left last:border-b-0"
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className="truncate text-xs text-foreground-muted transition-colors group-hover:text-foreground"
          title={name}
        >
          {name}
        </span>
        {archived && <Archive className="size-3 shrink-0 text-foreground-passive" aria-hidden />}
      </span>
      <ProportionBar total={total} maxTotal={maxTotal} />
      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-foreground-muted">
        {formatCompactNumber(total)}
      </span>
    </button>
  );
}

function ProportionBar({ total, maxTotal }: { total: number; maxTotal: number }) {
  return (
    <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-background-tertiary-2">
      <span
        className="block h-full rounded-full bg-foreground-diff-added/60"
        style={{
          width: `${maxTotal > 0 ? Math.max(4, Math.round((total / maxTotal) * 100)) : 0}%`,
        }}
      />
    </span>
  );
}

function RuntimeLabel({ runtimeId }: { runtimeId: string }) {
  const info = (agentConfig as Record<string, AgentInfo | undefined>)[runtimeId];
  if (!info) return <span className="truncate text-xs">{runtimeId}</span>;
  return (
    <>
      <AgentLogo
        logo={info.logo}
        alt={info.alt}
        isSvg={info.isSvg}
        invertInDark={info.invertInDark}
        className="size-3.5 shrink-0"
      />
      <span className="truncate text-xs">{info.name}</span>
    </>
  );
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
