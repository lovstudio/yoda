import type { MaasConnection, MaasPlatformId } from '@shared/maas';

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
