import type { UsageCost } from '@shared/stats';
import { formatUsd } from '@renderer/app/runtime-bar/display';

/**
 * One rendering of a {@link UsageCost} for every surface that shows money: the
 * runtime bar's session card and the usage breakdowns read the same figure, so
 * they must also read the same caveat. A partial estimate is shown as a floor
 * (`$1.20+`), and an estimate covering nothing at all is shown as absent rather
 * than as a confident zero.
 */
export function formatUsageCost(
  cost: UsageCost,
  t: (key: string, options?: Record<string, unknown>) => string
): { value: string; title: string } {
  const partial = cost.unpricedModels.length > 0;
  return {
    value:
      cost.usd > 0
        ? partial
          ? t('usage.cost.atLeast', { value: formatUsd(cost.usd) })
          : formatUsd(cost.usd)
        : '—',
    title: partial
      ? t('usage.cost.partialHint', { models: cost.unpricedModels.join(', ') })
      : t('usage.cost.hint'),
  };
}
