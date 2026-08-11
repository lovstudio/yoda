import type {
  Conversation,
  CreateConversationParams,
  PendingInitialPrompt,
} from '@shared/conversations';
import type { ConversationConfig, ConversationProvider } from './types';

export type HydratedConversationStart = {
  isResuming: boolean;
  initialPrompt?: string;
  imagePaths?: string[];
  model?: string | null;
  reasoningEffort?: string | null;
};

export function hydratedConversationStart(conversation: Conversation): HydratedConversationStart {
  const pending = conversation.pendingInitialPrompt;
  return {
    isResuming: pending === undefined,
    initialPrompt: pending?.prompt,
    imagePaths: pending?.imagePaths,
    model: pending?.model,
    reasoningEffort: pending?.reasoningEffort,
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
    reasoningEffort: params.reasoningEffort,
  };
}

/**
 * Codex creates its durable thread asynchronously after the PTY starts. Keep
 * the recovery copy until session-title discovery stores that thread binding;
 * other runtimes still acknowledge delivery when their startup call resolves.
 */
export function shouldClearPendingInitialPromptAfterStart(
  provider: Pick<ConversationProvider, 'waitsForInitialPromptSessionBinding'>,
  runtimeId: Conversation['runtimeId']
): boolean {
  return provider.waitsForInitialPromptSessionBinding?.(runtimeId) !== true;
}

export function withoutPendingInitialPrompt(configValue: string | null): string | null {
  if (!configValue) return configValue;
  const config = JSON.parse(configValue) as ConversationConfig;
  if (!config.pendingInitialPrompt) return configValue;
  const { pendingInitialPrompt: _pendingInitialPrompt, ...remaining } = config;
  const values = Object.values(remaining);
  return values.every((value) => value === undefined) ? null : JSON.stringify(remaining);
}
