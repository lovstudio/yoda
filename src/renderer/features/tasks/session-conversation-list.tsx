import type { AgentReplyDisplayLevel } from '@lovstudio/yoda-protocol/agent-reply-display';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ClaudeSessionPrompt,
  SessionCompaction,
  SessionTranscriptMessage,
} from '@shared/conversations';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { SessionCompactionMarker } from '@renderer/features/tasks/conversations/session-compaction-marker';
import { SessionPromptRestoreButton } from '@renderer/features/tasks/conversations/session-prompt-restore-button';
import {
  compactionsBeforePrompt,
  trailingCompactions,
} from '@renderer/features/tasks/session-compactions';
import {
  buildSessionConversationItems,
  buildSessionConversationPreviewItems,
  type SessionConversationItem,
} from '@renderer/features/tasks/session-conversation';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { cn } from '@renderer/utils/utils';

export function SessionConversationList({
  prompts,
  messages,
  displayLevel,
  variant,
  promptNumbers,
  compactions,
  isLoading = false,
  onOpenAll,
  onRestorePrompt,
  restoringPromptId,
}: {
  prompts: ClaudeSessionPrompt[];
  messages: SessionTranscriptMessage[];
  displayLevel: Exclude<AgentReplyDisplayLevel, 'verbose'>;
  variant: 'preview' | 'full';
  /** Optional one-based transcript positions when displaying a prompt subset. */
  promptNumbers?: number[];
  /**
   * Only meaningful when `prompts` is a whole session — the boundaries are
   * positioned against that array, so a `promptNumbers` subset must omit them.
   */
  compactions?: SessionCompaction[];
  isLoading?: boolean;
  onOpenAll?: () => void;
  onRestorePrompt?: (prompt: ClaudeSessionPrompt, index: number) => void;
  restoringPromptId?: string | null;
}) {
  const { t } = useTranslation();
  const items = useMemo(
    () => buildSessionConversationItems(prompts, messages, displayLevel, promptNumbers),
    [displayLevel, messages, promptNumbers, prompts]
  );
  const visibleItems = useMemo(
    () =>
      variant === 'preview'
        ? buildSessionConversationPreviewItems(items)
        : items.map((item) => ({ type: 'message' as const, item })),
    [items, variant]
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-1 py-1.5 text-xs text-foreground-passive">
        <Loader2 className="size-3 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-1 py-1.5 text-xs text-foreground-passive">
        {t('tasks.panel.noPrompts')}
      </div>
    );
  }

  return (
    <div className={cn('grid', variant === 'preview' ? 'gap-1' : 'gap-2')}>
      {visibleItems.map((entry) =>
        entry.type === 'truncated' ? (
          <button
            key="truncated"
            type="button"
            className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-[11px] text-foreground-passive hover:bg-background-1 hover:text-foreground-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onOpenAll}
          >
            <MoreHorizontal className="size-3.5" />
            {t('tasks.sessionInfo.truncatedMessages', { count: entry.hiddenCount })}
          </button>
        ) : (
          <Fragment key={entry.item.key}>
            <SessionCompactionMarker
              compactions={
                entry.item.promptIndex
                  ? compactionsBeforePrompt(compactions, entry.item.promptIndex)
                  : []
              }
              placement="flow"
            />
            <SessionConversationRow
              item={entry.item}
              variant={variant}
              onRestorePrompt={onRestorePrompt}
              isRestoring={restoringPromptId === entry.item.prompt?.id}
            />
          </Fragment>
        )
      )}
      <SessionCompactionMarker
        compactions={trailingCompactions(compactions, prompts.length)}
        placement="flow"
      />
    </div>
  );
}

function SessionConversationRow({
  item,
  variant,
  onRestorePrompt,
  isRestoring,
}: {
  item: SessionConversationItem;
  variant: 'preview' | 'full';
  onRestorePrompt?: (prompt: ClaudeSessionPrompt, index: number) => void;
  isRestoring: boolean;
}) {
  return item.message.role === 'user' ? (
    <UserConversationRow
      item={item}
      variant={variant}
      onRestorePrompt={onRestorePrompt}
      isRestoring={isRestoring}
    />
  ) : (
    <AgentConversationRow item={item} variant={variant} />
  );
}

function UserConversationRow({
  item,
  variant,
  onRestorePrompt,
  isRestoring,
}: {
  item: SessionConversationItem;
  variant: 'preview' | 'full';
  onRestorePrompt?: (prompt: ClaudeSessionPrompt, index: number) => void;
  isRestoring: boolean;
}) {
  const { t } = useTranslation();
  const text = displaySessionPromptText(item.message.text);
  const timestamp = formatTimestamp(item.message.timestamp);
  const canRestore = Boolean(
    item.prompt && item.promptIndex && item.prompt.restoreTarget && onRestorePrompt
  );

  return (
    <article
      className={cn(
        'group min-w-0 rounded-sm bg-background-1/45',
        variant === 'preview' ? 'px-1.5 py-1' : 'border border-border px-2.5 py-2'
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-[10px] text-foreground-passive">
        <span className="font-mono">
          {item.promptIndex
            ? t('tasks.sessionInfo.userMessageIndex', { index: item.promptIndex })
            : t('tasks.sessionInfo.userMessage')}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {timestamp ? <span className="font-mono">{timestamp}</span> : null}
          {canRestore && item.prompt && item.promptIndex && onRestorePrompt ? (
            <SessionPromptRestoreButton
              prompt={item.prompt}
              index={item.promptIndex}
              isRestoring={isRestoring}
              onRestore={onRestorePrompt}
              className={
                variant === 'preview'
                  ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                  : undefined
              }
            />
          ) : null}
        </span>
      </div>
      <p
        className={cn(
          'mt-1 whitespace-pre-wrap break-words text-foreground-muted',
          variant === 'preview'
            ? 'max-h-32 overflow-hidden text-[11px] leading-snug'
            : 'text-xs leading-relaxed'
        )}
      >
        {text}
      </p>
    </article>
  );
}

function AgentConversationRow({
  item,
  variant,
}: {
  item: SessionConversationItem;
  variant: 'preview' | 'full';
}) {
  const { t } = useTranslation();
  const timestamp = formatTimestamp(item.message.timestamp);

  return (
    <article
      className={cn(
        'min-w-0 border-l-2 border-primary/45 bg-primary/5',
        variant === 'preview'
          ? 'px-2 py-1.5'
          : 'rounded-r-sm border-y border-r border-y-border border-r-border p-2.5'
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-foreground-passive">
        <span className="font-medium text-foreground-muted">{t('tasks.sessionInfo.agent')}</span>
        {item.message.phase === 'final' ? (
          <span className="rounded-full bg-primary/10 px-1.5 py-px text-[9px] text-primary">
            {t('tasks.sessionInfo.finalResult')}
          </span>
        ) : null}
        {timestamp ? <span className="ml-auto shrink-0 font-mono">{timestamp}</span> : null}
      </div>
      <MarkdownRenderer
        content={item.message.text}
        variant="compact"
        annotations={false}
        className={cn(
          'mt-1 min-w-0 break-words text-foreground-muted [&>*:last-child]:mb-0 [&_pre]:max-w-full',
          variant === 'preview'
            ? 'max-h-48 overflow-hidden text-[11px] leading-snug'
            : 'text-xs leading-relaxed'
        )}
      />
    </article>
  );
}

function formatTimestamp(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime()) ? null : value.toLocaleTimeString();
}
