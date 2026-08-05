import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentReplyDisplayLevel } from '@shared/agent-reply-display';
import type { ClaudeSessionPrompt, SessionTranscriptMessage } from '@shared/conversations';
import { SessionConversationList } from '@renderer/features/tasks/session-conversation-list';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { DialogContentArea, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { Switch } from '@renderer/lib/ui/switch';

export type SessionPromptsModalArgs = {
  prompts: ClaudeSessionPrompt[];
  messages?: SessionTranscriptMessage[];
  displayLevel?: Exclude<AgentReplyDisplayLevel, 'verbose'>;
  /** Optional one-based transcript positions when displaying a prompt subset. */
  promptNumbers?: number[];
  sessionTitle?: string;
  onRestorePrompt?: (prompt: ClaudeSessionPrompt, index: number) => void;
};

type Props = BaseModalProps<void> & SessionPromptsModalArgs;

export function SessionPromptsModal({
  prompts,
  messages = [],
  displayLevel = 'hidden',
  promptNumbers,
  sessionTitle,
  onRestorePrompt,
}: Props) {
  const { t } = useTranslation();
  const [showAgentReplies, setShowAgentReplies] = useState(false);
  const visibleDisplayLevel = showAgentReplies
    ? displayLevel === 'hidden'
      ? 'concise'
      : displayLevel
    : 'hidden';

  return (
    <>
      <DialogHeader className="min-w-0 flex-1 justify-between gap-4">
        <div className="min-w-0">
          <DialogTitle>{t('tasks.sessionInfo.conversationModalTitle')}</DialogTitle>
          {sessionTitle ? (
            <p className="mt-1 max-w-full truncate text-xs text-foreground-passive">
              {sessionTitle}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-foreground-muted">
          <span>{t('tasks.sessionInfo.showAgentReplies')}</span>
          <Switch
            size="sm"
            checked={showAgentReplies}
            onCheckedChange={setShowAgentReplies}
            aria-label={t('tasks.sessionInfo.showAgentReplies')}
          />
        </div>
      </DialogHeader>
      <DialogContentArea className="gap-2 pt-0">
        <SessionConversationList
          prompts={prompts}
          messages={messages}
          displayLevel={visibleDisplayLevel}
          variant="full"
          promptNumbers={promptNumbers}
          onRestorePrompt={onRestorePrompt}
        />
      </DialogContentArea>
    </>
  );
}
