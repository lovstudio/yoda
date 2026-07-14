import { GitFork, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt } from '@shared/conversations';
import { cn } from '@renderer/utils/utils';

export function SessionPromptRestoreButton({
  prompt,
  index,
  isRestoring = false,
  onRestore,
  className,
}: {
  prompt: ClaudeSessionPrompt;
  index: number;
  isRestoring?: boolean;
  onRestore: (prompt: ClaudeSessionPrompt, index: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!prompt.restoreTarget) return null;

  const label = t('tasks.sessionInfo.restoreContextAtPrompt', { index });
  return (
    <button
      type="button"
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      disabled={isRestoring}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onRestore(prompt, index);
      }}
    >
      {isRestoring ? <Loader2 className="size-3 animate-spin" /> : <GitFork className="size-3" />}
    </button>
  );
}
