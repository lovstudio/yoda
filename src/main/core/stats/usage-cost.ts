import type { TokenBuckets, UsageCost } from '@shared/stats';
import { getModelPricing } from '@main/core/settings/model-pricing';

/** Claude Code writes placeholder rows under this id; it is not a real model. */
const SYNTHETIC_MODEL = '<synthetic>';

/** Label for tokens whose transcript rows carried no model id at all. */
const UNKNOWN_MODEL = 'unknown';

/**
 * Price a per-model token rollup at official list rates.
 *
 * Cost is linear in the buckets, so pricing an aggregate is identical to
 * pricing every entry that fed it — with one approximation: `cacheCreation`
 * collapses 5-minute and 1-hour cache writes, and is charged at the 5-minute
 * rate (what ccusage does, and what the CLIs overwhelmingly use).
 *
 * Returns null when there is nothing to price, so a caller can tell "no data"
 * apart from "genuinely $0".
 */
export function computeUsageCost(
  byModel: readonly { model: string | null; tokens: TokenBuckets }[]
): UsageCost | null {
  let usd = 0;
  let priced = false;
  const unpriced = new Set<string>();

  for (const entry of byModel) {
    const { tokens } = entry;
    if (tokens.total <= 0) continue;
    if (entry.model === SYNTHETIC_MODEL) continue;

    const pricing = entry.model ? getModelPricing(entry.model) : null;
    if (!pricing) {
      unpriced.add(entry.model ?? UNKNOWN_MODEL);
      continue;
    }

    // `reasoning` is a subset of `output` — counting it again would double-bill.
    usd +=
      (tokens.input * pricing.input +
        tokens.output * pricing.output +
        tokens.cacheCreation * (pricing.cacheWrite5m ?? pricing.input * 1.25) +
        tokens.cacheRead * (pricing.cacheRead ?? pricing.input * 0.1)) /
      1_000_000;
    priced = true;
  }

  if (!priced && unpriced.size === 0) return null;
  return { usd, unpricedModels: [...unpriced] };
}
