import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseCodexRateLimits,
  parseCodexResetOutcome,
  resetCodexAccountUsage,
} from './codex-account-usage-service';
import { requestCodexAppServer } from './codex-app-server-client';

vi.mock('./codex-app-server-client', () => ({
  requestCodexAppServer: vi.fn(),
}));

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
        rateLimitResetCredits: {
          availableCount: 3,
          credits: [
            {
              id: 'credit-expiring',
              status: 'available',
              expiresAt: 1_800_600_000,
            },
            {
              id: 'credit-permanent',
              status: 'available',
              expiresAt: null,
            },
          ],
        },
      })
    ).toEqual({
      rateLimits: [
        { windowMinutes: 300, usedPercent: 3, resetsAt: '2027-01-15T08:00:00.000Z' },
        { windowMinutes: 10_080, usedPercent: 21, resetsAt: '2027-01-22T06:40:00.000Z' },
      ],
      resetCreditsAvailable: 3,
      resetCredits: [
        {
          id: 'credit-expiring',
          status: 'available',
          expiresAt: '2027-01-22T06:40:00.000Z',
        },
        { id: 'credit-permanent', status: 'available', expiresAt: null },
      ],
    });
  });

  it('keeps unavailable reset-credit metadata distinct from zero credits', () => {
    expect(parseCodexRateLimits({ rateLimits: {} })).toEqual({
      rateLimits: [],
      resetCreditsAvailable: null,
      resetCredits: null,
    });
    expect(
      parseCodexRateLimits({ rateLimits: {}, rateLimitResetCredits: { availableCount: 0 } })
    ).toEqual({ rateLimits: [], resetCreditsAvailable: 0, resetCredits: null });
  });

  it('skips malformed detail rows without losing the authoritative count', () => {
    expect(
      parseCodexRateLimits({
        rateLimits: {},
        rateLimitResetCredits: {
          availableCount: 2,
          credits: [
            { id: '', status: 'available', expiresAt: 1_800_600_000 },
            { id: 'credit-unknown-status', status: 'expired', expiresAt: 1_800_600_000 },
          ],
        },
      })
    ).toEqual({ rateLimits: [], resetCreditsAvailable: 2, resetCredits: [] });
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

describe('resetCodexAccountUsage', () => {
  beforeEach(() => {
    vi.mocked(requestCodexAppServer).mockReset();
  });

  it('redeems the selected credit so the earliest-expiring opportunity is used first', async () => {
    vi.mocked(requestCodexAppServer).mockResolvedValue({ outcome: 'reset' });

    await expect(resetCodexAccountUsage(' credit-expiring ')).resolves.toMatchObject({
      outcome: 'reset',
      error: null,
    });
    expect(requestCodexAppServer).toHaveBeenCalledWith('account/rateLimitResetCredit/consume', {
      idempotencyKey: expect.any(String),
      creditId: 'credit-expiring',
    });
  });
});
