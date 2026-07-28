import { describe, expect, it } from 'vitest';
import type { YodaMarketplaceExtension } from '@shared/extensions';
import { resolveMaasGatewayAvailability } from './maas-gateway-availability';

describe('MaaS Gateway availability', () => {
  it('requires an explicit supported installation', () => {
    expect(resolveMaasGatewayAvailability(undefined)).toBe('unavailable');
    expect(resolveMaasGatewayAvailability(extension({ supported: false }))).toBe('unsupported');
    expect(resolveMaasGatewayAvailability(extension({ installation: null }))).toBe('not-installed');
  });

  it('requires the installed extension to be enabled and running', () => {
    expect(
      resolveMaasGatewayAvailability(
        extension({
          installation: {
            extensionId: 'lovstudio.maas-gateway',
            version: '1.0.0',
            installedAt: '2026-07-28T00:00:00.000Z',
            enabled: false,
            grantedCapabilities: [],
          },
        })
      )
    ).toBe('disabled');
    expect(
      resolveMaasGatewayAvailability(
        extension({
          runtime: {
            state: 'error',
            pid: null,
            port: null,
            endpoint: null,
            configuredProviderId: null,
            error: 'fixture error',
            updatedAt: '2026-07-28T00:00:00.000Z',
          },
        })
      )
    ).toBe('unhealthy');
    expect(resolveMaasGatewayAvailability(extension())).toBe('ready');
  });
});

function extension(overrides: Partial<YodaMarketplaceExtension> = {}): YodaMarketplaceExtension {
  return {
    manifest: {
      schemaVersion: 1,
      id: 'lovstudio.maas-gateway',
      name: 'Yoda MaaS Gateway',
      version: '1.0.0',
      description: 'Fixture',
      kind: 'background-service',
      publisher: { id: 'lovstudio', name: 'LovStudio', verified: true },
      capabilities: [],
      platforms: ['darwin', 'win32', 'linux'],
    },
    installation: {
      extensionId: 'lovstudio.maas-gateway',
      version: '1.0.0',
      installedAt: '2026-07-28T00:00:00.000Z',
      enabled: true,
      grantedCapabilities: [],
    },
    runtime: {
      state: 'running',
      pid: 123,
      port: 15721,
      endpoint: 'http://127.0.0.1:15721/v1',
      configuredProviderId: null,
      error: null,
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
    supported: true,
    ...overrides,
  };
}
