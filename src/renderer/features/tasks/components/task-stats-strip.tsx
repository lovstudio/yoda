import { Flame, GitCompare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  addTokenBuckets,
  emptyTokenBuckets,
  type TaskStats,
  type TokenBuckets,
} from '@shared/stats';
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

export function tokenBreakdownTitle(
  tokens: TokenBuckets,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return t('tasks.details.stats.tokenBreakdown', {
    input: formatCompactNumber(tokens.input),
    output: formatCompactNumber(tokens.output),
    cache: formatCompactNumber(tokens.cacheRead + tokens.cacheCreation),
  });
}

/**
 * Task-level totals under the overview header: full code delta (committed
 * since source branch + working tree, falling back to the archived snapshot)
 * and total token burn across all of the task's sessions.
 */
export function TaskStatsStrip({ stats, className }: { stats: TaskStats; className?: string }) {
  const { t } = useTranslation();
  const { diff } = stats;
  const tokens = sumTaskTokens(stats);
  const showDiff = diff.source !== 'none' && (diff.additions > 0 || diff.deletions > 0);

  if (!showDiff && !tokens) return null;

  return (
    <div className={cn('flex items-center gap-4 text-xs text-foreground-passive', className)}>
      {showDiff && (
        <span
          className="flex items-center gap-1.5 tabular-nums"
          title={t('tasks.details.stats.linesTitle')}
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
          {t('tasks.details.stats.tokens', { value: formatCompactNumber(tokens.total) })}
        </span>
      )}
    </div>
  );
}
