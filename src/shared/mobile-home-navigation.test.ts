import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_TAB, HOME_TABS, homeTabTitle } from '../../apps/mobile/src/home-navigation';

describe('mobile home navigation', () => {
  it('顶层入口为任务、我的、设置', () => {
    expect(HOME_TABS).toEqual([
      { icon: 'checkmark-circle-outline', label: '任务', value: 'tasks' },
      { icon: 'person-circle-outline', label: '我的', value: 'profile' },
      { icon: 'settings-outline', label: '设置', value: 'settings' },
    ]);
  });

  it('已连接后默认进入任务', () => {
    expect(DEFAULT_HOME_TAB).toBe('tasks');
    expect(homeTabTitle(DEFAULT_HOME_TAB).title).toBe('任务队列');
    expect(homeTabTitle('settings').title).toBe('设置');
  });
});
