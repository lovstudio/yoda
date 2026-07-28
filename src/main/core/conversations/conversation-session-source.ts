import type { RuntimeCustomConfig } from '@shared/app-settings';
import type { AgentSessionSource, Conversation } from '@shared/conversations';
import { resolveRuntimeStateDirectory } from './impl/runtime-env';
import type { ConversationConfig } from './types';

export function parseConversationSessionSource(
  config: string | null | undefined
): AgentSessionSource | undefined {
  if (!config) return undefined;
  try {
    return (JSON.parse(config) as ConversationConfig).sessionSource;
  } catch {
    return undefined;
  }
}

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
