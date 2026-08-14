import { describe, expect, it } from 'vitest';
import type { MaasConnection, MaasGlobalBindingStatus } from '@shared/maas';
import { getWorkspaceMaasPresentation } from './workspace-runtime-bar-maas';

const zenmuxBinding: MaasGlobalBindingStatus = {
  platformId: 'zenmux',
  enabled: true,
  effective: true,
  runtimeIds: ['codex'],
};

const zenmuxConnection: MaasConnection = {
  platformId: 'zenmux',
  displayName: 'ZenMux Production',
  endpoint: 'https://zenmux.example/v1',
  keyFingerprint: '12345678',
  inferenceKeyFingerprint: null,
  connectedAt: '2026-08-12T00:00:00.000Z',
  lastCheckedAt: null,
  lastTest: null,
  configured: true,
  connected: true,
  error: null,
};

describe('getWorkspaceMaasPresentation', () => {
  it('presents the enabled MaaS Profile as a global routing state', () => {
    expect(getWorkspaceMaasPresentation(zenmuxBinding, [zenmuxConnection])).toEqual({
      active: true,
      providerName: 'ZenMux Production',
    });
  });

  it('keeps disabled MaaS separate from Agent account presentation', () => {
    expect(
      getWorkspaceMaasPresentation(
        { ...zenmuxBinding, platformId: null, enabled: false, effective: false, runtimeIds: [] },
        [zenmuxConnection]
      )
    ).toEqual({ active: false, providerName: null });
  });
});
