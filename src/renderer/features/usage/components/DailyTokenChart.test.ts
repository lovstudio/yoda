import { describe, expect, it } from 'vitest';
import { emptyTokenBuckets, type DailyTokenUsage } from '@shared/stats';
import { buildDailyTokenChartDays, niceChartCeiling } from './DailyTokenChart';

function usage(date: string, total: number): DailyTokenUsage {
  return { date, tokens: { ...emptyTokenBuckets(), total } };
}

describe('buildDailyTokenChartDays', () => {
  it('fills every local calendar day in the selected range', () => {
    const days = buildDailyTokenChartDays(
      [usage('2026-06-28', 120), usage('2026-06-30', 450)],
      new Date(2026, 5, 30, 23, 45),
      7
    );

    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ key: '2026-06-24', total: 0 });
    expect(days[4]).toEqual({ key: '2026-06-28', total: 120 });
    expect(days[6]).toEqual({ key: '2026-06-30', total: 450 });
  });

  it('excludes usage outside the selected range and future usage', () => {
    const days = buildDailyTokenChartDays(
      [usage('2026-06-23', 100), usage('2026-06-30', 200), usage('2026-07-01', 300)],
      new Date(2026, 5, 30),
      7
    );

    expect(days.reduce((sum, day) => sum + day.total, 0)).toBe(200);
  });
});

describe('niceChartCeiling', () => {
  it.each([
    [0, 1],
    [920, 1000],
    [1200, 2000],
    [4500, 5000],
    [5100, 10000],
  ])('rounds %s up to a readable axis ceiling', (value, expected) => {
    expect(niceChartCeiling(value)).toBe(expected);
  });
});
