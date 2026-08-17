/**
 * Bundled model pricing snapshot (USD per million tokens), following
 * ccusage's approach: prefix match against the model id, never guess a price
 * for unknown models. Sources: LiteLLM
 * model_prices_and_context_window.json (verified 2026-06-10), Anthropic's
 * published rates (verified 2026-08-17), OpenAI's published rates after the
 * 2026-07-30 cut (verified 2026-08-17).
 *
 * Deliberately not modelled: OpenAI's >272K-input long-context multiplier,
 * batch/flex/fast service tiers, and Anthropic's Sonnet 5 introductory rate
 * (expires 2026-08-31) — each would need per-request data the transcripts do
 * not carry, and each moves the estimate by a bounded factor.
 */
export type ModelPricing = {
  input: number;
  output: number;
  /** 5-minute prompt-cache write. */
  cacheWrite5m?: number;
  /** 1-hour prompt-cache write (Anthropic prices this at 2x input). */
  cacheWrite1h?: number;
  /** Cache read (Anthropic) / cached input (OpenAI). */
  cacheRead?: number;
};

// Ordered most-specific prefix first; first match wins.
const PRICING_BY_PREFIX: [string, ModelPricing][] = [
  // Anthropic — Claude 5 family
  ['claude-fable-5', { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1 }],
  [
    'claude-mythos-5',
    { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1 },
  ],
  ['claude-opus-5', { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 }],
  [
    'claude-sonnet-5',
    { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  ],
  // Anthropic — legacy Opus 4.0 / 4.1, priced before the 4.5 cut
  [
    'claude-opus-4-0',
    { input: 15, output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5 },
  ],
  [
    'claude-opus-4-20250514',
    { input: 15, output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5 },
  ],
  [
    'claude-opus-4-1',
    { input: 15, output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5 },
  ],
  // Anthropic — Opus 4.5+ repriced family (4.5 / 4.6 / 4.7 / 4.8)
  ['claude-opus-4', { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 }],
  [
    'claude-sonnet-4',
    { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  ],
  ['claude-haiku-4', { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 }],
  // OpenAI — GPT-5 family (cacheRead = cached-input price). `gpt-5.6` alone
  // is an alias for Sol, so the named tiers must be matched first.
  ['gpt-5.6-sol', { input: 5, output: 30, cacheRead: 0.5 }],
  ['gpt-5.6-terra', { input: 2, output: 12, cacheRead: 0.2 }],
  ['gpt-5.6-luna', { input: 0.2, output: 1.2, cacheRead: 0.02 }],
  ['gpt-5.6-cyber', { input: 12.5, output: 75, cacheRead: 1.25 }],
  ['gpt-5.6', { input: 5, output: 30, cacheRead: 0.5 }],
  ['gpt-5.5', { input: 5, output: 30, cacheRead: 0.5 }],
  ['gpt-5.4', { input: 2.5, output: 15, cacheRead: 0.25 }],
  ['gpt-5.3', { input: 1.75, output: 14, cacheRead: 0.175 }],
  ['gpt-5.2', { input: 1.75, output: 14, cacheRead: 0.175 }],
  ['gpt-5.1', { input: 1.25, output: 10, cacheRead: 0.125 }],
  ['gpt-5', { input: 1.25, output: 10, cacheRead: 0.125 }],
];

/**
 * Price a model id, or null when no rate is on file.
 *
 * A prefix only matches at an id boundary — it must be the whole id or be
 * followed by `-`. A bare `startsWith` would let a newer version silently
 * inherit an older one's price (`gpt-5.6-terra` reading as `gpt-5`), which is
 * worse than reporting the model as unpriced.
 */
export function getModelPricing(model: string): ModelPricing | null {
  const normalized = model.trim().toLowerCase().replace(/^.*\//, '');
  if (!normalized) return null;
  const match = PRICING_BY_PREFIX.find(
    ([prefix]) =>
      normalized === prefix || (normalized.startsWith(prefix) && normalized[prefix.length] === '-')
  );
  return match ? match[1] : null;
}
