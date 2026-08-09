import { and, eq } from 'drizzle-orm';
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
import { reconcileConversationPermission } from './reconcile-conversation-permission';
import { skillSelectionForReload } from './restart-skill-policy';
import type { ConversationConfig } from './types';
import { mapConversationRowToConversation } from './utils';

async function refreshSkillPolicy(
  conversation: Conversation,
  rawConfig: string | null,
  skillKey: string,
  taskPath: string
): Promise<Conversation> {
  const config: ConversationConfig = rawConfig ? JSON.parse(rawConfig) : {};
  const selection = skillSelectionForReload(config.skillPolicy, skillKey);
  if (!selection) return conversation;

  const skillPolicy = await skillsService.resolveSessionPolicy(
    selection,
    taskPath,
    conversation.runtimeId
  );
  config.skillPolicy = skillPolicy;
  await db
    .update(conversations)
    .set({ config: JSON.stringify(config) })
    .where(eq(conversations.id, conversation.id));
  return { ...conversation, skillPolicy };
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
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
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

  let conversation = mapConversationRowToConversation(row, true);
  if (!runtimeOverrides) {
    conversation = await reconcileConversationPermission(conversation, row.config);
  }
  if (enableSkillKey) {
    conversation = await refreshSkillPolicy(
      conversation,
      row.config,
      enableSkillKey,
      task.conversations.taskPath
    );
  }
  if (runtimeOverrides) {
    const config: ConversationConfig = row.config ? JSON.parse(row.config) : {};
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
    await db
      .update(conversations)
      .set({ config: JSON.stringify(config) })
      .where(eq(conversations.id, conversationId));
  }
  await task.conversations.stopSession(conversationId);
  await task.conversations.startSession(
    conversation,
    initialSize,
    true,
    undefined,
    tmuxOverride,
    undefined,
    runtimeOverrides
  );
}
