export const YODA_EXTENSION_KINDS = [
  'background-service',
  'provider-adapter',
  'workflow',
  'ui',
] as const;

export type YodaExtensionKind = (typeof YODA_EXTENSION_KINDS)[number];

export const YODA_EXTENSION_CAPABILITIES = [
  'network.loopback',
  'network.outbound',
  'secrets.provider',
  'client.codex.configure',
  'autostart.yoda',
] as const;

export type YodaExtensionCapability = (typeof YODA_EXTENSION_CAPABILITIES)[number];

export const MAAS_GATEWAY_EXTENSION_ID = 'lovstudio.maas-gateway';

export type YodaExtensionPublisher = {
  id: string;
  name: string;
  verified: boolean;
};

export type YodaExtensionServiceManifest = {
  entry: string;
  autoStart: boolean;
  healthPath: string;
};

export type YodaExtensionManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  kind: YodaExtensionKind;
  publisher: YodaExtensionPublisher;
  capabilities: YodaExtensionCapability[];
  platforms: NodeJS.Platform[];
  service?: YodaExtensionServiceManifest;
};

export type YodaExtensionInstallation = {
  extensionId: string;
  version: string;
  installedAt: string;
  enabled: boolean;
  grantedCapabilities: YodaExtensionCapability[];
};

export type YodaExtensionServiceState = 'stopped' | 'starting' | 'running' | 'error';

export type YodaExtensionRuntimeStatus = {
  state: YodaExtensionServiceState;
  pid: number | null;
  port: number | null;
  endpoint: string | null;
  configuredProviderId: string | null;
  error: string | null;
  updatedAt: string;
};

export type YodaMarketplaceExtension = {
  manifest: YodaExtensionManifest;
  installation: YodaExtensionInstallation | null;
  runtime: YodaExtensionRuntimeStatus | null;
  supported: boolean;
};

export type YodaExtensionInstallInput = {
  extensionId: string;
  grantedCapabilities: YodaExtensionCapability[];
};

export type YodaExtensionMutationResult = {
  success: boolean;
  extension?: YodaMarketplaceExtension;
  error?: string;
};

export function isYodaExtensionCapability(value: unknown): value is YodaExtensionCapability {
  return (
    typeof value === 'string' && (YODA_EXTENSION_CAPABILITIES as readonly string[]).includes(value)
  );
}
