import type { SessionSummary, SessionSummaryScope } from '@shared/conversations';
import { KV } from '@main/db/kv';

/**
 * One persisted summary entry. `fingerprint` captures the prompts the summary
 * was generated from, so we can skip re-spawning the CLI when nothing relevant
 * changed (content-based throttle).
 */
export type StoredSummary = {
  summary: SessionSummary;
  fingerprint: string;
  /** Number of included transcript messages covered by this summary. */
  messageCount?: number;
};

type SessionSummaryKVSchema = Record<string, StoredSummary>;

// SQLite-backed (the shared `kv` table); survives app restarts.
const summaryKV = new KV<SessionSummaryKVSchema>('session-summary');

function key(conversationId: string, scope: SessionSummaryScope): string {
  return `${conversationId}:${scope}`;
}

export async function getStoredSummary(
  conversationId: string,
  scope: SessionSummaryScope
): Promise<StoredSummary | null> {
  return summaryKV.get(key(conversationId, scope));
}

export async function setStoredSummary(
  conversationId: string,
  scope: SessionSummaryScope,
  entry: StoredSummary
): Promise<void> {
  await summaryKV.set(key(conversationId, scope), entry);
}

// Manual override: a user-written summary. Stored under its own key so it
// never collides with generated entries and is immune to fingerprint
// invalidation — it stays until the user clears it or explicitly regenerates.

function manualKey(conversationId: string, scope: SessionSummaryScope): string {
  return `${conversationId}:${scope}:manual`;
}

export async function getManualSummary(
  conversationId: string,
  scope: SessionSummaryScope
): Promise<SessionSummary | null> {
  const entry = await summaryKV.get(manualKey(conversationId, scope));
  return entry?.summary ?? null;
}

export async function setManualSummary(
  conversationId: string,
  scope: SessionSummaryScope,
  summary: SessionSummary
): Promise<void> {
  await summaryKV.set(manualKey(conversationId, scope), { summary, fingerprint: 'manual' });
}

export async function clearManualSummary(
  conversationId: string,
  scope: SessionSummaryScope
): Promise<void> {
  await summaryKV.del(manualKey(conversationId, scope));
}
