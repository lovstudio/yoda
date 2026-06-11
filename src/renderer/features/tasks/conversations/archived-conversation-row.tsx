import { ArchiveRestore } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@shared/conversations';
import type { ConversationUsageSummary } from '@shared/stats';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { reopenArchivedConversation } from '@renderer/features/tasks/conversations/use-archived-conversations';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { SessionUsageChip } from '../components/session-usage-chip';

/**
 * One archived session row: clicking opens the read-only transcript viewer
 * (review without changing archive state); the explicit restore button
 * unarchives and reopens the live conversation tab.
 */
export function ArchivedConversationRow({
  conversation,
  usage,
  compact = false,
}: {
  conversation: Conversation;
  usage?: ConversationUsageSummary;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const showTranscript = useShowModal('archivedSessionTranscriptModal');
  const [busy, setBusy] = useState(false);

  const config = agentConfig[conversation.runtimeId];
  const displayTitle = formatConversationTitleForDisplay(
    conversation.runtimeId,
    conversation.title
  );

  const handleRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await reopenArchivedConversation(conversation);
    } catch (error) {
      log.warn('ArchivedConversationRow: failed to restore conversation', {
        conversationId: conversation.id,
        error,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        'group flex w-full items-center gap-1',
        compact
          ? 'h-8 rounded-md'
          : 'rounded-lg border border-border/40 transition-colors hover:bg-background-1',
        busy && 'opacity-60'
      )}
    >
      <button
        type="button"
        onClick={() => showTranscript({ conversation })}
        title={t('tasks.archivedSession.viewTranscript')}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left text-sm text-foreground-passive transition-colors hover:text-foreground-muted',
          compact ? 'h-8 gap-2 rounded-md hover:bg-background-1' : 'py-2.5 pl-3'
        )}
      >
        <span className="shrink-0 opacity-60">
          <AgentLogo
            logo={config.logo}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="size-4"
          />
        </span>
        <span className="min-w-0 flex-1 truncate" title={displayTitle}>
          {displayTitle}
        </span>
        {!compact && <SessionUsageChip usage={usage} />}
        <RelativeTime
          value={conversation.archivedAt ?? conversation.lastInteractedAt ?? ''}
          className="shrink-0 font-mono text-xs text-foreground-passive"
          compact
        />
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={busy}
        title={t('tasks.archivedSession.restore')}
        aria-label={t('tasks.archivedSession.restore')}
        className={cn('mr-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100')}
        onClick={() => void handleRestore()}
      >
        <ArchiveRestore className="size-3.5" />
      </Button>
    </div>
  );
}
