import { MAAS_PLATFORM_IDS, type MaasConnection, type MaasPlatformId } from '@shared/maas';

export function getVisibleMaasPlatformIds(
  connections: readonly MaasConnection[] | undefined,
  draftPlatformIds: readonly MaasPlatformId[]
): MaasPlatformId[] {
  const configuredPlatformIds = new Set(
    connections
      ?.filter((connection) => connection.configured)
      .map((connection) => connection.platformId)
  );
  const draftIds = new Set(draftPlatformIds);

  return MAAS_PLATFORM_IDS.filter(
    (platformId) => configuredPlatformIds.has(platformId) || draftIds.has(platformId)
  );
}

export function getAvailableMaasPlatformIds(
  visiblePlatformIds: readonly MaasPlatformId[]
): MaasPlatformId[] {
  const visibleIds = new Set(visiblePlatformIds);
  return MAAS_PLATFORM_IDS.filter((platformId) => !visibleIds.has(platformId));
}
