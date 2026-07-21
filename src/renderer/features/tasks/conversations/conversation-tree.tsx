import { ArchiveRestore, ChevronRight, GitFork, MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@shared/conversations';
import type { ConversationUsageSummary } from '@shared/stats';
import { buildConversationSections } from '@renderer/app/app-tab-context-menu';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { ChipContextMenu } from '@renderer/lib/components/chip-context-menu';
import { TreeGuideSlot } from '@renderer/lib/components/tree-guide-slot';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ContextMenuItem } from '@renderer/lib/ui/context-menu';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from '../components/agent-status-indicator';
import { usePersistedDisclosure } from '../components/persisted-disclosure';
import { SessionUsageChip } from '../components/session-usage-chip';
import { useProvisionedTask, useTaskViewContext } from '../task-view-context';
import { ConversationDragHandle } from './conversation-drag-handle';
import type { ConversationStore } from './conversation-manager';
import { formatConversationTitleForDisplay } from './conversation-title-utils';
import { buildConversationTree, type ConversationTreeNode } from './conversation-tree-model';
import { reopenArchivedConversation } from './use-archived-conversations';

const MAX_VISUAL_DEPTH = 6;

export const ConversationTree = observer(function ConversationTree({
  activeConversations,
  archivedConversations,
  activeConversationId,
  usageByConversation,
  onOpenActive,
  onArchivedRestored,
}: {
  activeConversations: readonly ConversationStore[];
  archivedConversations: readonly Conversation[];
  activeConversationId?: string | null;
  usageByConversation?: ReadonlyMap<string, ConversationUsageSummary>;
  onOpenActive: (conversationId: string) => void;
  onArchivedRestored?: (conversationId: string) => void;
}) {
  const activeById = new Map(
    activeConversations.map((conversation) => [conversation.data.id, conversation])
  );
  const allConversations = [
    ...activeConversations.map((conversation) => conversation.data),
    ...archivedConversations,
  ];
  const roots = buildConversationTree(allConversations, activeConversationId);

  return (
    <div className="@container min-w-0 rounded-xl border border-border/60 bg-background p-1">
      <ConversationTreeBranch
        nodes={roots}
        activeById={activeById}
        activeConversationId={activeConversationId}
        usageByConversation={usageByConversation}
        onOpenActive={onOpenActive}
        onArchivedRestored={onArchivedRestored}
        depth={0}
        ancestorTrail={[]}
      />
    </div>
  );
});

const ConversationTreeBranch = observer(function ConversationTreeBranch({
  nodes,
  activeById,
  activeConversationId,
  usageByConversation,
  onOpenActive,
  onArchivedRestored,
  depth,
  ancestorTrail,
}: {
  nodes: readonly ConversationTreeNode[];
  activeById: ReadonlyMap<string, ConversationStore>;
  activeConversationId?: string | null;
  usageByConversation?: ReadonlyMap<string, ConversationUsageSummary>;
  onOpenActive: (conversationId: string) => void;
  onArchivedRestored?: (conversationId: string) => void;
  depth: number;
  ancestorTrail: readonly boolean[];
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {nodes.map((node, index) => {
        const hasNextSibling = index < nodes.length - 1;
        const guideTrail = depth === 0 ? [] : [...ancestorTrail, hasNextSibling];
        return (
          <ConversationTreeItem
            key={node.conversation.id}
            node={node}
            activeStore={activeById.get(node.conversation.id)}
            activeById={activeById}
            activeConversationId={activeConversationId}
            usage={usageByConversation?.get(node.conversation.id)}
            usageByConversation={usageByConversation}
            onOpenActive={onOpenActive}
            onArchivedRestored={onArchivedRestored}
            depth={depth}
            guideTrail={guideTrail}
          />
        );
      })}
    </ul>
  );
});

const ConversationTreeItem = observer(function ConversationTreeItem({
  node,
  activeStore,
  activeById,
  activeConversationId,
  usage,
  usageByConversation,
  onOpenActive,
  onArchivedRestored,
  depth,
  guideTrail,
}: {
  node: ConversationTreeNode;
  activeStore?: ConversationStore;
  activeById: ReadonlyMap<string, ConversationStore>;
  activeConversationId?: string | null;
  usage?: ConversationUsageSummary;
  usageByConversation?: ReadonlyMap<string, ConversationUsageSummary>;
  onOpenActive: (conversationId: string) => void;
  onArchivedRestored?: (conversationId: string) => void;
  depth: number;
  guideTrail: readonly boolean[];
}) {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const showTranscript = useShowModal('archivedSessionTranscriptModal');
  const [busy, setBusy] = useState(false);
  const { conversation } = node;
  const isArchived = activeStore === undefined;
  const isCurrent = !isArchived && activeConversationId === conversation.id;
  const hasChildren = node.children.length > 0;
  const disclosureId = `conversation-tree:${projectId}:${taskId}:${conversation.id}`;
  const [expanded, setExpanded] = usePersistedDisclosure(disclosureId, true);
  const previousActiveConversationId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const activeConversationChanged = previousActiveConversationId.current !== activeConversationId;
    previousActiveConversationId.current = activeConversationId;
    if (activeConversationChanged && hasChildren && node.isOnActivePath && !expanded) {
      setExpanded(true);
    }
  }, [activeConversationId, expanded, hasChildren, node.isOnActivePath, setExpanded]);

  const config = agentConfig[conversation.runtimeId];
  const displayTitle = formatConversationTitleForDisplay(
    conversation.runtimeId,
    conversation.title
  );
  const visibleTrail = guideTrail.slice(-MAX_VISUAL_DEPTH);
  const activeSections = buildConversationSections(
    isArchived ? undefined : provisioned,
    projectId,
    taskId,
    conversation.id,
    t
  );

  const handleRestore = async () => {
    if (!isArchived || busy) return;
    setBusy(true);
    try {
      await reopenArchivedConversation(conversation);
      onArchivedRestored?.(conversation.id);
    } catch (error) {
      log.warn('ConversationTree: failed to restore archived conversation', {
        conversationId: conversation.id,
        error,
      });
    } finally {
      setBusy(false);
    }
  };

  const sections = isArchived
    ? [
        [
          <ContextMenuItem key="restore" disabled={busy} onClick={() => void handleRestore()}>
            <ArchiveRestore className="size-4" />
            {t('tasks.archivedSession.restore')}
          </ContextMenuItem>,
        ],
        ...activeSections,
      ]
    : activeSections;

  return (
    <li className="min-w-0">
      <ChipContextMenu sections={sections}>
        <div className="flex min-w-0 items-stretch" data-conversation-tree-item>
          {visibleTrail.length > 0 ? (
            <span className="flex shrink-0 self-stretch">
              {visibleTrail.map((continues, index) => (
                <TreeGuideSlot
                  key={`${depth}-${index}`}
                  continues={continues}
                  isElbow={index === visibleTrail.length - 1}
                  highlighted={node.isOnActivePath}
                />
              ))}
            </span>
          ) : null}

          <div
            className={cn(
              'group/row flex min-h-10 min-w-0 flex-1 items-stretch overflow-hidden rounded-lg text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
              isCurrent &&
                'bg-background-2 text-foreground ring-1 ring-inset ring-border/70 shadow-sm',
              node.isOnActivePath && !isCurrent && 'text-foreground',
              isArchived && 'text-foreground-passive',
              busy && 'opacity-60'
            )}
            data-conversation-tree-row
          >
            {hasChildren ? (
              <button
                type="button"
                className="flex w-7 shrink-0 items-center justify-center rounded text-foreground-tertiary outline-none hover:bg-background-2 hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={t(
                  expanded
                    ? 'tasks.conversationTree.collapseBranches'
                    : 'tasks.conversationTree.expandBranches',
                  { title: displayTitle }
                )}
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                <ChevronRight
                  className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
                />
              </button>
            ) : (
              <span className="w-7 shrink-0" aria-hidden />
            )}

            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              aria-current={isCurrent ? 'page' : undefined}
              title={isArchived ? t('tasks.archivedSession.viewTranscript') : displayTitle}
              onClick={() =>
                isArchived ? showTranscript({ conversation }) : onOpenActive(conversation.id)
              }
            >
              <span className={cn('shrink-0', isArchived && 'opacity-60')}>
                {config ? (
                  <AgentLogo
                    logo={config.logo}
                    alt={config.alt}
                    isSvg={config.isSvg}
                    invertInDark={config.invertInDark}
                    className="size-4"
                  />
                ) : (
                  <MessageSquare className="size-4 text-foreground-passive" />
                )}
              </span>
              <span
                className={cn('min-w-0 flex-1 truncate text-sm', isArchived && 'line-through')}
                title={displayTitle}
              >
                {displayTitle}
              </span>
              {conversation.forkedFromPromptIndex !== undefined ? (
                <span className="hidden shrink-0 items-center gap-1 rounded bg-background-2 px-1.5 py-0.5 font-mono text-[10px] text-foreground-passive @xl:inline-flex">
                  <GitFork className="size-3" />
                  {t('tasks.conversationTree.forkedFromPrompt', {
                    index: conversation.forkedFromPromptIndex + 1,
                  })}
                </span>
              ) : null}
              {usage ? <SessionUsageChip usage={usage} /> : null}
              <span className="flex shrink-0 items-center text-xs text-foreground-passive">
                {activeStore?.indicatorStatus ? (
                  <AgentStatusIndicator status={activeStore.indicatorStatus} disableTooltip />
                ) : (
                  <RelativeTime
                    value={
                      (isArchived ? conversation.archivedAt : conversation.lastInteractedAt) ?? ''
                    }
                    className="font-mono"
                    compact
                  />
                )}
              </span>
            </button>

            {isArchived ? (
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                title={t('tasks.archivedSession.restore')}
                aria-label={t('tasks.archivedSession.restore')}
                className="mr-1 self-center opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                onClick={() => void handleRestore()}
              >
                <ArchiveRestore className="size-3.5" />
              </Button>
            ) : null}
            {!isArchived ? (
              <ConversationDragHandle
                projectId={projectId}
                taskId={taskId}
                conversationId={conversation.id}
                className="my-auto mr-1 opacity-0 transition-opacity group-hover/row:opacity-100 focus:opacity-100"
              />
            ) : null}
          </div>
        </div>
      </ChipContextMenu>

      {hasChildren && expanded ? (
        <ConversationTreeBranch
          nodes={node.children}
          activeById={activeById}
          activeConversationId={activeConversationId}
          usageByConversation={usageByConversation}
          onOpenActive={onOpenActive}
          onArchivedRestored={onArchivedRestored}
          depth={depth + 1}
          ancestorTrail={depth === 0 ? [] : guideTrail}
        />
      ) : null}
    </li>
  );
});
