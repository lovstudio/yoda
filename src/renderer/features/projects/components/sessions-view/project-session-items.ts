import type { Conversation, LocalAgentSession } from '@shared/conversations';

export type ProjectSessionItem =
  | { kind: 'conversation'; conversation: Conversation }
  | { kind: 'local-agent'; session: LocalAgentSession };

export function mergeProjectSessionItems(
  conversations: Conversation[],
  localSessions: LocalAgentSession[]
): ProjectSessionItem[] {
  const linkedCatalogIds = new Set(
    conversations.flatMap((conversation) =>
      conversation.sessionSource ? [conversation.sessionSource.catalogId] : []
    )
  );
  const linkedNativeIds = new Set(
    conversations.map((conversation) => `${conversation.runtimeId}\0${conversation.id}`)
  );

  return [
    ...conversations.map(
      (conversation): ProjectSessionItem => ({ kind: 'conversation', conversation })
    ),
    ...localSessions.flatMap((session): ProjectSessionItem[] =>
      linkedCatalogIds.has(session.catalogId) ||
      linkedNativeIds.has(`${session.runtimeId}\0${session.sessionId}`)
        ? []
        : [{ kind: 'local-agent', session }]
    ),
  ].sort((left, right) => getItemSortTime(right) - getItemSortTime(left));
}

function getItemSortTime(item: ProjectSessionItem): number {
  const raw =
    item.kind === 'local-agent'
      ? (item.session.updatedAt ?? item.session.createdAt ?? '')
      : (item.conversation.archivedAt ??
        item.conversation.lastInteractedAt ??
        item.conversation.updatedAt ??
        item.conversation.createdAt ??
        '');
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}
