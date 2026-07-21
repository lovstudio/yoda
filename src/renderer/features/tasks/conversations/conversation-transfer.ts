import type { TabDragPayload } from '@renderer/app/tab-drag';

export type ConversationTransfer = {
  projectId: string;
  sourceTaskId: string;
  conversationId: string;
};

export function conversationTransferFromPayload(
  payload: TabDragPayload
): ConversationTransfer | null {
  if (payload.kind === 'conversation-transfer') return payload;
  if (payload.kind !== 'task-entity' || payload.target.kind !== 'conversation') return null;
  return {
    projectId: payload.projectId,
    sourceTaskId: payload.taskId,
    conversationId: payload.target.conversationId,
  };
}

export function canMoveConversationToTask(
  payload: TabDragPayload,
  targetProjectId: string,
  targetTaskId: string
): boolean {
  const transfer = conversationTransferFromPayload(payload);
  return Boolean(
    transfer && transfer.projectId === targetProjectId && transfer.sourceTaskId !== targetTaskId
  );
}
