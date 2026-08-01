import { describe, expect, it } from 'vitest';
import { getDistinctAgentTaskTitle, getQuotaWindowLabel } from './workspace-runtime-bar-format';

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
