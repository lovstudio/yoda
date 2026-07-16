import { ArchiveRestore, GitBranch, Loader2 } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@shared/conversations';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { TreeGuideSlot } from '@renderer/lib/components/tree-guide-slot';
import { cn } from '@renderer/utils/utils';
import { formatConversationTitleForDisplay } from './conversation-title-utils';
import { SessionPromptRestoreButton } from './session-prompt-restore-button';
import type {
  SessionPromptBranchEndpoint,
  SessionPromptTree,
  SessionPromptTreeNode,
} from './session-prompt-tree-model';
import type {
  ConversationPromptLocation,
  RestoringConversationPrompt,
} from './use-conversation-prompt-restore';

const MAX_VISUAL_DEPTH = 6;

type SessionPromptTreeEntry =
  | { kind: 'prompt'; node: SessionPromptTreeNode }
  | { kind: 'endpoint'; endpoint: SessionPromptBranchEndpoint };

type SessionPromptTreeRow = SessionPromptTreeEntry & {
  key: string;
  guideTrail: readonly boolean[];
  isElbow: boolean;
};

export function SessionPromptTreeView({
  tree,
  isLoading,
  activeConversationIds,
  restoringPrompt,
  maxHeight,
  onRestorePrompt,
  onOpenConversation,
}: {
  tree: NonNullable<SessionPromptTree>;
  isLoading: boolean;
  activeConversationIds: ReadonlySet<string>;
  restoringPrompt: RestoringConversationPrompt | null;
  maxHeight?: CSSProperties['maxHeight'];
  onRestorePrompt: (location: ConversationPromptLocation) => void;
  onOpenConversation: (conversation: Conversation) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [openingConversationId, setOpeningConversationId] = useState<string | null>(null);
  const visualRows = useMemo(() => flattenSessionPromptTree(tree), [tree]);
  const style = { maxHeight: maxHeight ?? 'min(60vh, 32rem)' } satisfies CSSProperties;

  const openConversation = async (conversation: Conversation) => {
    if (openingConversationId) return;
    setOpeningConversationId(conversation.id);
    try {
      await onOpenConversation(conversation);
    } finally {
      setOpeningConversationId(null);
    }
  };

  if (isLoading && visualRows.length === 0) {
    return (
      <div className="flex h-12 items-center justify-center gap-1.5 text-xs text-foreground-passive">
        <Loader2 className="size-3 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  if (visualRows.length === 0) {
    return (
      <div className="px-3 pb-2 text-xs text-foreground-passive">{t('tasks.panel.noPrompts')}</div>
    );
  }

  return (
    <div
      role="tree"
      aria-label={t('tasks.bottomPanel.sessionTreeLabel')}
      className="overflow-x-hidden overflow-y-auto py-1"
      style={style}
    >
      {visualRows.map((row) => {
        const visibleTrail = row.guideTrail.slice(-MAX_VISUAL_DEPTH);
        return row.kind === 'prompt' ? (
          <SessionPromptTreePromptRow
            key={row.key}
            node={row.node}
            visibleTrail={visibleTrail}
            ariaLevel={row.guideTrail.length + 1}
            isElbow={row.isElbow}
            restoringPrompt={restoringPrompt}
            onRestorePrompt={onRestorePrompt}
          />
        ) : (
          <SessionPromptTreeEndpointRow
            key={row.key}
            endpoint={row.endpoint}
            visibleTrail={visibleTrail}
            ariaLevel={row.guideTrail.length + 1}
            isElbow={row.isElbow}
            isArchived={!activeConversationIds.has(row.endpoint.conversation.id)}
            isOpening={openingConversationId === row.endpoint.conversation.id}
            onOpen={() => void openConversation(row.endpoint.conversation)}
          />
        );
      })}
    </div>
  );
}

function SessionPromptTreePromptRow({
  node,
  visibleTrail,
  ariaLevel,
  isElbow,
  restoringPrompt,
  onRestorePrompt,
}: {
  node: SessionPromptTreeNode;
  visibleTrail: readonly boolean[];
  ariaLevel: number;
  isElbow: boolean;
  restoringPrompt: RestoringConversationPrompt | null;
  onRestorePrompt: (location: ConversationPromptLocation) => void;
}) {
  const { t } = useTranslation();
  const displayAlias = node.preferredAlias;
  const restoreAlias = node.preferredRestoreAlias ?? undefined;
  const isCurrentNode = node.endpoints.some((endpoint) => endpoint.isActive);
  const text = displaySessionPromptText(displayAlias.prompt.text).trim();
  const timestamp = displayAlias.prompt.timestamp
    ? new Date(displayAlias.prompt.timestamp).toLocaleTimeString()
    : null;
  const isRestoring = Boolean(
    restoreAlias &&
      restoringPrompt?.conversationId === restoreAlias.conversation.id &&
      restoringPrompt.promptId === restoreAlias.prompt.id &&
      restoringPrompt.promptIndex === restoreAlias.promptIndex
  );
  const location = restoreAlias
    ? {
        conversation: restoreAlias.conversation,
        prompt: restoreAlias.prompt,
        promptIndex: restoreAlias.promptIndex,
      }
    : null;
  const content = (
    <>
      <TreeGuideTrail
        visibleTrail={visibleTrail}
        isElbow={isElbow}
        highlighted={node.isOnActivePath}
      />
      <PromptNodeMarker
        highlighted={node.isOnActivePath}
        isCurrent={isCurrentNode}
        isElbow={isElbow}
      />
      <span className="w-7 shrink-0 font-mono text-[10px] text-foreground-passive">
        #{displayAlias.promptIndex + 1}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs leading-5 text-foreground-muted',
          node.isOnActivePath && 'text-foreground'
        )}
      >
        {text}
      </span>
      {isCurrentNode ? (
        <span className="shrink-0 rounded-sm border border-foreground-tertiary/30 bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground">
          {t('tasks.bottomPanel.sessionCurrentNode')}
        </span>
      ) : null}
      {timestamp && !location ? (
        <span className="shrink-0 font-mono text-[10px] text-foreground-passive opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {timestamp}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      role="treeitem"
      aria-level={ariaLevel}
      aria-current={isCurrentNode ? 'page' : node.isOnActivePath ? 'step' : undefined}
      className={cn(
        'group flex h-8 w-full min-w-0 items-center gap-1 pr-3 transition-colors hover:bg-background-1 focus-within:bg-background-1',
        isCurrentNode && 'bg-background-2'
      )}
      title={text}
    >
      {location ? (
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
          onClick={() => onRestorePrompt(location)}
          aria-label={t('tasks.sessionInfo.restoreContextAtPrompt', {
            index: location.promptIndex + 1,
          })}
        >
          {content}
        </button>
      ) : (
        <div
          className="flex h-8 min-w-0 flex-1 items-center gap-1.5 text-left"
          title={t('tasks.bottomPanel.sessionCheckpointPending')}
        >
          {content}
        </div>
      )}
      {location ? (
        <SessionPromptRestoreButton
          prompt={location.prompt}
          index={location.promptIndex + 1}
          isRestoring={isRestoring}
          onRestore={() => onRestorePrompt(location)}
          visibleLabel={t('tasks.bottomPanel.sessionBranchFromHere')}
          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        />
      ) : null}
    </div>
  );
}

function SessionPromptTreeEndpointRow({
  endpoint,
  visibleTrail,
  ariaLevel,
  isElbow,
  isArchived,
  isOpening,
  onOpen,
}: {
  endpoint: SessionPromptBranchEndpoint;
  visibleTrail: readonly boolean[];
  ariaLevel: number;
  isElbow: boolean;
  isArchived: boolean;
  isOpening: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { conversation } = endpoint;
  const title = formatConversationTitleForDisplay(conversation.runtimeId, conversation.title);
  const actionLabel = endpoint.isActive
    ? t('tasks.bottomPanel.sessionCurrentBranch')
    : isArchived
      ? t('tasks.bottomPanel.sessionRestoreBranch', { title })
      : t('tasks.bottomPanel.sessionOpenBranch', { title });

  return (
    <button
      type="button"
      role="treeitem"
      aria-level={ariaLevel}
      aria-current={endpoint.isActive ? 'page' : undefined}
      className={cn(
        'group flex h-9 w-full min-w-0 items-center gap-1.5 pr-3 text-left text-[11px] text-foreground-passive transition-colors hover:bg-background-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border',
        endpoint.isActive && 'bg-background-2 text-foreground',
        isArchived && !endpoint.isActive && 'text-foreground-passive'
      )}
      disabled={isOpening}
      onClick={onOpen}
      title={actionLabel}
      aria-label={actionLabel}
    >
      <TreeGuideTrail
        visibleTrail={visibleTrail}
        isElbow={isElbow}
        highlighted={endpoint.isActive}
      />
      <EndpointNodeMarker highlighted={endpoint.isActive} isElbow={isElbow} />
      {isOpening ? (
        <Loader2 className="size-3 shrink-0 animate-spin" />
      ) : isArchived ? (
        <ArchiveRestore className="size-3 shrink-0" />
      ) : (
        <GitBranch className="size-3 shrink-0" />
      )}
      <span className={cn('min-w-0 flex-1 truncate font-medium', isArchived && 'line-through')}>
        {title}
      </span>
      <span
        className={cn(
          'shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px]',
          endpoint.isActive && 'border-foreground-tertiary/30 bg-background text-foreground'
        )}
      >
        {endpoint.isActive
          ? t('tasks.bottomPanel.sessionCurrent')
          : isArchived
            ? t('tasks.bottomPanel.sessionRestore')
            : t('tasks.bottomPanel.sessionSwitch')}
      </span>
    </button>
  );
}

function PromptNodeMarker({
  highlighted,
  isCurrent,
  isElbow,
}: {
  highlighted: boolean;
  isCurrent: boolean;
  isElbow: boolean;
}) {
  const lineClassName = highlighted ? 'bg-foreground-tertiary' : 'bg-border';
  return (
    <span className="relative h-full w-5 shrink-0 self-stretch" aria-hidden>
      <span className={cn('absolute bottom-0 left-1/2 top-0 w-px', lineClassName)} />
      {isElbow ? (
        <span className={cn('absolute left-0 right-1/2 top-1/2 h-px', lineClassName)} />
      ) : null}
      <span
        className={cn(
          'absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background ring-2',
          highlighted ? 'ring-foreground-tertiary' : 'ring-border',
          isCurrent && 'bg-foreground-tertiary'
        )}
      />
    </span>
  );
}

function EndpointNodeMarker({ highlighted, isElbow }: { highlighted: boolean; isElbow: boolean }) {
  const lineClassName = highlighted ? 'bg-foreground-tertiary' : 'bg-border';
  return (
    <span className="relative h-full w-5 shrink-0 self-stretch" aria-hidden>
      <span className={cn('absolute left-1/2 top-0 h-1/2 w-px', lineClassName)} />
      {isElbow ? (
        <span className={cn('absolute left-0 right-1/2 top-1/2 h-px', lineClassName)} />
      ) : null}
      <span
        className={cn(
          'absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border bg-background',
          highlighted ? 'border-foreground-tertiary' : 'border-border'
        )}
      />
    </span>
  );
}

function TreeGuideTrail({
  visibleTrail,
  isElbow,
  highlighted,
}: {
  visibleTrail: readonly boolean[];
  isElbow: boolean;
  highlighted: boolean;
}) {
  return visibleTrail.length > 0 ? (
    <span className="flex h-full shrink-0 self-stretch">
      {visibleTrail.map((continues, index) => (
        <TreeGuideSlot
          key={`${index}:${continues ? 'continue' : 'end'}`}
          continues={continues}
          isElbow={isElbow && index === visibleTrail.length - 1}
          highlighted={highlighted}
        />
      ))}
    </span>
  ) : (
    <span className="w-1 shrink-0" aria-hidden />
  );
}

export function countSessionPromptTreeNodes(tree: SessionPromptTree | null): number {
  if (!tree) return 0;
  let count = 0;
  const visit = (node: SessionPromptTreeNode) => {
    count += 1;
    node.children.forEach(visit);
  };
  tree.roots.forEach(visit);
  return count;
}

function flattenSessionPromptTree(tree: NonNullable<SessionPromptTree>): SessionPromptTreeRow[] {
  const rows: SessionPromptTreeRow[] = [];
  const roots: SessionPromptTreeEntry[] = [
    ...tree.roots.map((node) => ({ kind: 'prompt' as const, node })),
    ...tree.rootEndpoints.map((endpoint) => ({ kind: 'endpoint' as const, endpoint })),
  ];

  const visitEntry = (
    entry: SessionPromptTreeEntry,
    guideTrail: readonly boolean[],
    isElbow: boolean
  ) => {
    const key =
      entry.kind === 'prompt'
        ? `prompt:${entry.node.key}`
        : `endpoint:${entry.endpoint.conversation.id}`;
    rows.push({ ...entry, key, guideTrail, isElbow });
    if (entry.kind === 'endpoint') return;

    const descendants: SessionPromptTreeEntry[] = [
      ...entry.node.endpoints
        .filter((endpoint) => !endpoint.isActive)
        .map((endpoint) => ({ kind: 'endpoint' as const, endpoint })),
      ...entry.node.children.map((node) => ({ kind: 'prompt' as const, node })),
    ];
    if (descendants.length === 1) {
      const descendant = descendants[0];
      if (descendant) visitEntry(descendant, guideTrail, false);
      return;
    }
    if (descendants.length > 1) visitBranch(descendants, guideTrail);
  };

  const visitBranch = (
    entries: readonly SessionPromptTreeEntry[],
    ancestorTrail: readonly boolean[]
  ) => {
    entries.forEach((entry, index) => {
      const hasNextSibling = index < entries.length - 1;
      visitEntry(entry, [...ancestorTrail, hasNextSibling], true);
    });
  };

  if (roots.length === 1) {
    const root = roots[0];
    if (root) visitEntry(root, [], false);
  } else {
    visitBranch(roots, []);
  }
  return rows;
}
