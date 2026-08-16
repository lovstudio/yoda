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
import { ContextMetric, ContextProgressBar } from './bar-chrome';
import { formatPopoverTime, formatUsagePeriod, formatUsd, getUsageTone } from './display';

/**
 * Account usage as reported by a model-access provider rather than by the CLI's
 * own subscription. What a provider can answer varies — tokens, credits, or
 * neither — so every figure is conditional and the card says which API it read.
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
  const hasTokenUsage = usage?.totalInputTokens != null || usage?.totalOutputTokens != null;
  const hasCreditUsage =
    usage?.totalCostUsd != null ||
    usage?.totalCreditsUsd != null ||
    usage?.remainingCreditsUsd != null ||
    usage?.keyLimitRemainingUsd != null;
  const usageProgressPercent =
    usage?.totalCostUsd != null && usage.totalCreditsUsd != null && usage.totalCreditsUsd > 0
      ? Math.round((usage.totalCostUsd / usage.totalCreditsUsd) * 100)
      : null;
  const sourceLabel =
    usage?.source === 'zenmux-management-statistics'
      ? t('workspaceRuntime.maasUsageSourceZenmux')
      : usage?.source === 'openrouter-key' || usage?.source === 'openrouter-key-and-credits'
        ? t('workspaceRuntime.maasUsageSourceOpenRouter')
        : usage?.source === 'new-api-account'
          ? t('workspaceRuntime.maasUsageSourceNewApiAccount')
          : usage?.source === 'new-api-token'
            ? t('workspaceRuntime.maasUsageSourceNewApi')
            : t('workspaceRuntime.maasUsageSourceUnavailable');

  return (
    <>
      <WorkspaceBarCardHeader
        icon={Gauge}
        title={t('workspaceRuntime.maasUsageTitle', { provider: providerName })}
        titleBadge={
          <span className="shrink-0 rounded-full border border-border bg-background-secondary px-2 py-0.5 text-[10px] text-foreground-muted">
            {sourceLabel}
          </span>
        }
        description={t('workspaceRuntime.maasUsageDescription', { provider: providerName })}
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
        ) : usage?.source === 'none' || (!hasTokenUsage && !hasCreditUsage) ? (
          <div className="text-xs leading-relaxed text-foreground-passive">
            {t('workspaceRuntime.maasUsageNoReadableApi', { provider: providerName })}
          </div>
        ) : (
          <div className="grid gap-3">
            {usageProgressPercent != null ? (
              <div className="grid gap-2 rounded-lg border border-border/70 bg-background-secondary/45 px-2.5 py-2">
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
                <div className="flex items-center justify-between gap-3 text-[10px] text-foreground-passive">
                  <span>{formatUsd(usage.totalCostUsd ?? 0)}</span>
                  <span>{formatUsd(usage.totalCreditsUsd ?? 0)}</span>
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              {usage.remainingCreditsUsd != null ? (
                <ContextMetric
                  label={t('workspaceRuntime.maasUsageRemainingCredits')}
                  value={formatUsd(usage.remainingCreditsUsd)}
                />
              ) : null}
              {usage.totalCreditsUsd != null ? (
                <ContextMetric
                  label={t('workspaceRuntime.maasUsageTotalCredits')}
                  value={formatUsd(usage.totalCreditsUsd)}
                />
              ) : null}
              {usage.keyLimitRemainingUsd != null ? (
                <ContextMetric
                  label={t('workspaceRuntime.maasUsageKeyRemaining')}
                  value={formatUsd(usage.keyLimitRemainingUsd)}
                />
              ) : null}
              {usage.totalCostUsd != null ? (
                <ContextMetric
                  label={t('workspaceRuntime.maasUsageTotalCost')}
                  value={formatUsd(usage.totalCostUsd)}
                />
              ) : null}
              {usage.usageDailyUsd != null ? (
                <ContextMetric
                  label={t('workspaceRuntime.maasUsageToday')}
                  value={formatUsd(usage.usageDailyUsd)}
                />
              ) : null}
              {usage.usageWeeklyUsd != null ? (
                <ContextMetric
                  label={t('workspaceRuntime.maasUsageThisWeek')}
                  value={formatUsd(usage.usageWeeklyUsd)}
                />
              ) : null}
              {usage.totalInputTokens != null ? (
                <ContextMetric
                  label={t('workspaceRuntime.maasUsageInputTokens')}
                  value={formatCompactNumber(usage.totalInputTokens)}
                />
              ) : null}
              {usage.totalOutputTokens != null ? (
                <ContextMetric
                  label={t('workspaceRuntime.maasUsageOutputTokens')}
                  value={formatCompactNumber(usage.totalOutputTokens)}
                />
              ) : null}
            </div>
            {usage.accountUsageStatus === 'credential-required' ? (
              <div className="rounded-md border border-border/70 bg-background-secondary/35 px-2.5 py-2 text-[11px] leading-relaxed text-foreground-passive">
                <div className="font-medium text-foreground-muted">
                  {t(
                    usage.quotaUnlimited
                      ? 'workspaceRuntime.maasUsageUnlimitedToken'
                      : 'workspaceRuntime.maasUsageTokenScope'
                  )}
                </div>
                <div className="mt-0.5">
                  {t('workspaceRuntime.maasUsageAccountCredentialRequired')}
                </div>
              </div>
            ) : usage.accountUsageStatus === 'error' && usage.accountUsageError ? (
              <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed">
                <div className="font-medium text-foreground-muted">
                  {t('workspaceRuntime.maasUsageAccountUnavailable')}
                </div>
                <div className="mt-0.5 break-words text-foreground-passive">
                  {usage.accountUsageError}
                </div>
                <button
                  type="button"
                  className="mt-1.5 text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => onCopyError(usage.accountUsageError)}
                >
                  {t('workspaceRuntime.maasUsageCopyError')}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </WorkspaceBarCardSection>

      <WorkspaceBarCardFooter>
        <div className="flex items-center justify-between gap-3 text-[11px] text-foreground-passive">
          <span className="min-w-0 truncate">
            {usage?.period
              ? formatUsagePeriod(usage.period.startingAt, usage.period.endingAt)
              : t('workspaceRuntime.maasUsageCurrentAccount')}
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
