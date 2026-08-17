import { CircleDollarSign, Flame, GitCompare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  addTokenBuckets,
  emptyTokenBuckets,
  type TaskStats,
  type TokenBuckets,
  type UsageCost,
} from '@shared/stats';
import { formatUsageCost } from '@renderer/features/usage/format-usage-cost';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { formatDiffLineCount } from '@renderer/utils/format-diff-line-count';
import { cn } from '@renderer/utils/utils';

export function sumTaskTokens(stats: TaskStats): TokenBuckets | null {
  let total: TokenBuckets | null = null;
  for (const conversation of stats.conversations) {
    if (!conversation.tokens) continue;
    total = addTokenBuckets(total ?? emptyTokenBuckets(), conversation.tokens);
  }
  return total;
}

/**
 * The task's estimated spend: the sum of its sessions' estimates, carrying
 * forward every model any of them could not price so the caveat survives the
 * rollup.
 */
export function sumTaskCost(stats: TaskStats): UsageCost | null {
  let usd = 0;
  let priced = false;
  const unpriced = new Set<string>();
  for (const conversation of stats.conversations) {
    if (!conversation.cost) continue;
    priced = true;
    usd += conversation.cost.usd;
    for (const model of conversation.cost.unpricedModels) unpriced.add(model);
  }
  return priced ? { usd, unpricedModels: [...unpriced] } : null;
}

export function tokenBreakdownTitle(
  tokens: TokenBuckets,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return t('tasks.overview.stats.tokenBreakdown', {
    input: formatCompactNumber(tokens.input),
    output: formatCompactNumber(tokens.output),
    cache: formatCompactNumber(tokens.cacheRead + tokens.cacheCreation),
  });
}

/**
 * Task-level totals under the overview header: full code delta (committed
 * since source branch + working tree, falling back to the archived snapshot),
 * total token burn across all of the task's sessions, and what that burn is
 * estimated to have cost.
 */
export function TaskStatsStrip({ stats, className }: { stats: TaskStats; className?: string }) {
  const { t } = useTranslation();
  const { diff } = stats;
  const tokens = sumTaskTokens(stats);
  const cost = sumTaskCost(stats);
  const costDisplay = cost ? formatUsageCost(cost, t) : null;
  const showDiff = diff.source !== 'none' && (diff.additions > 0 || diff.deletions > 0);

  if (!showDiff && !tokens) return null;

  return (
    <div className={cn('flex items-center gap-4 text-xs text-foreground-passive', className)}>
      {showDiff && (
        <span
          className="flex items-center gap-1.5 tabular-nums"
          title={t('tasks.overview.stats.linesTitle')}
        >
          <GitCompare className="size-3.5 shrink-0" />
          <span className="text-foreground-diff-added">+{formatDiffLineCount(diff.additions)}</span>
          <span className="text-foreground-diff-deleted">
            -{formatDiffLineCount(diff.deletions)}
          </span>
        </span>
      )}
      {tokens && (
        <span
          className="flex items-center gap-1.5 tabular-nums"
          title={tokenBreakdownTitle(tokens, t)}
        >
          <Flame className="size-3.5 shrink-0" />
          {t('tasks.overview.stats.tokens', { value: formatCompactNumber(tokens.total) })}
        </span>
      )}
      {costDisplay && (
        <span className="flex items-center gap-1.5 tabular-nums" title={costDisplay.title}>
          <CircleDollarSign className="size-3.5 shrink-0" />
          {costDisplay.value}
        </span>
      )}
    </div>
  );
}
