import { Copy, ExternalLink, Gauge, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MaasUsageSummary } from '@shared/maas';
import {
  WorkspaceBarCardFooter,
  WorkspaceBarCardHeader,
  WorkspaceBarCardMenu,
  WorkspaceBarCardSection,
} from '@renderer/app/workspace-bar-card';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { DropdownMenuItem } from '@renderer/lib/ui/dropdown-menu';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';
import { ContextProgressBar, RuntimeMetricRow } from './bar-chrome';
import { formatPopoverTime, formatUsagePeriod, formatUsd, getUsageTone } from './display';

/**
 * Account usage as reported by a model-access provider rather than by the CLI's
 * own subscription. What a provider can answer varies — tokens, credits, or
 * neither — so every figure is conditional.
 *
 * Which API answered and when belong to the footer, next to the reload that
 * re-reads it. Keeping them out of the title row leaves the provider's own name
 * room to render, which is the one thing the card must not truncate.
 */
export function WorkspaceMaasUsageContent({
  providerName,
  websiteUrl,
  usage,
  loading,
  refreshing,
  error,
  onRefresh,
  onCopyError,
  onManage,
}: {
  providerName: string;
  websiteUrl: string | null;
  usage: MaasUsageSummary | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onCopyError: (error?: string | null) => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const title = t('workspaceRuntime.maasUsageTitle', { provider: providerName });
  const metrics = readUsageMetrics(usage);
  const usageProgressPercent =
    usage?.totalCostUsd != null && usage.totalCreditsUsd != null && usage.totalCreditsUsd > 0
      ? Math.round((usage.totalCostUsd / usage.totalCreditsUsd) * 100)
      : null;
  const periodLabel = usage?.period
    ? formatUsagePeriod(usage.period.startingAt, usage.period.endingAt)
    : t('workspaceRuntime.maasUsageCurrentAccount');
  const provenance = usage
    ? `${t(readSourceLabelKey(usage.source))} · ${periodLabel}`
    : periodLabel;

  return (
    <>
      <WorkspaceBarCardHeader
        icon={Gauge}
        title={<span title={title}>{title}</span>}
        description={t('workspaceRuntime.maasUsageDescription')}
        actions={
          websiteUrl ? (
            <WorkspaceBarCardMenu>
              <DropdownMenuItem
                onClick={() => void rpc.app.openExternal(websiteUrl)}
                title={websiteUrl}
              >
                <ExternalLink aria-hidden />
                {t('workspaceRuntime.maasUsageOpenWebsite', { provider: providerName })}
              </DropdownMenuItem>
            </WorkspaceBarCardMenu>
          ) : null
        }
      />

      <WorkspaceBarCardSection>
        {loading && !usage ? (
          <div className="flex items-center gap-2 text-xs text-foreground-passive">
            <RefreshCw aria-hidden className="size-3.5 animate-spin" />
            {t('workspaceRuntime.maasUsageLoading')}
          </div>
        ) : error ? (
          <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2.5">
            <div className="text-xs font-medium text-foreground">
              {t('workspaceRuntime.maasUsageUnavailable')}
            </div>
            <p className="mt-1 break-words text-[11px] leading-relaxed text-foreground-passive">
              {error}
            </p>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => onCopyError()}>
                <Copy aria-hidden className="size-3.5" />
                {t('workspaceRuntime.maasUsageCopyError')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onManage}>
                {t('workspaceRuntime.maasUsageManage')}
              </Button>
            </div>
          </div>
        ) : usage == null || usage.source === 'none' || metrics.length === 0 ? (
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
            {/* One row per figure, values in an aligned mono column: a provider
                answering a single number reads the same as one answering eight,
                where a two-column grid would leave a hole beside the lone cell. */}
            <div className="grid gap-1.5 text-xs">
              {metrics.map((metric) => (
                <RuntimeMetricRow
                  key={metric.labelKey}
                  label={t(metric.labelKey)}
                  value={
                    metric.format === 'usd'
                      ? formatUsd(metric.value)
                      : formatCompactNumber(metric.value)
                  }
                />
              ))}
            </div>
          </div>
        )}
      </WorkspaceBarCardSection>

      {/* A partial read — token figures answered, account figures not — is worth
          saying. A whole failed read already says it above, so the note stays
          out of the way in that case rather than explaining a second time. */}
      {error ? null : usage?.accountUsageStatus === 'credential-required' ? (
        <WorkspaceBarCardSection className="text-[11px] leading-relaxed text-foreground-passive">
          <span className="font-medium text-foreground-muted">
            {t(
              usage.quotaUnlimited
                ? 'workspaceRuntime.maasUsageUnlimitedToken'
                : 'workspaceRuntime.maasUsageTokenScope'
            )}
          </span>
          <span> {t('workspaceRuntime.maasUsageAccountCredentialRequired')}</span>
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
            className="mt-1 text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => onCopyError(usage.accountUsageError)}
          >
            {t('workspaceRuntime.maasUsageCopyError')}
          </button>
        </WorkspaceBarCardSection>
      ) : null}

      <WorkspaceBarCardFooter>
        <div className="flex items-center justify-between gap-3 text-[11px] text-foreground-passive">
          <span className="min-w-0 truncate" title={provenance}>
            {provenance}
          </span>
          <span className="shrink-0 font-mono tabular-nums">
            {usage?.fetchedAt
              ? t('workspaceRuntime.maasUsageUpdatedAt', {
                  time: formatPopoverTime(usage.fetchedAt),
                })
              : '—'}
          </span>
        </div>
        {/* This card describes the account behind the current session, so the
            only steady-state action is re-reading it. Routing and Profile
            management belong to the global model-access popover, which owns
            that surface already. */}
        <Button
          type="button"
          className="mt-2 w-full"
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
  value: number;
  format: 'usd' | 'count';
};

/**
 * The figures a provider actually answered, in reading order: what is left
 * before what was spent, money before tokens. Absent fields drop out rather
 * than rendering as a zero the provider never reported.
 */
function readUsageMetrics(usage: MaasUsageSummary | null): UsageMetric[] {
  if (!usage) return [];
  const candidates: Array<[string, number | null | undefined, UsageMetric['format']]> = [
    ['workspaceRuntime.maasUsageRemainingCredits', usage.remainingCreditsUsd, 'usd'],
    ['workspaceRuntime.maasUsageTotalCredits', usage.totalCreditsUsd, 'usd'],
    ['workspaceRuntime.maasUsageKeyRemaining', usage.keyLimitRemainingUsd, 'usd'],
    ['workspaceRuntime.maasUsageTotalCost', usage.totalCostUsd, 'usd'],
    ['workspaceRuntime.maasUsageToday', usage.usageDailyUsd, 'usd'],
    ['workspaceRuntime.maasUsageThisWeek', usage.usageWeeklyUsd, 'usd'],
    ['workspaceRuntime.maasUsageInputTokens', usage.totalInputTokens, 'count'],
    ['workspaceRuntime.maasUsageOutputTokens', usage.totalOutputTokens, 'count'],
  ];
  return candidates.flatMap(([labelKey, value, format]) =>
    value == null ? [] : [{ labelKey, value, format }]
  );
}

/** Which API answered, as a translation key so the switch stays pure. */
function readSourceLabelKey(source: MaasUsageSummary['source']): string {
  switch (source) {
    case 'zenmux-management-statistics':
      return 'workspaceRuntime.maasUsageSourceZenmux';
    case 'openrouter-key':
    case 'openrouter-key-and-credits':
      return 'workspaceRuntime.maasUsageSourceOpenRouter';
    case 'new-api-account':
      return 'workspaceRuntime.maasUsageSourceNewApiAccount';
    case 'new-api-token':
      return 'workspaceRuntime.maasUsageSourceNewApi';
    default:
      return 'workspaceRuntime.maasUsageSourceUnavailable';
  }
}
