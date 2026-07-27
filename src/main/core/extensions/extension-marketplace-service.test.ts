import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAAS_GATEWAY_EXTENSION_ID,
  type YodaExtensionInstallation,
  type YodaExtensionRuntimeStatus,
} from '@shared/extensions';
import type { BackgroundServiceRuntime } from './background-service-runtime';
import { ExtensionMarketplaceService } from './extension-marketplace-service';
import type { ExtensionStateStore } from './extension-state-store';

vi.mock('@main/db/kv', () => ({
  KV: class {
    async get() {
      return undefined;
    }

    async setStrict() {
      return undefined;
    }
  },
}));

class MemoryStateStore implements ExtensionStateStore {
  installations: Record<string, YodaExtensionInstallation> = {};

  async list(): Promise<Record<string, YodaExtensionInstallation>> {
    return structuredClone(this.installations);
  }

  async save(installations: Record<string, YodaExtensionInstallation>): Promise<void> {
    this.installations = structuredClone(installations);
  }
}

class FakeBackgroundServiceRuntime implements BackgroundServiceRuntime {
  readonly start = vi.fn(async () => {
    this.status = { ...this.status, state: 'running' as const };
    return this.getStatus();
  });

  readonly stop = vi.fn(async () => {
    this.status = { ...this.status, state: 'stopped' as const };
  });

  private status: YodaExtensionRuntimeStatus = {
    state: 'stopped',
    pid: null,
    port: null,
    endpoint: null,
    configuredProviderId: null,
    error: null,
    updatedAt: '2026-07-27T00:00:00.000Z',
  };

  getStatus(): YodaExtensionRuntimeStatus {
    return structuredClone(this.status);
  }
}

describe('Extension Marketplace service', () => {
  let stateStore: MemoryStateStore;
  let runtime: FakeBackgroundServiceRuntime;
  let service: ExtensionMarketplaceService;

  beforeEach(() => {
    stateStore = new MemoryStateStore();
    runtime = new FakeBackgroundServiceRuntime();
    service = new ExtensionMarketplaceService(
      stateStore,
      new Map([[MAAS_GATEWAY_EXTENSION_ID, runtime]]),
      'darwin'
    );
  });

  it('publishes Yoda MaaS Gateway in the built-in Marketplace catalog', async () => {
    const marketplace = await service.listMarketplace();

    expect(marketplace).toEqual([
      expect.objectContaining({
        manifest: expect.objectContaining({
          id: MAAS_GATEWAY_EXTENSION_ID,
          name: 'Yoda MaaS Gateway',
          kind: 'background-service',
        }),
        installation: null,
        supported: true,
      }),
    ]);
  });

  it('installs an extension only with its complete declared capability set', async () => {
    const [listing] = await service.listMarketplace();
    if (!listing) throw new Error('Expected the built-in Gateway listing.');

    await expect(
      service.install({
        extensionId: listing.manifest.id,
        grantedCapabilities: listing.manifest.capabilities.slice(1),
      })
    ).rejects.toThrow('do not match');

    const installed = await service.install({
      extensionId: listing.manifest.id,
      grantedCapabilities: listing.manifest.capabilities,
    });

    expect(installed.installation).toMatchObject({
      extensionId: MAAS_GATEWAY_EXTENSION_ID,
      enabled: true,
      grantedCapabilities: listing.manifest.capabilities,
    });
    expect(installed.runtime?.state).toBe('running');
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(stateStore.installations[MAAS_GATEWAY_EXTENSION_ID]).toBeDefined();
  });

  it('restores enabled background services on Yoda startup', async () => {
    const [listing] = await service.listMarketplace();
    if (!listing) throw new Error('Expected the built-in Gateway listing.');
    runtime.start.mockClear();
    service = new ExtensionMarketplaceService(
      stateStore,
      new Map([[MAAS_GATEWAY_EXTENSION_ID, runtime]]),
      'darwin'
    );
    stateStore.installations[MAAS_GATEWAY_EXTENSION_ID] = {
      extensionId: MAAS_GATEWAY_EXTENSION_ID,
      version: '1.0.0',
      installedAt: '2026-07-27T00:00:00.000Z',
      enabled: true,
      grantedCapabilities: listing.manifest.capabilities,
    };

    await service.initialize();

    expect(runtime.start).toHaveBeenCalledOnce();
  });

  it('stops disabled or uninstalled services and persists their lifecycle', async () => {
    const [listing] = await service.listMarketplace();
    if (!listing) throw new Error('Expected the built-in Gateway listing.');
    await service.install({
      extensionId: listing.manifest.id,
      grantedCapabilities: listing.manifest.capabilities,
    });

    const disabled = await service.setEnabled(MAAS_GATEWAY_EXTENSION_ID, false);
    expect(disabled.installation?.enabled).toBe(false);
    expect(runtime.stop).toHaveBeenCalledOnce();

    await service.uninstall(MAAS_GATEWAY_EXTENSION_ID);
    expect(runtime.stop).toHaveBeenCalledTimes(2);
    expect(stateStore.installations[MAAS_GATEWAY_EXTENSION_ID]).toBeUndefined();
  });
});
