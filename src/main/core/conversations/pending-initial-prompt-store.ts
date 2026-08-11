import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { PendingInitialPrompt } from '@shared/conversations';
import { db, sqlite } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { withoutPendingInitialPrompt } from './pending-initial-prompt';
import type { ConversationConfig } from './types';

export async function recordPendingInitialPromptAttempt(
  conversationId: string,
  attemptStartedAtMs: number,
  attemptContext: { projectId: string; taskId: string; stateRoot?: string; cwd?: string },
  expectedDeliveryToken?: string
): Promise<PendingInitialPrompt | undefined> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [row] = await db
      .select({ config: conversations.config })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, attemptContext.projectId),
          eq(conversations.taskId, attemptContext.taskId),
          isNull(conversations.archivedAt)
        )
      )
      .limit(1);
    if (!row?.config) return undefined;
    const config = JSON.parse(row.config) as ConversationConfig;
    if (!config.pendingInitialPrompt) return undefined;
    if (config.pendingInitialPrompt.deliveryToken !== expectedDeliveryToken) return undefined;
    const pendingInitialPrompt = {
      ...config.pendingInitialPrompt,
      attemptStartedAtMs,
      ...(attemptContext?.stateRoot ? { attemptStateRoot: attemptContext.stateRoot } : {}),
      ...(attemptContext?.cwd ? { attemptCwd: attemptContext.cwd } : {}),
    };
    const result = sqlite
      .prepare(
        `
          UPDATE conversations
          SET config = ?, updated_at = ?
          WHERE id = ? AND project_id = ? AND task_id = ?
            AND archived_at IS NULL AND config = ?
        `
      )
      .run(
        JSON.stringify({ ...config, pendingInitialPrompt }),
        new Date().toISOString(),
        conversationId,
        attemptContext.projectId,
        attemptContext.taskId,
        row.config
      );
    if (result.changes === 1) return pendingInitialPrompt;
  }
  return undefined;
}

export async function stabilizePendingInitialPromptDelivery(
  conversationId: string,
  projectId: string,
  taskId: string
): Promise<{ config: string | null; pendingInitialPrompt?: PendingInitialPrompt } | undefined> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [row] = await db
      .select({ config: conversations.config, archivedAt: conversations.archivedAt })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, projectId),
          eq(conversations.taskId, taskId)
        )
      )
      .limit(1);
    if (!row || row.archivedAt) return undefined;
    if (!row.config) return { config: row.config };
    const config = JSON.parse(row.config) as ConversationConfig;
    const pending = config.pendingInitialPrompt;
    if (!pending) return { config: row.config };
    if (pending.attemptStartedAtMs !== undefined) {
      return { config: row.config, pendingInitialPrompt: pending };
    }

    const pendingInitialPrompt = { ...pending, deliveryToken: randomUUID() };
    const nextConfig = JSON.stringify({ ...config, pendingInitialPrompt });
    const result = sqlite
      .prepare(
        `
          UPDATE conversations
          SET config = ?, updated_at = ?
          WHERE id = ? AND project_id = ? AND task_id = ?
            AND archived_at IS NULL AND config IS ?
        `
      )
      .run(nextConfig, new Date().toISOString(), conversationId, projectId, taskId, row.config);
    if (result.changes === 1) return { config: nextConfig, pendingInitialPrompt };
  }
  return undefined;
}

export async function clearPendingInitialPrompt(
  conversationId: string,
  expected: { projectId: string; taskId: string; deliveryToken?: string }
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [row] = await db
      .select({ config: conversations.config })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, expected.projectId),
          eq(conversations.taskId, expected.taskId),
          isNull(conversations.archivedAt)
        )
      )
      .limit(1);
    if (!row) return false;
    const parsed = row.config ? (JSON.parse(row.config) as ConversationConfig) : {};
    if (!parsed.pendingInitialPrompt) return true;
    if (parsed.pendingInitialPrompt.deliveryToken !== expected.deliveryToken) return false;
    const config = withoutPendingInitialPrompt(row.config);
    if (config === row.config) return true;
    const result = sqlite
      .prepare(
        `
          UPDATE conversations
          SET config = ?, updated_at = ?
          WHERE id = ? AND project_id = ? AND task_id = ?
            AND archived_at IS NULL AND config IS ?
        `
      )
      .run(
        config,
        new Date().toISOString(),
        conversationId,
        expected.projectId,
        expected.taskId,
        row.config
      );
    if (result.changes === 1) return true;
  }
  return false;
}
