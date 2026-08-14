import { describe, expect, it } from 'vitest';
import type { MaasConnection, MaasGlobalBindingStatus } from '@shared/maas';
import { getWorkspaceMaasAccountPresentation } from './workspace-runtime-bar-maas';

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

describe('getWorkspaceMaasAccountPresentation', () => {
  it('uses the effective MaaS Profile as the current Codex account source', () => {
    expect(getWorkspaceMaasAccountPresentation(zenmuxBinding, [zenmuxConnection], 'codex')).toEqual(
      {
        platformId: 'zenmux',
        providerName: 'ZenMux Production',
        endpoint: 'https://zenmux.example/v1',
        envKey: 'ZENMUX_PRODUCTION_API_KEY',
      }
    );
  });

  it('does not replace official account state when MaaS is ineffective or excludes the Client', () => {
    expect(
      getWorkspaceMaasAccountPresentation(
        { ...zenmuxBinding, effective: false },
        [zenmuxConnection],
        'codex'
      )
    ).toBeNull();
    expect(
      getWorkspaceMaasAccountPresentation(
        { ...zenmuxBinding, runtimeIds: ['claude'] },
        [zenmuxConnection],
        'codex'
      )
    ).toBeNull();
  });
});
