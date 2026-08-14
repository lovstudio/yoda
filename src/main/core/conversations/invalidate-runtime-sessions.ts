import { inArray } from 'drizzle-orm';
import type { AgentAccountProviderId, RuntimeId } from '@shared/runtime-registry';
import { taskManager } from '@main/core/tasks/task-manager';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { resolveTask } from '../projects/utils';

type InvalidateRuntimeSessionsInput = {
  runtimeIds: readonly RuntimeId[];
  authProviders?: readonly AgentAccountProviderId[];
  reason: string;
};

/**
 * Stops resident Agent processes whose launch-time credentials or routing are stale.
 * The persisted conversation remains intact, so opening it again resumes the same
 * provider-native thread with a freshly constructed environment.
 */
export async function invalidateRuntimeSessions(
  input: InvalidateRuntimeSessionsInput
): Promise<number> {
  const runtimeIds = new Set(input.runtimeIds);
  const active = taskManager
    .getAgentSessions()
    .filter((session) => runtimeIds.has(session.runtimeId));
  if (active.length === 0) return 0;

  const rows = await db
    .select({ id: conversations.id, authProvider: conversations.authProvider })
    .from(conversations)
    .where(
      inArray(
        conversations.id,
        active.map((session) => session.conversationId)
      )
    );
  const authProviderByConversation = new Map(
    rows.map((row) => [row.id, row.authProvider] as const)
  );
  const allowedAuthProviders = input.authProviders
    ? new Set<AgentAccountProviderId>(input.authProviders)
    : null;

  let invalidated = 0;
  for (const session of active) {
    const authProvider = authProviderByConversation.get(session.conversationId) ?? null;
    if (allowedAuthProviders && (!authProvider || !allowedAuthProviders.has(authProvider))) {
      continue;
    }
    const task = resolveTask(session.projectId, session.taskId);
    if (!task) continue;
    try {
      await task.conversations.stopSession(session.conversationId);
      invalidated += 1;
    } catch (error) {
      log.warn('Failed to invalidate stale Agent session environment', {
        conversationId: session.conversationId,
        runtimeId: session.runtimeId,
        reason: input.reason,
        error: String(error),
      });
    }
  }

  if (invalidated > 0) {
    log.info('Invalidated stale Agent session environments', {
      count: invalidated,
      runtimeIds: [...runtimeIds],
      reason: input.reason,
    });
  }
  return invalidated;
}
