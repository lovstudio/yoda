import { eq } from 'drizzle-orm';
import { isAgentAccessMode, resolveAgentPermissionMode } from '@shared/agents';
import type { Conversation } from '@shared/conversations';
import {
  getDefaultPermissionModeId,
  isDangerPermissionMode,
  resolveRuntimePermissionModeId,
} from '@shared/runtime-registry';
import { agentsConfigService } from '@main/core/agents-config/agents-config-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import type { ConversationConfig } from './types';

/**
 * Repairs sessions created with the runtime's built-in default before they are
 * started again. Explicit plan/full-access choices and session-level runtime
 * overrides stay pinned to the conversation that owns them.
 */
export async function reconcileConversationPermission(
  conversation: Conversation,
  rawConfig: string | null
): Promise<Conversation> {
  const config: ConversationConfig = rawConfig ? JSON.parse(rawConfig) : {};
  if (config.runtimeOverrides?.permissionMode !== undefined) return conversation;

  const storedMode = config.permissionMode ?? conversation.permissionMode;
  if (!storedMode || storedMode !== getDefaultPermissionModeId(conversation.runtimeId)) {
    return conversation;
  }

  const [selections, legacyAutoApprove] = await Promise.all([
    appSettingsService.get('runtimePermissionModes'),
    appSettingsService.get('runtimeAutoApproveDefaults'),
  ]);
  let permissionMode = resolveRuntimePermissionModeId({
    selections,
    legacyAutoApprove,
    runtimeId: conversation.runtimeId,
  });

  if (conversation.agent?.id) {
    const agent = await agentsConfigService.get(conversation.agent.id);
    if (agent && isAgentAccessMode(agent.accessMode) && agent.accessMode !== 'inherit') {
      permissionMode =
        resolveAgentPermissionMode(conversation.runtimeId, agent.accessMode) ?? permissionMode;
    }
  }

  const autoApprove = isDangerPermissionMode(conversation.runtimeId, permissionMode);
  if (permissionMode === storedMode && config.autoApprove === autoApprove) return conversation;

  if (conversation.skillPolicy) config.skillPolicy = conversation.skillPolicy;
  config.permissionMode = permissionMode;
  config.autoApprove = autoApprove;
  await db
    .update(conversations)
    .set({ config: JSON.stringify(config) })
    .where(eq(conversations.id, conversation.id));

  return { ...conversation, permissionMode, autoApprove };
}
