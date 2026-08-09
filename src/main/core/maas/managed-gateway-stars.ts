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
const OSS_INSIGHT_HISTORY_URL = 'https://api.ossinsight.io/v1/repos';

type GitHubRepositoryResponse = {
  stargazers_count?: unknown;
};

type OssInsightHistoryResponse = {
  data?: {
    rows?: unknown;
  };
};

type MaasManagedGatewayStarTrendPoint = {
  date: string;
  starCount: number;
};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sixMonthsAgo(date: Date): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() - 6);
  return result;
}

function parseHistoryPoints(
  payload: OssInsightHistoryResponse
): MaasManagedGatewayStarTrendPoint[] {
  if (!Array.isArray(payload.data?.rows)) {
    throw new Error('OSS Insight response did not include history rows.');
  }

  const pointsByDate = new Map<string, MaasManagedGatewayStarTrendPoint>();
  for (const row of payload.data.rows) {
    if (typeof row !== 'object' || row === null) continue;
    const date = 'date' in row && typeof row.date === 'string' ? row.date : null;
    const rawStarCount = 'stargazers' in row ? row.stargazers : null;
    if (typeof rawStarCount !== 'number' && typeof rawStarCount !== 'string') continue;
    const starCount = Number(rawStarCount);
    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isInteger(starCount) ||
      starCount < 0
    ) {
      continue;
    }
    pointsByDate.set(date, { date, starCount });
  }

  const points = [...pointsByDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date)
  );
  if (points.length === 0) {
    throw new Error('OSS Insight response did not include valid history points.');
  }
  return points;
}

function alignTrendToCurrent(
  points: MaasManagedGatewayStarTrendPoint[],
  currentStarCount: number | null
): { points: MaasManagedGatewayStarTrendPoint[]; calibratedToCurrent: boolean } {
  const lastStarCount = points.at(-1)?.starCount;
  if (currentStarCount === null || lastStarCount === undefined) {
    return { points, calibratedToCurrent: false };
  }

  const offset = currentStarCount - lastStarCount;
  return {
    points: points.map((point) => ({
      ...point,
      starCount: Math.max(0, point.starCount + offset),
    })),
    calibratedToCurrent: true,
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
    const [starCount, historyPoints] = await Promise.all([
      this.fetchCurrentStarCount(repository.repository),
      this.fetchHistory(repository.repository),
    ]);
    const fetchedAt = new Date().toISOString();
    const alignedTrend = historyPoints ? alignTrendToCurrent(historyPoints, starCount) : null;

    return {
      platformId,
      repositoryUrl: repository.url,
      starCount,
      fetchedAt: starCount === null ? null : fetchedAt,
      trend: alignedTrend
        ? {
            points: alignedTrend.points,
            source: 'ossinsight',
            calibratedToCurrent: alignedTrend.calibratedToCurrent,
            fetchedAt,
          }
        : null,
    };
  }

  private async fetchCurrentStarCount(repository: string): Promise<number | null> {
    try {
      const response = await net.fetch(`https://api.github.com/repos/${repository}`, {
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
      return starCount;
    } catch (error) {
      log.warn(`Failed to fetch current GitHub stars for ${repository}:`, error);
      return null;
    }
  }

  private async fetchHistory(
    repository: string
  ): Promise<MaasManagedGatewayStarTrendPoint[] | null> {
    try {
      const today = new Date();
      const from = formatDate(sixMonthsAgo(today));
      const to = formatDate(today);
      const response = await net.fetch(
        `${OSS_INSIGHT_HISTORY_URL}/${repository}/stargazers/history/?per=week&from=${from}&to=${to}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Yoda',
          },
          signal: AbortSignal.timeout(MANAGED_GATEWAY_STARS_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        throw new Error(
          `OSS Insight returned ${response.status} ${response.statusText || ''}`.trim()
        );
      }

      return parseHistoryPoints((await response.json()) as OssInsightHistoryResponse);
    } catch (error) {
      log.warn(`Failed to fetch GitHub star history for ${repository}:`, error);
      return null;
    }
  }
}

export const maasManagedGatewayStarsService = new MaasManagedGatewayStarsService();
