import type {
  Conversation,
  CreateConversationParams,
  PendingInitialPrompt,
} from '@shared/conversations';
import type { ConversationConfig } from './types';

export type HydratedConversationStart = {
  isResuming: boolean;
  initialPrompt?: string;
  imagePaths?: string[];
  model?: string | null;
};

export function hydratedConversationStart(conversation: Conversation): HydratedConversationStart {
  const pending = conversation.pendingInitialPrompt;
  return {
    isResuming: pending === undefined,
    initialPrompt: pending?.prompt,
    imagePaths: pending?.imagePaths,
    model: pending?.model,
  };
}

export function pendingInitialPromptFromParams(
  params: CreateConversationParams
): PendingInitialPrompt | undefined {
  if (params.sessionSource || params.deferInitialPrompt) return undefined;
  const prompt = params.initialPrompt?.trim() ? params.initialPrompt : undefined;
  const imagePaths = params.imagePaths?.length ? params.imagePaths : undefined;
  if (!prompt && !imagePaths) return undefined;
  return {
    prompt,
    imagePaths,
    model: params.model,
  };
}

export function withoutPendingInitialPrompt(configValue: string | null): string | null {
  if (!configValue) return configValue;
  const config = JSON.parse(configValue) as ConversationConfig;
  if (!config.pendingInitialPrompt) return configValue;
  const { pendingInitialPrompt: _pendingInitialPrompt, ...remaining } = config;
  const values = Object.values(remaining);
  return values.every((value) => value === undefined) ? null : JSON.stringify(remaining);
}
