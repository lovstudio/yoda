import { MAAS_GATEWAY_EXTENSION_ID, type YodaExtensionManifest } from '@shared/extensions';

export const BUILTIN_EXTENSION_CATALOG: readonly YodaExtensionManifest[] = [
  {
    schemaVersion: 1,
    id: MAAS_GATEWAY_EXTENSION_ID,
    name: 'Yoda MaaS Gateway',
    version: '1.0.0',
    description:
      'Route Codex through a local gateway and switch MaaS providers without exposing upstream API keys to Codex.',
    kind: 'background-service',
    publisher: {
      id: 'lovstudio',
      name: 'LovStudio',
      verified: true,
    },
    capabilities: [
      'network.loopback',
      'network.outbound',
      'secrets.provider',
      'client.codex.configure',
      'autostart.yoda',
    ],
    platforms: ['darwin', 'win32', 'linux'],
    service: {
      entry: 'maas-gateway',
      autoStart: true,
      healthPath: '/health',
    },
  },
];

export function getExtensionManifest(extensionId: string): YodaExtensionManifest | undefined {
  return BUILTIN_EXTENSION_CATALOG.find((manifest) => manifest.id === extensionId);
}
