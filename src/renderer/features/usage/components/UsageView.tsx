import { Archive, ChartColumn, Info, Loader2 } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentAccountProviderId } from '@shared/runtime-registry';
import type { ProjectUsage, TokenBuckets, UsageOverview } from '@shared/stats';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { agentConfig, type AgentInfo } from '@renderer/utils/agentConfig';
import {
  formatCompactNumber,
  formatCompactNumberParts,
} from '@renderer/utils/format-compact-number';
import { formatDiffLineCount } from '@renderer/utils/format-diff-line-count';
import { cn } from '@renderer/utils/utils';
import { useUsageOverview } from '../useUsageOverview';
import { TokenHeatmap } from './TokenHeatmap';

const AUTH_PROVIDER_LABEL_KEYS: Record<AgentAccountProviderId, string> = {
  'official-subscription': 'tasks.overview.stats.authProvider.official-subscription',
  'official-api': 'tasks.overview.stats.authProvider.official-api',
  'yoda-maas': 'tasks.overview.stats.authProvider.yoda-maas',
};

/**
 * Lifetime usage dashboard: overview cards, a daily token-burn heatmap, and
 * runtime / auth-source / per-task breakdowns. All data comes from one
 * `stats.getUsageOverview` call.
 */
export function UsageView({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { data: overview, isLoading, isError, error, refetch } = useUsageOverview();

  return (
    <div
      className={cn('bg-background text-foreground', !embedded && 'h-full min-h-0 overflow-y-auto')}
    >
      <div className={cn('flex w-full flex-col gap-8', !embedded && 'mx-auto max-w-4xl px-8 py-8')}>
        {!embedded && (
          <header className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <ChartColumn className="size-4 text-foreground-muted" />
              <h1 className="text-lg font-semibold">{t('usage.title')}</h1>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('usage.subtitle')}</p>
          </header>
        )}

        {isError ? (
          <div className="flex flex-col items-center gap-3 py-24">
            <p className="text-sm text-foreground-muted">{t('usage.loadFailed')}</p>
            <p className="max-w-md truncate font-mono text-xs text-foreground-passive">
              {String(error)}
            </p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              {t('usage.retry')}
            </Button>
          </div>
        ) : isLoading || !overview ? (
          <div className="flex flex-col items-center gap-3 py-24 text-foreground-passive">
            <Loader2 className="size-5 animate-spin" />
            <p className="text-xs">{t('usage.loadingHint')}</p>
          </div>
        ) : overview.tasksTotal === 0 && !overview.tokens ? (
          <EmptyState label={t('usage.empty')} />
        ) : (
          <UsageContent overview={overview} />
        )}
      </div>
    </div>
  );
}

function UsageContent({ overview }: { overview: UsageOverview }) {
  const { t } = useTranslation();

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('usage.cards.tasksArchived')}
          value={String(overview.tasksArchived)}
          detail={t('usage.cards.tasksTotal', { count: overview.tasksTotal })}
          caliber={t('usage.caliber.tasks')}
        />
        <StatCard
          label={t('usage.cards.tokens')}
          value={overview.tokens ? formatTokenValue(overview.tokens.total) : '0'}
          detail={
            overview.tokens
              ? t('usage.cards.tokensDetail', {
                  input: formatCompactNumber(overview.tokens.input),
                  output: formatCompactNumber(overview.tokens.output),
                  cache: formatCompactNumber(
                    overview.tokens.cacheRead + overview.tokens.cacheCreation
                  ),
                })
              : t('usage.cards.tokensNone')
          }
          caliber={t('usage.caliber.tokens')}
        />
        <StatCard
          label={t('usage.cards.lines')}
          value={
            <span className="flex items-baseline gap-2">
              <span className="text-foreground-diff-added">
                +{formatDiffLineCount(overview.linesAdded)}
              </span>
              <span className="text-foreground-diff-deleted">
                -{formatDiffLineCount(overview.linesDeleted)}
              </span>
            </span>
          }
          detail={t('usage.cards.linesDetail')}
          caliber={t('usage.caliber.lines')}
        />
        <StatCard
          label={t('usage.cards.activeDays')}
          value={String(overview.daily.length)}
          detail={t('usage.cards.activeDaysDetail')}
          caliber={t('usage.caliber.activeDays')}
        />
      </section>

      {overview.daily.length > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-border/70 p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {t('usage.heatmap.title')}
            <CaliberHint text={t('usage.caliber.heatmap')} />
          </h2>
          <TokenHeatmap daily={overview.daily} />
        </section>
      )}

      {(overview.byProject.length > 0 ||
        overview.byModel.length > 0 ||
        overview.byRuntime.length > 0 ||
        overview.byAuthProvider.length > 0) && (
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {overview.byProject.length > 0 && (
            <BreakdownCard title={t('usage.byProject')} caliber={t('usage.caliber.byProject')}>
              {overview.byProject.map((entry) => (
                <ProjectRow key={entry.projectId} entry={entry} />
              ))}
            </BreakdownCard>
          )}
          {overview.byModel.length > 0 && (
            <BreakdownCard title={t('usage.byModel')} caliber={t('usage.caliber.byModel')}>
              {overview.byModel.map((entry) => (
                <BreakdownRow
                  key={entry.model ?? 'unknown'}
                  leading={
                    <span className="truncate font-mono text-xs" title={entry.model ?? undefined}>
                      {entry.model ?? t('usage.modelUnknown')}
                    </span>
                  }
                  meta={t('usage.sessionCount', { count: entry.sessionCount })}
                  tokens={entry.tokens}
                />
              ))}
            </BreakdownCard>
          )}
          {overview.byRuntime.length > 0 && (
            <BreakdownCard title={t('usage.byRuntime')} caliber={t('usage.caliber.byRuntime')}>
              {overview.byRuntime.map((entry) => (
                <BreakdownRow
                  key={entry.runtimeId}
                  leading={<RuntimeLabel runtimeId={entry.runtimeId} />}
                  meta={t('usage.sessionCount', { count: entry.sessionCount })}
                  tokens={entry.tokens}
                />
              ))}
            </BreakdownCard>
          )}
          {overview.byAuthProvider.length > 0 && (
            <BreakdownCard title={t('usage.bySource')} caliber={t('usage.caliber.bySource')}>
              {overview.byAuthProvider.map((entry) => (
                <BreakdownRow
                  key={entry.authProvider ?? 'unknown'}
                  leading={
                    <Badge variant="secondary">
                      {entry.authProvider
                        ? t(AUTH_PROVIDER_LABEL_KEYS[entry.authProvider])
                        : t('usage.sourceUnknown')}
                    </Badge>
                  }
                  tokens={entry.tokens}
                />
              ))}
            </BreakdownCard>
          )}
        </section>
      )}

      {overview.topTasks.length > 0 && <TopTasks overview={overview} />}
    </>
  );
}

/** Hover hint explaining exactly how a number is computed. */
function CaliberHint({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex shrink-0 cursor-help" aria-label={text}>
      <Info className="size-3 text-foreground-passive" />
    </span>
  );
}

function StatCard({
  label,
  value,
  detail,
  caliber,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  caliber: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border/70 p-4">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <CaliberHint text={caliber} />
      </span>
      <span className="text-xl font-semibold tabular-nums leading-none">{value}</span>
      <span className="truncate text-[11px] text-foreground-passive" title={detail}>
        {detail}
      </span>
    </div>
  );
}

function formatTokenValue(total: number): React.ReactNode {
  const parts = formatCompactNumberParts(total);
  return (
    <span className="flex items-baseline gap-0.5">
      {parts.value}
      {parts.unit && <span className="text-sm text-foreground-passive">{parts.unit}</span>}
    </span>
  );
}

function BreakdownCard({
  title,
  caliber,
  children,
}: {
  title: string;
  caliber: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/70 p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {title}
        <CaliberHint text={caliber} />
      </h2>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function BreakdownRow({
  leading,
  meta,
  tokens,
}: {
  leading: React.ReactNode;
  meta?: string;
  tokens: TokenBuckets;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 border-b border-border/40 py-2 last:border-b-0">
      <span className="flex min-w-0 flex-1 items-center gap-2">{leading}</span>
      {meta && <span className="shrink-0 text-[11px] text-foreground-passive">{meta}</span>}
      <span
        className="shrink-0 font-mono text-xs tabular-nums text-foreground-muted"
        title={tokenBreakdownTitle(tokens, t)}
      >
        {formatCompactNumber(tokens.total)}
      </span>
    </div>
  );
}

function ProjectRow({ entry }: { entry: ProjectUsage }) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const body = (
    <>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm text-foreground-muted',
          !entry.external && 'transition-colors group-hover:text-foreground'
        )}
        title={entry.name}
      >
        {entry.name}
      </span>
      <span className="shrink-0 text-[11px] text-foreground-passive">
        {t('usage.sessionCount', { count: entry.sessionCount })}
      </span>
      <span
        className="shrink-0 font-mono text-xs tabular-nums text-foreground-muted"
        title={tokenBreakdownTitle(entry.tokens, t)}
      >
        {formatCompactNumber(entry.tokens.total)}
      </span>
    </>
  );
  // External rows are plain directories — nothing to navigate to.
  if (entry.external) {
    return (
      <div className="flex items-center gap-2 border-b border-border/40 py-2 last:border-b-0">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => navigate('project', { projectId: entry.projectId })}
      className="group flex items-center gap-2 border-b border-border/40 py-2 text-left last:border-b-0"
    >
      {body}
    </button>
  );
}

function RuntimeLabel({ runtimeId }: { runtimeId: string }) {
  const info = (agentConfig as Record<string, AgentInfo | undefined>)[runtimeId];
  if (!info) return <span className="truncate text-sm">{runtimeId}</span>;
  return (
    <>
      <AgentLogo
        logo={info.logo}
        alt={info.alt}
        isSvg={info.isSvg}
        invertInDark={info.invertInDark}
        className="size-4 shrink-0"
      />
      <span className="truncate text-sm">{info.name}</span>
    </>
  );
}

function TopTasks({ overview }: { overview: UsageOverview }) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const maxTokens = overview.topTasks[0]?.tokens.total ?? 0;

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border/70 p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {t('usage.topTasks')}
        <CaliberHint text={t('usage.caliber.topTasks')} />
      </h2>
      <div className="flex flex-col">
        {overview.topTasks.map((task) => (
          <button
            key={task.taskId}
            type="button"
            onClick={() => navigate('task', { projectId: task.projectId, taskId: task.taskId })}
            className="group flex items-center gap-3 border-b border-border/40 py-2 text-left last:border-b-0"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className="truncate text-sm text-foreground-muted transition-colors group-hover:text-foreground"
                title={task.name}
              >
                {task.name}
              </span>
              {task.archived && (
                <Archive className="size-3 shrink-0 text-foreground-passive" aria-hidden />
              )}
            </span>
            <span className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-background-tertiary-2">
              <span
                className="block h-full rounded-full bg-accent/60"
                style={{
                  width: `${maxTokens > 0 ? Math.max(4, Math.round((task.tokens.total / maxTokens) * 100)) : 0}%`,
                }}
              />
            </span>
            <span
              className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-foreground-muted"
              title={tokenBreakdownTitle(task.tokens, t)}
            >
              {formatCompactNumber(task.tokens.total)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function tokenBreakdownTitle(
  tokens: TokenBuckets,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return t('tasks.overview.stats.tokenBreakdown', {
    input: formatCompactNumber(tokens.input),
    output: formatCompactNumber(tokens.output),
    cache: formatCompactNumber(tokens.cacheRead + tokens.cacheCreation),
  });
}
