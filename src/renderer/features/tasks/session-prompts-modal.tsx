import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt } from '@shared/conversations';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
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
  sessionTitle?: string;
};

type Props = BaseModalProps<void> & SessionPromptsModalArgs;

export function SessionPromptsModal({ prompts, sessionTitle, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <DialogHeader className="min-w-0 flex-col items-start gap-1">
        <DialogTitle>{t('tasks.sessionInfo.promptsModalTitle')}</DialogTitle>
        {sessionTitle ? (
          <p className="max-w-full truncate text-xs text-foreground-passive">{sessionTitle}</p>
        ) : null}
      </DialogHeader>
      <DialogContentArea className="gap-2 pt-0">
        {prompts.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-foreground-passive">
            {t('tasks.panel.noPrompts')}
          </div>
        ) : (
          prompts.map((prompt, index) => (
            <PromptModalItem key={prompt.id} prompt={prompt} index={index + 1} />
          ))
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogFooter>
    </>
  );
}

function PromptModalItem({ prompt, index }: { prompt: ClaudeSessionPrompt; index: number }) {
  const displayText = displaySessionPromptText(prompt.text);
  const timestamp = prompt.timestamp ? new Date(prompt.timestamp).toLocaleTimeString() : null;
  return (
    <article className="min-w-0 rounded-md border border-border bg-background-1/40 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
        <span className="shrink-0 font-mono text-foreground-passive">#{index}</span>
        {timestamp ? (
          <span className="shrink-0 font-mono text-foreground-passive">{timestamp}</span>
        ) : null}
      </div>
      <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground-muted">
        {displayText}
      </pre>
    </article>
  );
}
