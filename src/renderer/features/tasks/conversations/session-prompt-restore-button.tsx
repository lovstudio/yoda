import { GitFork, Loader2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt } from '@shared/conversations';
import { cn } from '@renderer/utils/utils';

export function SessionPromptRestoreButton({
  prompt,
  index,
  isRestoring = false,
  onRestore,
  className,
  containerClassName,
  unavailableHint,
  unavailableLabel,
  visibleLabel,
}: {
  prompt: ClaudeSessionPrompt;
  index: number;
  isRestoring?: boolean;
  onRestore: (prompt: ClaudeSessionPrompt, index: number) => void;
  className?: string;
  containerClassName?: string;
  unavailableHint?: string;
  unavailableLabel?: string;
  visibleLabel?: string;
}) {
  const { t } = useTranslation();
  const forkHintId = `session-fork-hint-${useId().replace(/:/g, '')}`;
  const isUnavailable = !prompt.restoreTarget;
  if (isUnavailable && !unavailableHint) return null;

  const label = isUnavailable
    ? (unavailableLabel ?? visibleLabel ?? t('tasks.bottomPanel.sessionCheckpointUnavailableLabel'))
    : t('tasks.sessionInfo.restoreContextAtPrompt', { index });
  const forkHint = t('tasks.bottomPanel.sessionForkHint');
  const hint = unavailableHint ?? forkHint;
  return (
    <span className={cn('group/fork relative inline-flex shrink-0', containerClassName)}>
      <button
        type="button"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border disabled:pointer-events-none disabled:opacity-50',
          visibleLabel ? 'h-6 gap-1 px-2 text-[11px]' : 'size-5',
          className
        )}
        disabled={isRestoring || isUnavailable}
        aria-disabled={isUnavailable || undefined}
        aria-label={label}
        aria-describedby={forkHintId}
        data-session-prompt-checkpoint-pending={isUnavailable ? '' : undefined}
        title={hint}
        onClick={(event) => {
          event.stopPropagation();
          if (isRestoring || isUnavailable || !prompt.restoreTarget) return;
          onRestore(prompt, index);
        }}
      >
        {isRestoring ? <Loader2 className="size-3 animate-spin" /> : <GitFork className="size-3" />}
        {visibleLabel ? <span>{visibleLabel}</span> : null}
      </button>
      <span
        id={forkHintId}
        data-session-prompt-fork-bubble
        data-session-prompt-checkpoint-bubble={isUnavailable ? '' : undefined}
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-30 mt-1 hidden w-max max-w-64 rounded-md bg-foreground px-3 py-1.5 text-left text-xs leading-5 text-background shadow-lg group-hover/fork:block group-focus-within/fork:block"
      >
        {hint}
      </span>
    </span>
  );
}
