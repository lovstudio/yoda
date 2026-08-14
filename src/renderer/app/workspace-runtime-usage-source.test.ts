import { describe, expect, it } from 'vitest';
import type { MaasGlobalBindingStatus } from '@shared/maas';
import {
  isMaasUsageActiveForRuntime,
  shouldReadOfficialAccountUsage,
} from './workspace-runtime-usage-source';

describe('workspace runtime usage source', () => {
  const activeBinding: MaasGlobalBindingStatus = {
    platformId: 'zenmux',
    enabled: true,
    effective: true,
    runtimeIds: ['codex', 'claude'],
  };

  it('uses provider usage when the current runtime is routed through global MaaS', () => {
    const maasActive = isMaasUsageActiveForRuntime('codex', activeBinding);

    expect(maasActive).toBe(true);
    expect(shouldReadOfficialAccountUsage('codex', undefined, maasActive)).toBe(false);
  });

  it('restores Codex official usage when global MaaS is disabled', () => {
    const maasActive = isMaasUsageActiveForRuntime('codex', {
      ...activeBinding,
      enabled: false,
      effective: false,
    });

    expect(maasActive).toBe(false);
    expect(shouldReadOfficialAccountUsage('codex', undefined, maasActive)).toBe(true);
  });

  it('does not treat an ineffective or unrelated MaaS binding as the active route', () => {
    expect(
      isMaasUsageActiveForRuntime('codex', {
        ...activeBinding,
        effective: false,
      })
    ).toBe(false);
    expect(
      isMaasUsageActiveForRuntime('opencode', {
        ...activeBinding,
        runtimeIds: ['codex'],
      })
    ).toBe(false);
  });
});
