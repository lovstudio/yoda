import { FoldVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SessionCompaction } from '@shared/conversations';
import { droppedTokens } from '@renderer/features/tasks/session-compactions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

/**
 * The boundary line drawn above the first prompt that follows a runtime context
 * compaction. Shared by every prompt-history surface so the marker reads the
 * same in the docked strip and the full panel.
 *
 * `top`/`bottom` render as a zero-height absolute overlay on the row's edge:
 * the docked strip reserves its height before prompts load, and any extra
 * layout height there would resize the terminal pane and make the agent
 * reprint its screen. `flow` takes normal layout space, for surfaces that lay
 * the conversation out as a scrollable card list.
 */
export function SessionCompactionMarker({
  compactions,
  placement = 'top',
}: {
  compactions: SessionCompaction[];
  /**
   * `bottom` marks a compaction no later prompt has followed yet. `flow` opts
   * out of overlay positioning and sits between rows instead.
   */
  placement?: 'top' | 'bottom' | 'flow';
}) {
  const { t } = useTranslation();
  if (compactions.length === 0) return null;

  const dropped = droppedTokens(compactions);
  const label =
    compactions.length > 1
      ? t('tasks.sessionInfo.compactedTimes', { times: compactions.length })
      : t('tasks.sessionInfo.compacted');

  return (
    <div
      aria-hidden="true"
      data-session-compaction-marker={compactions.length}
      data-session-compaction-placement={placement}
      className={cn(
        'pointer-events-none flex items-center',
        placement === 'flow' && 'py-1',
        placement !== 'flow' && 'absolute inset-x-0 z-10 h-0',
        placement === 'top' && 'top-0',
        placement === 'bottom' && 'bottom-0'
      )}
    >
      <span className="h-px flex-1 bg-border-primary/70" />
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="pointer-events-auto mx-2 flex shrink-0 items-center gap-1 rounded-full bg-background px-1.5 text-[9px] leading-none text-foreground-passive" />
          }
        >
          <FoldVertical className="size-2.5" />
          <span>{label}</span>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-64 text-[11px] leading-4">
          {t('tasks.sessionInfo.compactedHint')}
          {dropped !== null ? (
            <span className="mt-1 block font-mono tabular-nums text-foreground-passive">
              {t('tasks.sessionInfo.compactedDropped', { tokens: dropped.toLocaleString() })}
            </span>
          ) : null}
        </TooltipContent>
      </Tooltip>
      <span className="h-px flex-1 bg-border-primary/70" />
    </div>
  );
}
