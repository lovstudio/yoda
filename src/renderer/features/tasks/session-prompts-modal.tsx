import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt, SessionTranscriptMessage } from '@shared/conversations';
import type { AgentReplyDisplayLevel } from '@renderer/features/tasks/session-conversation';
import { SessionConversationList } from '@renderer/features/tasks/session-conversation-list';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type SessionPromptsModalArgs = {
  prompts: ClaudeSessionPrompt[];
  messages?: SessionTranscriptMessage[];
  displayLevel?: Exclude<AgentReplyDisplayLevel, 'verbose'>;
  sessionTitle?: string;
  onRestorePrompt?: (prompt: ClaudeSessionPrompt, index: number) => void;
};

type Props = BaseModalProps<void> & SessionPromptsModalArgs;

export function SessionPromptsModal({
  prompts,
  messages = [],
  displayLevel = 'hidden',
  sessionTitle,
  onRestorePrompt,
  onClose,
}: Props) {
  const { t } = useTranslation();
  return (
    <>
      <DialogHeader className="min-w-0 flex-col items-start gap-1">
        <DialogTitle>{t('tasks.sessionInfo.conversationModalTitle')}</DialogTitle>
        {sessionTitle ? (
          <p className="max-w-full truncate text-xs text-foreground-passive">{sessionTitle}</p>
        ) : null}
      </DialogHeader>
      <DialogContentArea className="gap-2 pt-0">
        <SessionConversationList
          prompts={prompts}
          messages={messages}
          displayLevel={displayLevel}
          variant="full"
          onRestorePrompt={onRestorePrompt}
        />
      </DialogContentArea>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogFooter>
    </>
  );
}
