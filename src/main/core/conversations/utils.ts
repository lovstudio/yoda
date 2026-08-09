import { type Conversation } from '@shared/conversations';
import { type RuntimeId } from '@shared/runtime-registry';
import { type ConversationRow } from '@main/db/schema';
import { type ConversationConfig } from './types';

export function mapConversationRowToConversation(
  row: ConversationRow,
  resume: boolean = false
): Conversation {
  const config: ConversationConfig | undefined = row.config ? JSON.parse(row.config) : undefined;
  return {
    id: row.id,
    title: row.title,
    taskId: row.taskId,
    projectId: row.projectId,
    runtimeId: row.runtime as RuntimeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    autoApprove: config?.autoApprove,
    agent: config?.agent,
    permissionMode: config?.permissionMode,
    runtimeOverrides: config?.runtimeOverrides,
    skillPolicy: config?.skillPolicy,
    executionMode: config?.executionMode,
    sessionSource: config?.sessionSource,
    resume: resume,
    lastInteractedAt: row.lastInteractedAt ?? null,
    isInitialConversation: row.isInitialConversation,
    forkedFromConversationId: row.forkedFromConversationId ?? undefined,
    forkedFromPromptIndex: row.forkedFromPromptIndex ?? undefined,
    pendingInitialPrompt: resume ? config?.pendingInitialPrompt : undefined,
  };
}
