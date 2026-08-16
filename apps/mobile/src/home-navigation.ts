export const HOME_TABS = [
  { icon: 'checkmark-circle-outline', label: '任务', value: 'tasks' },
  { icon: 'person-circle-outline', label: '我的', value: 'profile' },
  { icon: 'settings-outline', label: '设置', value: 'settings' },
] as const;

export type HomeTab = (typeof HOME_TABS)[number]['value'];

export const DEFAULT_HOME_TAB: HomeTab = 'tasks';

export function homeTabTitle(tab: HomeTab): { title: string; subtitle: string } {
  switch (tab) {
    case 'tasks':
      return {
        title: '任务队列',
        subtitle: '集中查看进行中的会话与任务状态。',
      };
    case 'profile':
      return {
        title: '我的工作台',
        subtitle: '查看账号、用量、工作进度与云端服务。',
      };
    case 'settings':
      return {
        title: '设置',
        subtitle: '选择连接这台桌面的方式，并管理已保存的地址。',
      };
  }
}
