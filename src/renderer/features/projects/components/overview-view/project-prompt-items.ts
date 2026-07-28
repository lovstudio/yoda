import type {
  ClaudeSessionPrompt,
  Conversation,
  ProjectPromptSource,
  SessionContextRestoreTarget,
} from '@shared/conversations';

export type ProjectPromptSortOrder = 'newest' | 'oldest';

export type ProjectPromptEntry = {
  id: string;
  conversation: Conversation;
  conversationId: string;
  conversationTitle: string;
  projectId: string;
  taskId: string;
  taskName: string;
  taskArchivedAt: string | null;
  prompt: ClaudeSessionPrompt;
  /** Zero-based index in the complete provider transcript. */
  promptIndex: number;
  restoreTarget?: SessionContextRestoreTarget;
  submittedAt: string | null;
  sortTimeMs: number;
  sourceOrder: number;
};

export function buildProjectPromptEntries(
  source: ProjectPromptSource,
  prompts: readonly ClaudeSessionPrompt[],
  sourceOrder: number,
  knownConversationIds: ReadonlySet<string>
): ProjectPromptEntry[] {
  const { conversation } = source;
  const hasIndexedParent = Boolean(
    conversation.forkedFromConversationId &&
      knownConversationIds.has(conversation.forkedFromConversationId)
  );
  const firstOwnPromptIndex = hasIndexedParent
    ? Math.max(0, (conversation.forkedFromPromptIndex ?? -1) + 1)
    : 0;
  const fallbackTimeMs = resolveConversationTimeMs(source);

  return prompts.slice(firstOwnPromptIndex).map((prompt, offset) => {
    const promptIndex = firstOwnPromptIndex + offset;
    const promptTimeMs = parseTimeMs(prompt.timestamp);
    return {
      id: `${conversation.id}:${prompt.id || promptIndex}`,
      conversation,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      taskName: source.taskName,
      taskArchivedAt: source.taskArchivedAt,
      prompt,
      promptIndex,
      restoreTarget: prompt.restoreTarget,
      submittedAt: prompt.timestamp,
      // Provider timestamps are preferred. Older transcripts may omit them;
      // in that case preserve turn order around the session activity time.
      sortTimeMs: promptTimeMs ?? fallbackTimeMs - Math.max(0, prompts.length - promptIndex - 1),
      sourceOrder,
    };
  });
}

export function compareProjectPromptEntries(
  left: ProjectPromptEntry,
  right: ProjectPromptEntry,
  order: ProjectPromptSortOrder
): number {
  const direction = order === 'newest' ? -1 : 1;
  const timeDifference = left.sortTimeMs - right.sortTimeMs;
  if (timeDifference !== 0) return timeDifference * direction;

  const sourceDifference = left.sourceOrder - right.sourceOrder;
  if (sourceDifference !== 0) {
    return sourceDifference * (order === 'newest' ? 1 : -1);
  }

  const promptDifference = left.promptIndex - right.promptIndex;
  if (promptDifference !== 0) return promptDifference * direction;
  return left.id.localeCompare(right.id) * direction;
}

/**
 * Binary-inserts a newly scanned transcript into the already rendered list.
 * This keeps the newest-first surface stable even when concurrent scans finish
 * out of order.
 */
export function insertProjectPromptEntries(
  current: readonly ProjectPromptEntry[],
  incoming: readonly ProjectPromptEntry[],
  order: ProjectPromptSortOrder = 'newest'
): ProjectPromptEntry[] {
  const next = [...current];
  const knownIds = new Set(current.map((entry) => entry.id));

  for (const entry of incoming) {
    if (knownIds.has(entry.id)) continue;
    knownIds.add(entry.id);

    let low = 0;
    let high = next.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (compareProjectPromptEntries(next[middle]!, entry, order) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    next.splice(low, 0, entry);
  }

  return next;
}

function resolveConversationTimeMs(source: ProjectPromptSource): number {
  const { conversation } = source;
  return (
    parseTimeMs(conversation.lastInteractedAt) ??
    parseTimeMs(conversation.updatedAt) ??
    parseTimeMs(conversation.createdAt) ??
    0
  );
}

function parseTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
