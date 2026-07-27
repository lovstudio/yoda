import type { RuntimeCustomConfig } from '@shared/app-settings';
import type { Conversation } from '@shared/conversations';
import { resolveRuntimeStateDirectory } from './impl/runtime-env';

export function getConversationAgentSessionId(conversation: Conversation): string {
  const source = conversation.sessionSource;
  return source?.runtimeId === conversation.runtimeId ? source.sessionId : conversation.id;
}

export function getConversationRuntimeStateRoot(
  conversation: Conversation,
  providerConfig: RuntimeCustomConfig | undefined
): string | undefined {
  if (conversation.runtimeId !== 'codex' && conversation.runtimeId !== 'claude') return undefined;
  const source = conversation.sessionSource;
  if (source?.runtimeId === conversation.runtimeId) return source.stateRoot;
  return resolveRuntimeStateDirectory(conversation.runtimeId, providerConfig);
}
