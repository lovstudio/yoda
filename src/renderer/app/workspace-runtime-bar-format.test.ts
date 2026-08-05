import { describe, expect, it } from 'vitest';
import {
  getAccountUsageThresholdAlert,
  getDistinctAgentTaskTitle,
  getNextAccountResetCredit,
  getQuotaWindowLabel,
} from './workspace-runtime-bar-format';

describe('getDistinctAgentTaskTitle', () => {
  it('removes a repeated task title from the compact session row', () => {
    expect(
      getDistinctAgentTaskTitle('快捷操作命令与 Skill 模式', '快捷操作命令与   Skill 模式')
    ).toBeNull();
    expect(getDistinctAgentTaskTitle('Build Release', ' build release ')).toBeNull();
  });

  it('preserves distinct task context', () => {
    expect(getDistinctAgentTaskTitle('修复登录状态', '桌面端授权')).toBe('桌面端授权');
  });
});

describe('getNextAccountResetCredit', () => {
  it('chooses the available credit that expires first', () => {
    expect(
      getNextAccountResetCredit([
        { id: 'permanent', status: 'available', expiresAt: null },
        { id: 'later', status: 'available', expiresAt: '2026-08-20T00:00:00.000Z' },
        { id: 'earlier', status: 'available', expiresAt: '2026-08-13T00:00:00.000Z' },
        { id: 'redeemed', status: 'redeemed', expiresAt: '2026-08-06T00:00:00.000Z' },
      ])
    ).toMatchObject({ id: 'earlier' });
  });

  it('keeps a non-expiring credit selectable when it is the only available detail', () => {
    expect(
      getNextAccountResetCredit([
        { id: 'permanent', status: 'available', expiresAt: null },
        { id: 'redeeming', status: 'redeeming', expiresAt: null },
      ])
    ).toMatchObject({ id: 'permanent' });
    expect(getNextAccountResetCredit(null)).toBeNull();
  });
});

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

describe('getAccountUsageThresholdAlert', () => {
  const windows = [
    { windowMinutes: 300, usedPercent: 95.2, resetsAt: '2026-08-04T12:00:00.000Z' },
    { windowMinutes: 10_080, usedPercent: 97.6, resetsAt: '2026-08-10T00:00:00.000Z' },
  ];

  it('returns the most depleted window and represents all windows at the threshold', () => {
    expect(getAccountUsageThresholdAlert(windows, 95, new Set())).toEqual({
      window: windows[1],
      notificationKeys: ['300:2026-08-04T12:00:00.000Z', '10080:2026-08-10T00:00:00.000Z'],
    });
  });

  it('uses the same rounded percentage shown in the runtime bar', () => {
    expect(
      getAccountUsageThresholdAlert(
        [{ windowMinutes: 300, usedPercent: 94.6, resetsAt: null }],
        95,
        new Set()
      )
    ).not.toBeNull();
  });

  it('does not repeat a notification for the same quota window', () => {
    expect(
      getAccountUsageThresholdAlert(
        windows,
        95,
        new Set(['300:2026-08-04T12:00:00.000Z', '10080:2026-08-10T00:00:00.000Z'])
      )
    ).toBeNull();
  });
});
