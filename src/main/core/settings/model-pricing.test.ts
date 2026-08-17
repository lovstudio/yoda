import { describe, expect, it } from 'vitest';
import { getModelPricing } from './model-pricing';

describe('getModelPricing', () => {
  it('prices the current Claude and GPT families', () => {
    expect(getModelPricing('claude-opus-5')).toMatchObject({ input: 5, output: 25 });
    expect(getModelPricing('claude-sonnet-5')).toMatchObject({ input: 3, output: 15 });
    expect(getModelPricing('claude-fable-5')).toMatchObject({ input: 10, output: 50 });
    expect(getModelPricing('gpt-5.6-terra')).toMatchObject({ input: 2, output: 12 });
    expect(getModelPricing('gpt-5.6')).toMatchObject({ input: 5, output: 30 });
  });

  it('strips a provider prefix and is case-insensitive', () => {
    expect(getModelPricing('anthropic/Claude-Opus-5')).toMatchObject({ input: 5, output: 25 });
  });

  it('matches date-suffixed ids at the version boundary', () => {
    // Opus 4.0 predates the 4.5 price cut; 4.6 does not.
    expect(getModelPricing('claude-opus-4-20250514')).toMatchObject({ input: 15, output: 75 });
    expect(getModelPricing('claude-opus-4-1-20250805')).toMatchObject({ input: 15, output: 75 });
    expect(getModelPricing('claude-opus-4-6')).toMatchObject({ input: 5, output: 25 });
    expect(getModelPricing('claude-haiku-4-5-20251001')).toMatchObject({ input: 1, output: 5 });
  });

  it('reports an unknown minor version as unpriced instead of inheriting an older price', () => {
    expect(getModelPricing('gpt-5.9-nova')).toBeNull();
    expect(getModelPricing('claude-opus-6')).toBeNull();
    expect(getModelPricing('<synthetic>')).toBeNull();
    expect(getModelPricing('')).toBeNull();
  });
});
