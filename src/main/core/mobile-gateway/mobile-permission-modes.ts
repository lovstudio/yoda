import type { MobilePermissionModeOption } from '@shared/mobile-api';
import type { RuntimePermissionMode } from '@shared/runtime-registry';

const MOBILE_PERMISSION_MODE_LABELS: Record<string, string> = {
  default: '按客户端默认',
  plan: '仅规划',
  'accept-edits': '自动应用编辑',
  'full-auto': '全自动',
  bypass: '完全访问权限',
  custom: '自定义',
};

const MOBILE_PERMISSION_MODE_DESCRIPTIONS: Record<string, string> = {
  default: '保留客户端的常规确认流程',
  plan: '只读生成计划，不执行修改',
  'accept-edits': '自动应用文件编辑，其他操作遵循客户端规则',
  'full-auto': '自动执行常规操作，必要时再请求确认',
  bypass: '可访问互联网和电脑上的任何文件，不受沙箱限制',
  custom: '使用客户端配置文件中的权限设置',
};

export function mapMobilePermissionMode(mode: RuntimePermissionMode): MobilePermissionModeOption {
  return {
    id: mode.id,
    label: MOBILE_PERMISSION_MODE_LABELS[mode.id] ?? mode.id,
    description:
      MOBILE_PERMISSION_MODE_DESCRIPTIONS[mode.id] ??
      (mode.danger ? '执行时减少确认步骤' : '保留客户端的常规确认流程'),
    danger: mode.danger,
  };
}
