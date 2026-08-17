import { Copy, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MaasUsageSummary } from '@shared/maas';
import { WorkspaceBarCardFooter, WorkspaceBarCardSection } from '@renderer/app/workspace-bar-card';
import { Button } from '@renderer/lib/ui/button';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';
import { ContextProgressBar, RuntimeMetricRow } from './bar-chrome';
import {
  formatAbsoluteDateTime,
  formatRelativeTimeSince,
  formatUsagePeriod,
  formatUsd,
  getUsageTone,
} from './display';

/**
 * The usage half of the account card when a third-party platform is routing the
 * session. What a platform can answer varies — credits, tokens, or neither — so
 * every figure is conditional.
 *
 * Which platform it is, where its console lives, and how to rebind it are the
 * model-access entry's subject, not this card's. Here the platform appears only
 * as the account type in the shared header.
 */
export function WorkspaceMaasUsageContent({
  providerName,
  usage,
  loading,
  refreshing,
  error,
  onRefresh,
  onCopyError,
}: {
  providerName: string;
  usage: MaasUsageSummary | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onCopyError: (error?: string | null) => void;
}) {
  const { t } = useTranslation();
  const metrics = readUsageMetrics(usage);
  const usageProgressPercent =
    usage?.totalCostUsd != null && usage.totalCreditsUsd != null && usage.totalCreditsUsd > 0
      ? Math.round((usage.totalCostUsd / usage.totalCreditsUsd) * 100)
      : null;

  return (
    <>
      <WorkspaceBarCardSection>
        {loading && !usage ? (
          <div className="flex items-center gap-2 text-xs text-foreground-passive">
            <RefreshCw aria-hidden className="size-3.5 animate-spin" />
            {t('workspaceRuntime.maasUsageLoading')}
          </div>
        ) : error ? (
          <div className="text-[11px] leading-relaxed">
            <div className="text-xs font-medium text-foreground">
              {t('workspaceRuntime.maasUsageUnavailable')}
            </div>
            <p className="mt-1 break-words text-foreground-passive">{error}</p>
            <button
              type="button"
              className="mt-1.5 inline-flex items-center gap-1 text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => onCopyError()}
            >
              <Copy aria-hidden className="size-3" />
              {t('workspaceRuntime.maasUsageCopyError')}
            </button>
          </div>
        ) : metrics.length === 0 ? (
          <div className="text-xs leading-relaxed text-foreground-passive">
            {t('workspaceRuntime.maasUsageNoReadableApi', { provider: providerName })}
          </div>
        ) : (
          <div className="grid gap-2.5">
            {usageProgressPercent != null ? (
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-foreground-passive">
                    {t('workspaceRuntime.maasUsageProgress')}
                  </span>
                  <span className="font-mono tabular-nums text-foreground-muted">
                    {usageProgressPercent}%
                  </span>
                </div>
                <ContextProgressBar
                  percent={usageProgressPercent}
                  tone={getUsageTone(usageProgressPercent)}
                />
              </div>
            ) : null}
            {/* One row per figure, values in an aligned mono column: a platform
                answering a single number reads as a short version of the same
                card, where a two-column grid leaves a hole beside the lone cell. */}
            <div className="grid gap-1.5 text-xs">
              {metrics.map((metric) => (
                <RuntimeMetricRow
                  key={metric.labelKey}
                  label={t(metric.labelKey)}
                  value={metric.value}
                  title={metric.title}
                />
              ))}
            </div>
          </div>
        )}
      </WorkspaceBarCardSection>

      {/* A partial read — this key's own figures, the account balance still
          unread — changes what the numbers above cover, so it is worth a line.
          Whether the key carries a quota of its own is not that line's subject:
          such a key is still bounded by the account balance, so calling it
          "unlimited" beside a four-figure spend claims a budget nobody has. A
          wholly failed read already said so above. */}
      {error ? null : usage?.accountUsageStatus === 'credential-required' ? (
        <WorkspaceBarCardSection className="text-[11px] leading-relaxed text-foreground-passive">
          {t('workspaceRuntime.maasUsageKeyScopeNote')}
        </WorkspaceBarCardSection>
      ) : usage?.accountUsageStatus === 'error' && usage.accountUsageError ? (
        <WorkspaceBarCardSection className="text-[11px] leading-relaxed">
          <div className="font-medium text-foreground-muted">
            {t('workspaceRuntime.maasUsageAccountUnavailable')}
          </div>
          <div className="mt-0.5 break-words text-foreground-passive">
            {usage.accountUsageError}
          </div>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => onCopyError(usage.accountUsageError)}
          >
            <Copy aria-hidden className="size-3" />
            {t('workspaceRuntime.maasUsageCopyError')}
          </button>
        </WorkspaceBarCardSection>
      ) : null}

      <WorkspaceBarCardFooter>
        {usage?.period ? (
          <div className="truncate text-[11px] text-foreground-passive">
            {formatUsagePeriod(usage.period.startingAt, usage.period.endingAt)}
          </div>
        ) : null}
        <Button
          type="button"
          className={cn('w-full', usage?.period && 'mt-2')}
          size="sm"
          variant="outline"
          disabled={loading || refreshing}
          onClick={onRefresh}
        >
          <RefreshCw
            aria-hidden
            className={cn('size-3.5', (loading || refreshing) && 'animate-spin')}
          />
          {refreshing
            ? t('workspaceRuntime.refreshingAccountUsage')
            : t('workspaceRuntime.refreshAccountUsage')}
        </Button>
      </WorkspaceBarCardFooter>
    </>
  );
}

type UsageMetric = {
  labelKey: string;
  value: string;
  /** Full timestamp behind an abbreviated reading. */
  title?: string;
};

/**
 * The figures a platform actually answered, in reading order: what is left, when
 * it was read, then what was spent — money before tokens. Absent fields drop out
 * rather than rendering as a zero the platform never reported.
 */
function readUsageMetrics(usage: MaasUsageSummary | null): UsageMetric[] {
  if (!usage || usage.source === 'none') return [];

  const usd = (labelKey: string, value: number | null | undefined): UsageMetric[] =>
    value == null ? [] : [{ labelKey, value: formatUsd(value) }];
  const count = (labelKey: string, value: number | null | undefined): UsageMetric[] =>
    value == null ? [] : [{ labelKey, value: formatCompactNumber(value) }];

  const balances = [
    ...usd('workspaceRuntime.maasUsageRemainingCredits', usage.remainingCreditsUsd),
    ...usd('workspaceRuntime.maasUsageTotalCredits', usage.totalCreditsUsd),
    ...usd('workspaceRuntime.maasUsageKeyRemaining', usage.keyLimitRemainingUsd),
  ];
  const spend = [
    ...usd('workspaceRuntime.maasUsageTotalCost', usage.totalCostUsd),
    ...usd('workspaceRuntime.maasUsageToday', usage.usageDailyUsd),
    ...usd('workspaceRuntime.maasUsageThisWeek', usage.usageWeeklyUsd),
    ...count('workspaceRuntime.maasUsageInputTokens', usage.totalInputTokens),
    ...count('workspaceRuntime.maasUsageOutputTokens', usage.totalOutputTokens),
  ];
  if (balances.length === 0 && spend.length === 0) return [];

  // How stale the reading is qualifies every figure below it, so it sits between
  // the balances and the spend rather than in the footer.
  const readAt: UsageMetric[] = usage.fetchedAt
    ? [
        {
          labelKey: 'workspaceRuntime.maasUsageLastUpdated',
          value: formatRelativeTimeSince(usage.fetchedAt),
          title: formatAbsoluteDateTime(usage.fetchedAt),
        },
      ]
    : [];

  return [...balances, ...readAt, ...spend];
}
