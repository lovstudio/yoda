import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { type Conversation, type CreateConversationParams } from '@shared/conversations';
import { isDangerPermissionMode, resolveRuntimePermissionModeId } from '@shared/runtime-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { conversationEvents } from './conversation-events';
import { mapConversationRowToConversation } from './utils';

/**
 * Resolves the conversation's permission tier. An explicit `permissionMode`
 * wins; an explicit legacy `autoApprove` boolean (e.g. the reviewer path) keeps
 * the boolean flag path; otherwise we resolve the user's per-runtime selection
 * (migrating the legacy `runtimeAutoApproveDefaults` boolean). The stored
 * `autoApprove` mirrors the mode's danger tier so non-mode-aware consumers stay
 * correct.
 */
async function resolveConversationPermission(
  params: CreateConversationParams
): Promise<{ permissionMode?: string; autoApprove?: boolean }> {
  if (params.permissionMode !== undefined) {
    return {
      permissionMode: params.permissionMode,
      autoApprove: isDangerPermissionMode(params.runtime, params.permissionMode),
    };
  }
  if (params.autoApprove !== undefined) {
    return { autoApprove: params.autoApprove };
  }
  const [selections, legacyAutoApprove] = await Promise.all([
    appSettingsService.get('runtimePermissionModes'),
    appSettingsService.get('runtimeAutoApproveDefaults'),
  ]);
  const permissionMode = resolveRuntimePermissionModeId({
    selections,
    legacyAutoApprove,
    runtimeId: params.runtime,
  });
  return {
    permissionMode,
    autoApprove: isDangerPermissionMode(params.runtime, permissionMode),
  };
}

export async function createConversation(params: CreateConversationParams): Promise<Conversation> {
  const id = params.id ?? randomUUID();
  const [existingConversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.taskId, params.taskId))
    .limit(1);

  const { permissionMode, autoApprove } = await resolveConversationPermission(params);
  const config =
    autoApprove === undefined && permissionMode === undefined
      ? undefined
      : JSON.stringify({ autoApprove, permissionMode });
  const lastInteractedAt = new Date().toISOString();

  const [row] = await db
    .insert(conversations)
    .values({
      id,
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.title,
      runtime: params.runtime,
      config,
      isInitialConversation: params.isInitialConversation ?? false,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt,
    })
    .returning();

  await db.update(tasks).set({ lastInteractedAt }).where(eq(tasks.id, params.taskId));

  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const conversation = mapConversationRowToConversation(row);

  conversationEvents._emit('conversation:created', conversation);

  const sessionInitialPrompt = params.deferInitialPrompt ? undefined : params.initialPrompt;
  const sessionImagePaths = params.deferInitialPrompt ? undefined : params.imagePaths;
  await task.conversations.startSession(
    conversation,
    params.initialSize,
    false,
    sessionInitialPrompt,
    undefined,
    sessionImagePaths,
    params.model
  );
  telemetryService.capture('conversation_created', {
    runtime: params.runtime,
    is_first_in_task: existingConversation === undefined,
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: id,
  });

  return mapConversationRowToConversation(row);
}
