import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { type Conversation, type CreateConversationParams } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { isDangerPermissionMode, resolveRuntimePermissionModeId } from '@shared/runtime-registry';
import { normalizeSkillSelection } from '@shared/skills/selection';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { skillsService } from '@main/core/skills/SkillsService';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { conversationEvents } from './conversation-events';
import { localAgentSessionCatalog } from './local-agent-session-catalog-instance';
import { pendingInitialPromptFromParams } from './pending-initial-prompt';
import { clearPendingInitialPrompt } from './pending-initial-prompt-store';
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
  const sessionId = makePtySessionId(params.projectId, params.taskId, id);
  const registrationEpoch = params.sessionSource
    ? undefined
    : ptySessionRegistry.beginRegistration(sessionId);
  const registrationIsCurrent = () =>
    registrationEpoch === undefined ||
    ptySessionRegistry.isRegistrationCurrent(sessionId, registrationEpoch);
  try {
    const task = resolveTask(params.projectId, params.taskId);
    if (!task) throw new Error('Task not found');
    const discoveredSession = params.sessionSource
      ? await localAgentSessionCatalog.validateSource(params.sessionSource)
      : undefined;
    if (params.sessionSource && !discoveredSession) {
      throw new Error('The selected local agent session is no longer available.');
    }
    if (discoveredSession && discoveredSession.runtimeId !== params.runtime) {
      throw new Error('The selected local agent session runtime does not match the conversation.');
    }
    const sessionSource = discoveredSession
      ? {
          catalogId: discoveredSession.catalogId,
          runtimeId: discoveredSession.runtimeId,
          sessionId: discoveredSession.sessionId,
          stateRoot: discoveredSession.stateRoot,
          providerId: discoveredSession.providerId,
        }
      : undefined;
    const runtimeConfig = await runtimeOverrideSettings.getItem(params.runtime);
    if (runtimeConfig?.disabled) {
      throw new Error(`${params.runtime} is disabled in Yoda.`);
    }
    const [existingConversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.taskId, params.taskId))
      .limit(1);

    const { permissionMode, autoApprove } = await resolveConversationPermission(params);
    const skillSelection = normalizeSkillSelection(params.skillSelection);
    const skillPolicy = skillSelection
      ? await skillsService.resolveSessionPolicy(
          skillSelection,
          task.conversations.taskPath,
          params.runtime
        )
      : undefined;
    const pendingInitialPrompt = pendingInitialPromptFromParams(params);
    const config =
      autoApprove === undefined &&
      permissionMode === undefined &&
      skillPolicy === undefined &&
      params.executionMode === undefined &&
      sessionSource === undefined &&
      pendingInitialPrompt === undefined
        ? undefined
        : JSON.stringify({
            autoApprove,
            permissionMode,
            skillPolicy,
            executionMode: params.executionMode,
            sessionSource,
            pendingInitialPrompt,
          });
    const lastInteractedAt = new Date().toISOString();

    if (!registrationIsCurrent()) {
      throw new Error('Conversation creation was cancelled before persistence.');
    }
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

    if (!registrationIsCurrent()) {
      await db.delete(conversations).where(eq(conversations.id, id));
      throw new Error('Conversation creation was cancelled during persistence.');
    }
    const conversation = mapConversationRowToConversation(row);

    conversationEvents._emit('conversation:created', conversation);

    if (!sessionSource) {
      const sessionInitialPrompt = params.deferInitialPrompt ? undefined : params.initialPrompt;
      const sessionImagePaths = params.deferInitialPrompt ? undefined : params.imagePaths;
      await task.conversations.startSession(
        conversation,
        params.initialSize,
        false,
        sessionInitialPrompt,
        undefined,
        sessionImagePaths,
        { model: params.model }
      );
      if (pendingInitialPrompt) {
        await clearPendingInitialPrompt(id);
      }
    }
    telemetryService.capture('conversation_created', {
      runtime: params.runtime,
      is_first_in_task: existingConversation === undefined,
      project_id: params.projectId,
      task_id: params.taskId,
      conversation_id: id,
    });

    return mapConversationRowToConversation(row);
  } finally {
    if (registrationEpoch !== undefined) {
      ptySessionRegistry.cancelRegistration(sessionId, registrationEpoch);
    }
  }
}
