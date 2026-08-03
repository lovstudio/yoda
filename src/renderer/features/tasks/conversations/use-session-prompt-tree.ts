import { useEffect, useState } from 'react';
import type { ClaudeSessionPrompt, Conversation } from '@shared/conversations';
import { getTaskMenuConversation } from '@renderer/features/tasks/components/task-menu-session-info';
import {
  resolveSessionPrompts,
  startVisibleSessionRefresh,
} from '@renderer/features/tasks/session-prompts';
import {
  useRequireProvisionedTask,
  useTaskViewContext,
} from '@renderer/features/tasks/task-view-context';
import { buildConversationTree, type ConversationTreeNode } from './conversation-tree-model';
import {
  buildSessionPromptTree,
  type SessionPromptHistory,
  type SessionPromptTree,
} from './session-prompt-tree-model';
import { useArchivedConversations } from './use-archived-conversations';

type PromptHistoryState = {
  lineageKey: string;
  promptsByConversationId: ReadonlyMap<string, readonly ClaudeSessionPrompt[]>;
};

/** Loads every branch once on demand, then polls only the currently open path. */
export function useSessionPromptTree(active: boolean): {
  tree: SessionPromptTree | null;
  isLoading: boolean;
  hasConversation: boolean;
  activeConversationIds: ReadonlySet<string>;
} {
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useRequireProvisionedTask();
  const currentConversation = getTaskMenuConversation(provisionedTask);
  const activeConversations = Array.from(
    provisionedTask.conversations.conversations.values(),
    (store) => store.data
  );
  const activeConversationIds = new Set(activeConversations.map((conversation) => conversation.id));
  const archivedConversations = useArchivedConversations(projectId, taskId, active);
  const lineage = selectConversationLineage(
    [...activeConversations, ...archivedConversations],
    currentConversation?.id
  );
  const lineageKey = lineage
    .map(
      (conversation) =>
        `${conversation.id}:${conversation.forkedFromConversationId ?? ''}:${conversation.forkedFromPromptIndex ?? ''}:${conversation.runtimeId}:${conversation.title}:${conversation.createdAt ?? ''}`
    )
    .join('|');
  const [state, setState] = useState<PromptHistoryState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!active || !currentConversation || !lineageKey) return;
    let cancelled = false;
    const sourceLineage = lineage;
    setIsLoading(true);

    const loadAll = async () => {
      const entries = await Promise.all(
        sourceLineage.map(async (conversation) => {
          const prompts = await resolveSessionPrompts(conversation, provisionedTask.path);
          return [conversation.id, prompts] as const;
        })
      );
      if (cancelled) return;
      setState({ lineageKey, promptsByConversationId: new Map(entries) });
      setIsLoading(false);
    };

    const refreshCurrent = async () => {
      const prompts = await resolveSessionPrompts(currentConversation, provisionedTask.path);
      if (cancelled) return;
      setState((previous) => {
        if (!previous || previous.lineageKey !== lineageKey) return previous;
        const next = new Map(previous.promptsByConversationId);
        next.set(currentConversation.id, prompts);
        return { lineageKey, promptsByConversationId: next };
      });
    };

    void loadAll();
    const stopRefresh = startVisibleSessionRefresh(refreshCurrent, { runImmediately: false });
    return () => {
      cancelled = true;
      stopRefresh();
    };
    // The primitive lineage key intentionally represents the freshly derived array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, currentConversation, lineageKey, provisionedTask]);

  const histories: SessionPromptHistory[] = lineage.map((conversation) => ({
    conversation,
    prompts:
      state?.lineageKey === lineageKey
        ? (state.promptsByConversationId.get(conversation.id) ?? [])
        : [],
  }));
  const tree =
    currentConversation && state?.lineageKey === lineageKey
      ? buildSessionPromptTree(histories, currentConversation.id)
      : null;

  return {
    tree,
    isLoading: isLoading || (active && lineage.length > 0 && state?.lineageKey !== lineageKey),
    hasConversation: Boolean(currentConversation),
    activeConversationIds,
  };
}

function selectConversationLineage(
  conversations: readonly Conversation[],
  activeConversationId?: string
): Conversation[] {
  if (!activeConversationId) return [];
  const roots = buildConversationTree(conversations, activeConversationId);
  const activeRoot = roots.find((root) => containsConversation(root, activeConversationId));
  return activeRoot ? flattenConversationTree(activeRoot) : [];
}

function containsConversation(node: ConversationTreeNode, conversationId: string): boolean {
  if (node.conversation.id === conversationId) return true;
  return node.children.some((child) => containsConversation(child, conversationId));
}

function flattenConversationTree(node: ConversationTreeNode): Conversation[] {
  return [node.conversation, ...node.children.flatMap((child) => flattenConversationTree(child))];
}
