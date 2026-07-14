import { describe, expect, it, vi } from 'vitest';
import { parseCodexRateLimits, parseCodexResetOutcome } from './codex-account-usage-service';

vi.mock('./runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: vi.fn(async () => ({ cli: 'codex' })) },
}));

describe('parseCodexRateLimits', () => {
  it('parses live quota windows and available reset credits', () => {
    expect(
      parseCodexRateLimits({
        rateLimits: {
          primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 21, windowDurationMins: 10_080, resetsAt: 1_800_600_000 },
        },
        rateLimitResetCredits: { availableCount: 3, credits: [] },
      })
    ).toEqual({
      rateLimits: [
        { windowMinutes: 300, usedPercent: 3, resetsAt: '2027-01-15T08:00:00.000Z' },
        { windowMinutes: 10_080, usedPercent: 21, resetsAt: '2027-01-22T06:40:00.000Z' },
      ],
      resetCreditsAvailable: 3,
    });
  });

  it('keeps unavailable reset-credit metadata distinct from zero credits', () => {
    expect(parseCodexRateLimits({ rateLimits: {} })).toEqual({
      rateLimits: [],
      resetCreditsAvailable: null,
    });
    expect(
      parseCodexRateLimits({ rateLimits: {}, rateLimitResetCredits: { availableCount: 0 } })
    ).toEqual({ rateLimits: [], resetCreditsAvailable: 0 });
  });
});

describe('parseCodexResetOutcome', () => {
  it.each(['reset', 'nothingToReset', 'noCredit', 'alreadyRedeemed'] as const)(
    'accepts the official %s outcome',
    (outcome) => {
      expect(parseCodexResetOutcome({ outcome })).toBe(outcome);
    }
  );

  it('rejects unknown outcomes instead of reporting a false success', () => {
    expect(() => parseCodexResetOutcome({ outcome: 'pending' })).toThrow(
      'Codex returned an unknown account reset outcome.'
    );
  });
});
