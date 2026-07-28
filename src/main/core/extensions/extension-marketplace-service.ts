import {
  isYodaExtensionCapability,
  MAAS_GATEWAY_EXTENSION_ID,
  type YodaExtensionCapability,
  type YodaExtensionInstallation,
  type YodaExtensionInstallInput,
  type YodaMarketplaceExtension,
} from '@shared/extensions';
import { log } from '@main/lib/logger';
import type { BackgroundServiceRuntime } from './background-service-runtime';
import { BUILTIN_EXTENSION_CATALOG, getExtensionManifest } from './catalog';
import { KvExtensionStateStore, type ExtensionStateStore } from './extension-state-store';
import { maasGatewayExtensionRuntime } from './maas-gateway/runtime';

export class ExtensionMarketplaceService {
  private installations: Record<string, YodaExtensionInstallation> = {};
  private initialized = false;

  constructor(
    private readonly stateStore: ExtensionStateStore = new KvExtensionStateStore(),
    private readonly runtimes: ReadonlyMap<string, BackgroundServiceRuntime> = new Map([
      [MAAS_GATEWAY_EXTENSION_ID, maasGatewayExtensionRuntime],
    ]),
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.installations = await this.stateStore.list();
    this.initialized = true;

    await Promise.all(
      Object.values(this.installations).map(async (installation) => {
        const manifest = getExtensionManifest(installation.extensionId);
        if (
          !installation.enabled ||
          !manifest?.service?.autoStart ||
          !manifest.platforms.includes(this.platform) ||
          !capabilitiesMatch(manifest.capabilities, installation.grantedCapabilities)
        ) {
          return;
        }
        try {
          await this.runtimes.get(installation.extensionId)?.start();
        } catch (error) {
          log.error('Failed to auto-start Yoda extension', {
            extensionId: installation.extensionId,
            error: String(error),
          });
        }
      })
    );
  }

  async listMarketplace(): Promise<YodaMarketplaceExtension[]> {
    await this.initialize();
    return BUILTIN_EXTENSION_CATALOG.map((manifest) => this.toMarketplaceExtension(manifest.id));
  }

  async getExtension(extensionId: string): Promise<YodaMarketplaceExtension | null> {
    await this.initialize();
    return getExtensionManifest(extensionId) ? this.toMarketplaceExtension(extensionId) : null;
  }

  async install(input: YodaExtensionInstallInput): Promise<YodaMarketplaceExtension> {
    await this.initialize();
    const manifest = getExtensionManifest(input.extensionId);
    if (!manifest) throw new Error('Extension is not available in the Yoda Marketplace.');
    if (!manifest.platforms.includes(this.platform)) {
      throw new Error('Extension is not available on this platform.');
    }
    const grantedCapabilities = validateCapabilities(
      manifest.capabilities,
      input.grantedCapabilities
    );
    const existing = this.installations[input.extensionId];
    const installation: YodaExtensionInstallation = {
      extensionId: input.extensionId,
      version: manifest.version,
      installedAt: existing?.installedAt ?? new Date().toISOString(),
      enabled: true,
      grantedCapabilities,
    };
    const previousInstallations = this.installations;
    this.installations = { ...this.installations, [input.extensionId]: installation };
    try {
      await this.persist();
      if (manifest.service?.autoStart) {
        await this.runtimes.get(input.extensionId)?.start();
      }
    } catch (error) {
      this.installations = previousInstallations;
      await this.persist().catch(() => undefined);
      throw error;
    }
    return this.toMarketplaceExtension(input.extensionId);
  }

  async setEnabled(extensionId: string, enabled: boolean): Promise<YodaMarketplaceExtension> {
    await this.initialize();
    const existing = this.installations[extensionId];
    if (!existing) throw new Error('Extension is not installed.');
    const manifest = getExtensionManifest(extensionId);
    if (
      enabled &&
      (!manifest || !capabilitiesMatch(manifest.capabilities, existing.grantedCapabilities))
    ) {
      throw new Error('Extension permissions must be reviewed before enabling it.');
    }
    const runtime = this.runtimes.get(extensionId);
    const previousInstallations = this.installations;
    this.installations = {
      ...this.installations,
      [extensionId]: { ...existing, enabled },
    };
    try {
      if (enabled) await runtime?.start();
      else await runtime?.stop();
      await this.persist();
    } catch (error) {
      this.installations = previousInstallations;
      if (existing.enabled) await runtime?.start().catch(() => undefined);
      else await runtime?.stop().catch(() => undefined);
      throw error;
    }
    return this.toMarketplaceExtension(extensionId);
  }

  async uninstall(extensionId: string): Promise<void> {
    await this.initialize();
    const existing = this.installations[extensionId];
    if (!existing) throw new Error('Extension is not installed.');
    const runtime = this.runtimes.get(extensionId);
    await runtime?.stop();
    const previousInstallations = this.installations;
    const next = { ...this.installations };
    delete next[extensionId];
    this.installations = next;
    try {
      await this.persist();
    } catch (error) {
      this.installations = previousInstallations;
      if (existing.enabled) await runtime?.start().catch(() => undefined);
      throw error;
    }
  }

  isInstalled(extensionId: string): boolean {
    return Boolean(this.installations[extensionId]);
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.runtimes.values()].map((runtime) =>
        runtime.stop().catch((error) => {
          log.error('Failed to stop Yoda extension runtime', { error: String(error) });
        })
      )
    );
  }

  private toMarketplaceExtension(extensionId: string): YodaMarketplaceExtension {
    const manifest = getExtensionManifest(extensionId);
    if (!manifest) throw new Error(`Unknown extension: ${extensionId}`);
    return {
      manifest,
      installation: this.installations[extensionId] ?? null,
      runtime: this.runtimes.get(extensionId)?.getStatus() ?? null,
      supported: manifest.platforms.includes(this.platform),
    };
  }

  private async persist(): Promise<void> {
    await this.stateStore.save(this.installations);
  }
}

function validateCapabilities(
  requested: readonly YodaExtensionCapability[],
  granted: readonly YodaExtensionCapability[]
): YodaExtensionCapability[] {
  if (!granted.every(isYodaExtensionCapability)) {
    throw new Error('Extension requested an unknown capability.');
  }
  const uniqueGranted = [...new Set(granted)];
  const missing = requested.filter((capability) => !uniqueGranted.includes(capability));
  const extras = uniqueGranted.filter((capability) => !requested.includes(capability));
  if (missing.length > 0 || extras.length > 0) {
    throw new Error('Granted extension capabilities do not match the manifest.');
  }
  return uniqueGranted;
}

function capabilitiesMatch(
  requested: readonly YodaExtensionCapability[],
  granted: readonly YodaExtensionCapability[]
): boolean {
  return (
    requested.length === granted.length &&
    requested.every((capability) => granted.includes(capability))
  );
}

export const extensionMarketplaceService = new ExtensionMarketplaceService();
