import { useTranslation } from 'react-i18next';
import type { ConversationUsageSummary } from '@shared/stats';
import { accountProviderLabelKey } from '@renderer/features/agents/account-provider-label';
import { formatUsageCost } from '@renderer/features/usage/format-usage-cost';
import { Badge } from '@renderer/lib/ui/badge';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { tokenBreakdownTitle } from './task-stats-strip';

/**
 * Compact per-session burn chip for the overview session rows: token total,
 * estimated cost, and the account mode the session ran under. Renders nothing
 * when the provider has no parseable transcript.
 */
export function SessionUsageChip({ usage }: { usage: ConversationUsageSummary | undefined }) {
  const { t } = useTranslation();
  if (!usage?.tokens) return null;
  const costDisplay = usage.cost ? formatUsageCost(usage.cost, t) : null;

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {usage.authProvider && (
        <Badge variant="secondary">{t(accountProviderLabelKey(usage.authProvider))}</Badge>
      )}
      <span
        className="font-mono text-xs tabular-nums text-foreground-passive"
        title={tokenBreakdownTitle(usage.tokens, t)}
      >
        {t('tasks.overview.stats.tokens', { value: formatCompactNumber(usage.tokens.total) })}
      </span>
      {costDisplay && (
        <span
          className="font-mono text-xs tabular-nums text-foreground-passive"
          title={costDisplay.title}
        >
          {costDisplay.value}
        </span>
      )}
    </span>
  );
}
