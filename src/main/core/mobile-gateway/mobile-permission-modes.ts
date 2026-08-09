import type { MobilePermissionModeOption } from '@shared/mobile-api';
import type { RuntimeId, RuntimePermissionMode } from '@shared/runtime-registry';

type PermissionModeCopy = {
  label: string;
  description: string;
};

const GENERIC_PERMISSION_MODE_COPY: Record<string, PermissionModeCopy> = {
  default: { label: '按客户端默认', description: '使用客户端默认权限设置' },
  plan: { label: '仅规划', description: '只读生成计划，不执行修改' },
  'accept-edits': {
    label: '自动应用编辑',
    description: '自动应用文件编辑，其他操作遵循客户端规则',
  },
  'full-auto': {
    label: '替我审批',
    description: '将符合条件的审批请求交给自动审查，同时保留工作区边界',
  },
  bypass: { label: '跳过权限', description: '使用客户端提供的最高权限模式' },
  custom: { label: '自定义（config.toml）', description: '使用 config.toml 中定义的权限' },
};

const RUNTIME_PERMISSION_MODE_COPY: Partial<Record<RuntimeId, Record<string, PermissionModeCopy>>> =
  {
    codex: {
      default: {
        label: '请求批准',
        description: '使用互联网或超出工作区边界前请求批准',
      },
      plan: { label: '计划模式', description: '严格只读，不写入文件' },
      'full-auto': {
        label: '替我审批',
        description: '将符合条件的审批请求交给自动审查，同时保留工作区边界',
      },
      bypass: {
        label: '完全访问权限',
        description: '不受沙箱限制运行，也不再请求审批',
      },
      custom: { label: '自定义（config.toml）', description: '使用 config.toml 中定义的权限' },
    },
    claude: {
      default: { label: '默认', description: '使用 Claude 客户端默认权限设置' },
      plan: { label: '计划模式', description: '只规划，不修改文件' },
      'accept-edits': {
        label: '自动接受编辑',
        description: '自动接受文件编辑，其他操作遵循客户端规则',
      },
      bypass: { label: '跳过权限（危险）', description: '使用 Claude 的跳过权限模式' },
    },
    cohub: {
      'full-access': {
        label: '完整项目访问',
        description: '允许 Cohub 在当前项目中读取、编辑文件并运行命令',
      },
      'read-only': { label: '只读', description: '允许 Cohub 分析项目，但不执行写入操作' },
    },
  };

export function mapMobilePermissionMode(
  runtimeId: RuntimeId,
  mode: RuntimePermissionMode
): MobilePermissionModeOption {
  const copy = RUNTIME_PERMISSION_MODE_COPY[runtimeId]?.[mode.id];
  const fallback = GENERIC_PERMISSION_MODE_COPY[mode.id];
  const label = copy?.label ?? fallback?.label ?? mode.id;
  return {
    id: mode.id,
    label,
    description:
      copy?.description ??
      fallback?.description ??
      (mode.danger ? '使用客户端提供的最高权限模式' : '使用客户端默认权限设置'),
    danger: mode.danger,
  };
}
