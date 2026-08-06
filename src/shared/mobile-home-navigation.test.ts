import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_TAB, HOME_TABS, homeTabTitle } from '../../apps/mobile/src/home-navigation';

describe('mobile home navigation', () => {
  it('只保留任务与我的两个顶层入口', () => {
    expect(HOME_TABS).toEqual([
      { icon: 'checkmark-circle-outline', label: '任务', value: 'tasks' },
      { icon: 'person-circle-outline', label: '我的', value: 'profile' },
    ]);
  });

  it('已连接后默认进入任务', () => {
    expect(DEFAULT_HOME_TAB).toBe('tasks');
    expect(homeTabTitle(DEFAULT_HOME_TAB).title).toBe('任务队列');
  });
});
