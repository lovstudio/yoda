import { ArchiveRestore } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@shared/conversations';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { reopenArchivedConversation } from '@renderer/features/tasks/conversations/use-archived-conversations';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import { TranscriptLineItem } from './components/transcript-line';
import {
  normalizeConversationTranscript,
  type ConversationTranscript,
} from './transcript-normalization';

export type ArchivedSessionTranscriptModalArgs = {
  conversation: Conversation;
};

type Props = BaseModalProps<void> & ArchivedSessionTranscriptModalArgs;

/**
 * Read-only viewer for an archived session: the on-disk transcript (Claude
 * JSONL / Codex rollout) rendered without resuming the PTY or touching the
 * archive state — review first, restore only if needed.
 */
export function ArchivedSessionTranscriptModal({ conversation, onClose }: Props) {
  const { t } = useTranslation();
  const [transcript, setTranscript] = useState<ConversationTranscript | undefined>();
  const [busy, setBusy] = useState(false);

  const config = agentConfig[conversation.runtimeId];
  const displayTitle = formatConversationTitleForDisplay(
    conversation.runtimeId,
    conversation.title
  );

  useEffect(() => {
    let cancelled = false;
    rpc.conversations
      .getConversationTranscript(conversation.projectId, conversation.taskId, conversation.id)
      .then((result) => {
        if (!cancelled) setTranscript(normalizeConversationTranscript(result));
      })
      .catch(() => {
        if (!cancelled) setTranscript(normalizeConversationTranscript(null));
      });
    return () => {
      cancelled = true;
    };
  }, [conversation.projectId, conversation.taskId, conversation.id]);

  const handleRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await reopenArchivedConversation(conversation);
      onClose();
    } catch (error) {
      log.warn('ArchivedSessionTranscriptModal: failed to restore conversation', {
        conversationId: conversation.id,
        error,
      });
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader className="min-w-0 flex-col items-start gap-1.5">
        <DialogTitle className="flex min-w-0 max-w-full items-center gap-2">
          <AgentLogo
            logo={config.logo}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="size-4 shrink-0"
          />
          <span className="min-w-0 truncate">{displayTitle}</span>
        </DialogTitle>
        <div className="flex items-center gap-2 text-xs text-foreground-passive">
          <span className="rounded-sm bg-background-tertiary-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground-tertiary">
            {t('tasks.archivedSession.readOnly')}
          </span>
          {conversation.archivedAt ? (
            <span className="flex items-center gap-1">
              {t('tasks.archivedSession.archivedLabel')}
              <RelativeTime value={conversation.archivedAt} className="font-mono" compact />
            </span>
          ) : null}
        </div>
      </DialogHeader>
      <DialogContentArea className="gap-0 pt-0">
        {transcript === undefined ? (
          <div className="px-3 py-3 text-xs text-foreground-passive">
            {t('tasks.transcript.loading')}
          </div>
        ) : transcript.lines.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-foreground-passive">
            {t('tasks.transcript.empty')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border/60">
            {transcript.totalLines > transcript.lines.length ? (
              <div className="border-b border-border/40 px-3 py-1.5 text-[11px] text-foreground-passive">
                {t('tasks.transcript.earlierLines', {
                  count: transcript.totalLines - transcript.lines.length,
                })}
              </div>
            ) : null}
            {transcript.lines.map((line, index) => {
              const lineNo = transcript.totalLines - transcript.lines.length + index + 1;
              return (
                <TranscriptLineItem key={`${lineNo}:${line.length}`} line={line} lineNo={lineNo} />
              );
            })}
          </div>
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void handleRestore()}
        >
          <ArchiveRestore className="size-4" />
          {t('tasks.archivedSession.restore')}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogFooter>
    </>
  );
}
