import { and, eq, isNull } from 'drizzle-orm';
import {
  mergeSessionRuntimeOverrides,
  type Conversation,
  type SessionRuntimeOverrides,
} from '@shared/conversations';
import { isDangerPermissionMode } from '@shared/runtime-registry';
import { skillsService } from '@main/core/skills/SkillsService';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { cancelConversationHydrationBarrier } from './conversation-hydration-barrier';
import { withConversationOperation } from './conversation-operation-lock';
import {
  hydratedConversationStart,
  shouldClearPendingInitialPromptAfterStart,
} from './pending-initial-prompt';
import {
  clearPendingInitialPrompt,
  stabilizePendingInitialPromptDelivery,
} from './pending-initial-prompt-store';
import { reconcileConversationPermission } from './reconcile-conversation-permission';
import { skillSelectionForReload } from './restart-skill-policy';
import type { ConversationConfig } from './types';
import { mapConversationRowToConversation } from './utils';

async function refreshSkillPolicy(
  conversation: Conversation,
  rawConfig: string | null,
  skillKey: string,
  taskPath: string
): Promise<{ conversation: Conversation; config: string | null }> {
  const config: ConversationConfig = rawConfig ? JSON.parse(rawConfig) : {};
  const selection = skillSelectionForReload(config.skillPolicy, skillKey);
  if (!selection) return { conversation, config: rawConfig };

  const skillPolicy = await skillsService.resolveSessionPolicy(
    selection,
    taskPath,
    conversation.runtimeId
  );
  config.skillPolicy = skillPolicy;
  const nextConfig = JSON.stringify(config);
  const [updated] = await db
    .update(conversations)
    .set({ config: nextConfig })
    .where(
      and(
        eq(conversations.id, conversation.id),
        eq(conversations.projectId, conversation.projectId),
        eq(conversations.taskId, conversation.taskId),
        isNull(conversations.archivedAt),
        rawConfig === null ? isNull(conversations.config) : eq(conversations.config, rawConfig)
      )
    )
    .returning({ id: conversations.id });
  if (!updated) throw new Error(`Conversation changed while refreshing skills: ${conversation.id}`);
  return { conversation: { ...conversation, skillPolicy }, config: nextConfig };
}

export async function restartConversation(
  projectId: string,
  taskId: string,
  conversationId: string,
  initialSize?: { cols: number; rows: number },
  /** Override tmux for the restarted session only; omit to keep the task default. */
  tmuxOverride?: boolean,
  /** Add a newly installed skill to an explicit session allowlist before restarting. */
  enableSkillKey?: string,
  /** Explicit model and inference overrides for this restarted runtime session. */
  runtimeOverrides?: SessionRuntimeOverrides
): Promise<void> {
  cancelConversationHydrationBarrier(projectId, taskId, conversationId);
  return withConversationOperation({ projectId, id: conversationId }, async () => {
    const [row] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, projectId),
          eq(conversations.taskId, taskId),
          isNull(conversations.archivedAt)
        )
      )
      .limit(1);

    if (!row) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const task = resolveTask(projectId, taskId);
    if (!task) {
      throw new Error(`Task not provisioned: ${taskId}`);
    }
    await task.conversations.stopSession(conversationId);

    const stabilized = await stabilizePendingInitialPromptDelivery(
      conversationId,
      projectId,
      taskId
    );
    if (!stabilized) throw new Error(`Conversation changed before restart: ${conversationId}`);
    const stableRow = { ...row, config: stabilized.config };
    let stableConfig = stabilized.config;

    let conversation = mapConversationRowToConversation(stableRow, true);
    if (!runtimeOverrides) {
      const beforeReconcile = conversation;
      conversation = await reconcileConversationPermission(conversation, stableConfig, {
        failOnConflict: true,
      });
      if (conversation !== beforeReconcile) {
        const config: ConversationConfig = stableConfig ? JSON.parse(stableConfig) : {};
        if (conversation.skillPolicy) config.skillPolicy = conversation.skillPolicy;
        config.permissionMode = conversation.permissionMode;
        config.autoApprove = conversation.autoApprove;
        stableConfig = JSON.stringify(config);
      }
    }
    if (enableSkillKey) {
      const refreshed = await refreshSkillPolicy(
        conversation,
        stableConfig,
        enableSkillKey,
        task.conversations.taskPath
      );
      conversation = refreshed.conversation;
      stableConfig = refreshed.config;
    }
    if (runtimeOverrides) {
      const config: ConversationConfig = stableConfig ? JSON.parse(stableConfig) : {};
      const mergedRuntimeOverrides = mergeSessionRuntimeOverrides(
        conversation.runtimeOverrides,
        runtimeOverrides
      );
      if (conversation.skillPolicy) config.skillPolicy = conversation.skillPolicy;
      config.runtimeOverrides = mergedRuntimeOverrides;
      if (runtimeOverrides.permissionMode !== undefined) {
        config.permissionMode = runtimeOverrides.permissionMode;
        config.autoApprove = isDangerPermissionMode(
          conversation.runtimeId,
          runtimeOverrides.permissionMode
        );
      }
      const nextConfig = JSON.stringify(config);
      const [updated] = await db
        .update(conversations)
        .set({ config: nextConfig })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.projectId, projectId),
            eq(conversations.taskId, taskId),
            isNull(conversations.archivedAt),
            stableConfig === null
              ? isNull(conversations.config)
              : eq(conversations.config, stableConfig)
          )
        )
        .returning({ id: conversations.id });
      if (!updated) throw new Error(`Conversation changed while restarting: ${conversationId}`);
      stableConfig = nextConfig;
    }

    const [ownedRow] = await db
      .select({ config: conversations.config })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, projectId),
          eq(conversations.taskId, taskId),
          isNull(conversations.archivedAt)
        )
      )
      .limit(1);
    if (!ownedRow || ownedRow.config !== stableConfig) {
      throw new Error(`Conversation ownership changed while restarting: ${conversationId}`);
    }

    const pending = conversation.pendingInitialPrompt;
    const start = hydratedConversationStart(conversation);
    const startRuntimeOverrides = pending
      ? mergeSessionRuntimeOverrides(
          { model: start.model, reasoningEffort: start.reasoningEffort },
          runtimeOverrides
        )
      : runtimeOverrides;
    await task.conversations.startSession(
      conversation,
      initialSize,
      start.isResuming,
      start.initialPrompt,
      tmuxOverride,
      start.imagePaths,
      startRuntimeOverrides
    );
    if (
      pending &&
      shouldClearPendingInitialPromptAfterStart(task.conversations, conversation.runtimeId)
    ) {
      await clearPendingInitialPrompt(conversation.id, {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        deliveryToken: pending.deliveryToken,
      });
    }
  });
}
