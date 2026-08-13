import { eq } from 'drizzle-orm';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { captureConversationUsageSnapshot } from '@main/core/stats/capture-session-usage-snapshot';
import { snapshotTaskDiffTotals } from '@main/core/stats/task-diff-snapshot';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';

/**
 * Record the effective account mode on the conversation at spawn time so
 * per-session usage stats can attribute token burn to its source. Re-written
 * on every spawn/resume — the user may switch auth modes between sessions.
 * Fire-and-forget.
 */
export function recordConversationAuthProvider(
  conversationId: string,
  providerConfig: RuntimeCustomConfig | undefined
): void {
  const authProvider = providerConfig?.authProvider ?? 'official-subscription';
  void db
    .update(conversations)
    .set({ authProvider })
    .where(eq(conversations.id, conversationId))
    .catch((e: unknown) => {
      log.warn('recordConversationAuthProvider failed', { conversationId, error: String(e) });
    });
}

/**
 * Refresh the task's diff snapshot when an agent session ends — keeps stats
 * current even if the user never moves the task through statuses.
 * Fire-and-forget.
 */
export function snapshotTaskDiffOnSessionExit(taskId: string): void {
  void snapshotTaskDiffTotals(taskId).catch((e: unknown) => {
    log.warn('snapshotTaskDiffOnSessionExit failed', { taskId, error: String(e) });
  });
}

/** Persist final transcript usage before provider retention can remove the source file. */
export function snapshotConversationUsageOnSessionExit(conversationId: string): void {
  void captureConversationUsageSnapshot(conversationId).catch((e: unknown) => {
    log.warn('snapshotConversationUsageOnSessionExit failed', {
      conversationId,
      error: String(e),
    });
  });
}
