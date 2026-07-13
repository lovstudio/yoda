import { describe, expect, it } from 'vitest';
import { getQuotaWindowLabel } from './workspace-runtime-bar-format';

describe('getQuotaWindowLabel', () => {
  it.each([
    [10_080, 'workspaceRuntime.quotaWindowWeeks', 1],
    [20_160, 'workspaceRuntime.quotaWindowWeeks', 2],
    [1_440, 'workspaceRuntime.quotaWindowDays', 1],
    [300, 'workspaceRuntime.quotaWindowHours', 5],
    [90, 'workspaceRuntime.quotaWindowMinutes', 90],
  ] as const)(
    'formats %i minutes with the largest exact unit',
    (windowMinutes, translationKey, value) => {
      expect(getQuotaWindowLabel(windowMinutes)).toEqual({ translationKey, value });
    }
  );
});
