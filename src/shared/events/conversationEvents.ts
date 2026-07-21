import type { Conversation, ConversationNamingSnapshot } from '@shared/conversations';
import { defineEvent } from '@shared/ipc/events';

export const conversationRenamedChannel = defineEvent<{
  conversationId: string;
  projectId: string;
  taskId: string;
  title: string;
}>('conversation:renamed');

export const conversationNamingUpdatedChannel = defineEvent<ConversationNamingSnapshot>(
  'conversation:naming-updated'
);

export const conversationArchivedChannel = defineEvent<{
  conversationId: string;
  projectId: string;
  taskId: string;
}>('conversation:archived');

export const conversationUnarchivedChannel = defineEvent<{
  conversationId: string;
  projectId: string;
  taskId: string;
}>('conversation:unarchived');

export const conversationMovedChannel = defineEvent<{
  conversation: Conversation;
  sourceTaskId: string;
  targetTaskId: string;
}>('conversation:moved');

/**
 * The on-disk transcript (Claude session JSONL / Codex rollout) of a
 * subscribed conversation changed. Topic = conversationId; subscribers
 * refetch via `conversations.getConversationTranscript`.
 */
export const conversationTranscriptChangedChannel = defineEvent<{
  conversationId: string;
}>('conversation:transcript-changed');
