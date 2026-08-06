import { describe, expect, it } from 'vitest';
import type { MaasConnection } from '@shared/maas';
import { getVisibleMaasPlatformIds } from './maas-platform-list';

function connection(overrides: Partial<MaasConnection>): MaasConnection {
  return {
    platformId: 'zenmux',
    displayName: 'ZenMux',
    endpoint: 'https://zenmux.ai/api/v1',
    keyFingerprint: null,
    inferenceKeyFingerprint: null,
    connectedAt: null,
    lastCheckedAt: null,
    lastTest: null,
    configured: false,
    connected: false,
    error: null,
    ...overrides,
  };
}

describe('MaaS platform list', () => {
  it('shows persisted platforms and newly added drafts instead of every built-in platform', () => {
    const connections = [
      connection({ configured: true, connected: false }),
      connection({ platformId: 'openrouter' }),
    ];

    expect(getVisibleMaasPlatformIds(connections, ['siliconflow'])).toEqual([
      'zenmux',
      'siliconflow',
    ]);
  });

  it('keeps every profile instance visible', () => {
    const connections = [
      connection({ platformId: 'custom:first', configured: true }),
      connection({ platformId: 'custom:second', configured: true }),
    ];

    expect(getVisibleMaasPlatformIds(connections, ['custom:third'])).toEqual([
      'custom:first',
      'custom:second',
      'custom:third',
    ]);
  });
});
