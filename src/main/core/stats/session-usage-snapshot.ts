import type { RuntimeId } from '@shared/runtime-registry';
import { KV } from '@main/db/kv';
import type { SessionTokenUsage, UsageReaderContext } from './transcript-readers/types';
import { sessionUsageCache, type ResolvedSessionUsage } from './usage-cache';

const SNAPSHOT_VERSION = 1;
type TranscriptUsageRuntimeId = Extract<RuntimeId, 'claude' | 'codex'>;

export type SessionUsageSource = 'transcript' | 'snapshot';

export type ResolvedConversationUsage = ResolvedSessionUsage & {
  source: SessionUsageSource;
};

export type StoredSessionUsageSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  runtimeId: TranscriptUsageRuntimeId;
  transcriptKey: string;
  usage: SessionTokenUsage;
  capturedAt: string;
};

type SnapshotSchema = Record<string, StoredSessionUsageSnapshot>;

const snapshotStore = new KV<SnapshotSchema>('stats-session-usage');

/**
 * Prefer the live provider transcript, persisting its latest cumulative usage.
 * Claude Code may clean up old transcripts after its retention window, so the
 * persisted snapshot becomes the durable fallback for lifetime statistics.
 */
export async function resolveConversationUsage(
  runtimeId: string | null,
  ctx: UsageReaderContext,
  fallbackSnapshot?: StoredSessionUsageSnapshot | null
): Promise<ResolvedConversationUsage | null> {
  if (runtimeId !== 'claude' && runtimeId !== 'codex') return null;
  const live = await sessionUsageCache.getResolvedUsage(runtimeId, ctx);
  if (live?.usage) {
    await persistSessionUsageSnapshot(
      ctx.conversationId,
      runtimeId,
      live.transcriptKey,
      live.usage,
      fallbackSnapshot
    );
    return { ...live, source: 'transcript' };
  }

  const snapshot =
    fallbackSnapshot === undefined
      ? await getSessionUsageSnapshot(ctx.conversationId)
      : fallbackSnapshot;
  if (!snapshot || snapshot.runtimeId !== runtimeId) return null;
  return {
    transcriptKey: snapshot.transcriptKey,
    usage: snapshot.usage,
    source: 'snapshot',
  };
}

export async function getAllSessionUsageSnapshots(): Promise<
  Map<string, StoredSessionUsageSnapshot>
> {
  const values = await snapshotStore.getAll();
  const snapshots = new Map<string, StoredSessionUsageSnapshot>();
  for (const [conversationId, value] of Object.entries(values)) {
    if (isStoredSessionUsageSnapshot(value)) snapshots.set(conversationId, value);
  }
  return snapshots;
}

export async function getSessionUsageSnapshot(
  conversationId: string
): Promise<StoredSessionUsageSnapshot | null> {
  const value = await snapshotStore.get(conversationId);
  return isStoredSessionUsageSnapshot(value) ? value : null;
}

async function persistSessionUsageSnapshot(
  conversationId: string,
  runtimeId: TranscriptUsageRuntimeId,
  transcriptKey: string,
  usage: SessionTokenUsage,
  fallbackSnapshot?: StoredSessionUsageSnapshot | null
): Promise<void> {
  const existing =
    fallbackSnapshot === undefined
      ? await getSessionUsageSnapshot(conversationId)
      : fallbackSnapshot;
  if (
    existing?.runtimeId === runtimeId &&
    existing.transcriptKey === transcriptKey &&
    JSON.stringify(existing.usage) === JSON.stringify(usage)
  ) {
    return;
  }

  await snapshotStore.set(conversationId, {
    version: SNAPSHOT_VERSION,
    runtimeId,
    transcriptKey,
    usage,
    capturedAt: new Date().toISOString(),
  });
}

function isStoredSessionUsageSnapshot(value: unknown): value is StoredSessionUsageSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredSessionUsageSnapshot>;
  return (
    candidate.version === SNAPSHOT_VERSION &&
    (candidate.runtimeId === 'claude' || candidate.runtimeId === 'codex') &&
    typeof candidate.transcriptKey === 'string' &&
    candidate.transcriptKey.length > 0 &&
    typeof candidate.capturedAt === 'string' &&
    candidate.usage !== null &&
    typeof candidate.usage === 'object' &&
    typeof candidate.usage.total?.total === 'number' &&
    Array.isArray(candidate.usage.daily) &&
    Array.isArray(candidate.usage.byModel)
  );
}
