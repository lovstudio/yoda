import {
  MAAS_PLATFORM_IDS,
  type MaasConnection,
  type MaasPlatformId,
  type MaasPlatformTemplateId,
} from '@shared/maas';

export function getVisibleMaasPlatformIds(
  connections: readonly MaasConnection[] | undefined,
  draftPlatformIds: readonly MaasPlatformId[]
): MaasPlatformId[] {
  const visiblePlatformIds =
    connections
      ?.filter((connection) => connection.configured)
      .map((connection) => connection.platformId) ?? [];

  for (const platformId of draftPlatformIds) {
    if (!visiblePlatformIds.includes(platformId)) visiblePlatformIds.push(platformId);
  }
  return visiblePlatformIds;
}

export function getAvailableMaasPlatformIds(
  visiblePlatformIds: readonly MaasPlatformId[]
): MaasPlatformTemplateId[] {
  const visibleIds = new Set(visiblePlatformIds);
  return MAAS_PLATFORM_IDS.filter(
    (platformId) => platformId === 'custom' || !visibleIds.has(platformId)
  );
}
