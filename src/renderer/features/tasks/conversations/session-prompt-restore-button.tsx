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
  visibleLabel,
}: {
  prompt: ClaudeSessionPrompt;
  index: number;
  isRestoring?: boolean;
  onRestore: (prompt: ClaudeSessionPrompt, index: number) => void;
  className?: string;
  visibleLabel?: string;
}) {
  const { t } = useTranslation();
  if (!prompt.restoreTarget) return null;

  const label = t('tasks.sessionInfo.restoreContextAtPrompt', { index });
  return (
    <button
      type="button"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border disabled:pointer-events-none disabled:opacity-50',
        visibleLabel ? 'h-6 gap-1 px-2 text-[11px]' : 'size-5',
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
      {visibleLabel ? <span>{visibleLabel}</span> : null}
    </button>
  );
}
