import { describe, expect, it } from 'vitest';
import { getRuntimePermissionModes } from '@shared/runtime-registry';
import { mapMobilePermissionMode } from './mobile-permission-modes';

describe('mobile permission mode labels', () => {
  it('uses user-facing labels for Codex modes instead of persisted ids', () => {
    const modes = getRuntimePermissionModes('codex').map(mapMobilePermissionMode);

    expect(modes.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'default', label: '按客户端默认' },
      { id: 'plan', label: '仅规划' },
      { id: 'full-auto', label: '全自动' },
      { id: 'bypass', label: '完全访问权限' },
      { id: 'custom', label: '自定义' },
    ]);
  });

  it('describes bypass as unrestricted access and keeps its danger marker', () => {
    expect(mapMobilePermissionMode(getRuntimePermissionModes('codex')[3])).toMatchObject({
      id: 'bypass',
      label: '完全访问权限',
      description: '可访问互联网和电脑上的任何文件，不受沙箱限制',
      danger: true,
    });
  });
});
