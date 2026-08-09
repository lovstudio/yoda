import { describe, expect, it } from 'vitest';
import { getRuntimePermissionModes } from '@shared/runtime-registry';
import { mapMobilePermissionMode } from './mobile-permission-modes';

describe('mobile permission mode labels', () => {
  it('uses user-facing labels for Codex modes instead of persisted ids', () => {
    const modes = getRuntimePermissionModes('codex').map((mode) =>
      mapMobilePermissionMode('codex', mode)
    );

    expect(modes.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'default', label: '请求批准' },
      { id: 'plan', label: '计划模式' },
      { id: 'full-auto', label: '替我审批' },
      { id: 'bypass', label: '完全访问权限' },
      { id: 'custom', label: '自定义（config.toml）' },
    ]);
  });

  it('describes bypass as unrestricted access and keeps its danger marker', () => {
    expect(mapMobilePermissionMode('codex', getRuntimePermissionModes('codex')[3])).toMatchObject({
      id: 'bypass',
      label: '完全访问权限',
      description: '不受沙箱限制运行，也不再请求审批',
      danger: true,
    });
  });

  it('keeps Claude-specific permission language separate from Codex', () => {
    expect(mapMobilePermissionMode('claude', getRuntimePermissionModes('claude')[2])).toMatchObject(
      {
        id: 'accept-edits',
        label: '自动接受编辑',
      }
    );
  });
});
