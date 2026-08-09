import { net } from 'electron';
import {
  MAAS_MANAGED_GATEWAY_IDS,
  MAAS_MANAGED_GATEWAY_REPOSITORIES,
  type MaasManagedGatewayId,
  type MaasManagedGatewayRepository,
  type MaasManagedGatewayStarSnapshot,
} from '@shared/maas';
import { TTLCache } from '@main/core/utils/ttl-cache';
import { log } from '@main/lib/logger';

const MANAGED_GATEWAY_STARS_CACHE_TTL_MS = 30 * 60 * 1_000;
const MANAGED_GATEWAY_STARS_TIMEOUT_MS = 10_000;

type GitHubRepositoryResponse = {
  stargazers_count?: unknown;
};

function emptySnapshot(
  platformId: MaasManagedGatewayId,
  repository: MaasManagedGatewayRepository
): MaasManagedGatewayStarSnapshot {
  return {
    platformId,
    repositoryUrl: repository.url,
    starCount: null,
    fetchedAt: null,
  };
}

export class MaasManagedGatewayStarsService {
  private readonly cache = new TTLCache<MaasManagedGatewayStarSnapshot[]>(
    MANAGED_GATEWAY_STARS_CACHE_TTL_MS
  );

  async list(forceRefresh = false): Promise<MaasManagedGatewayStarSnapshot[]> {
    if (forceRefresh) this.cache.invalidate();
    return this.cache.get(() =>
      Promise.all(
        MAAS_MANAGED_GATEWAY_IDS.map((platformId) =>
          this.fetchSnapshot(platformId, MAAS_MANAGED_GATEWAY_REPOSITORIES[platformId])
        )
      )
    );
  }

  private async fetchSnapshot(
    platformId: MaasManagedGatewayId,
    repository: MaasManagedGatewayRepository
  ): Promise<MaasManagedGatewayStarSnapshot> {
    try {
      const response = await net.fetch(`https://api.github.com/repos/${repository.repository}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Yoda',
        },
        signal: AbortSignal.timeout(MANAGED_GATEWAY_STARS_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `GitHub repository returned ${response.status} ${response.statusText || ''}`.trim()
        );
      }

      const payload = (await response.json()) as GitHubRepositoryResponse;
      const starCount = payload.stargazers_count;
      if (typeof starCount !== 'number' || !Number.isInteger(starCount) || starCount < 0) {
        throw new Error('GitHub repository response did not include a valid star count.');
      }

      return {
        platformId,
        repositoryUrl: repository.url,
        starCount,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      log.warn(`Failed to fetch GitHub stars for ${repository.repository}:`, error);
      return emptySnapshot(platformId, repository);
    }
  }
}

export const maasManagedGatewayStarsService = new MaasManagedGatewayStarsService();
