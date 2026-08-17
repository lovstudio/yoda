import { Loader2, MessageCircleQuestionMark, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentDisplayStatus } from '@shared/agent-background-jobs';
import {
  interruptConversationSession,
  type AgentSessionRef,
} from '@renderer/features/tasks/interrupt-task-sessions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

export type AgentIndicatorStatus = AgentDisplayStatus | null;

interface AgentStatusIndicatorProps {
  status: AgentIndicatorStatus;
  className?: string;
  /** Overrides the size-6 wrapper box (e.g. `size-4` in the top tab strip's icon slot). */
  boxClassName?: string;
  disableTooltip?: boolean;
  /**
   * The session this indicator stands for. Given one, a `working` indicator
   * becomes the interrupt control: hover swaps the spinner for a stop icon and
   * click interrupts that session. Passing the identity rather than a callback
   * keeps the behavior attached to the indicator itself, so a surface cannot
   * silently lose the ability to interrupt while still showing `working`.
   */
  session?: AgentSessionRef;
}

export function AgentStatusIndicator({
  status,
  className,
  boxClassName,
  disableTooltip,
  session,
}: AgentStatusIndicatorProps) {
  const { t } = useTranslation();
  if (!status || status === 'idle') return null;
  const statusLabel = t(`agentStatus.${status}`);

  if (status === 'working' && session) {
    const interruptLabel = t('agentStatus.interrupt');
    const interrupt = () => void interruptConversationSession(session);
    // `role="button"` rather than a real `<button>`: every surface renders this
    // indicator inside an already-clickable row, tab, or popover trigger, and a
    // nested `<button>` there is invalid HTML.
    const control = (
      <span
        role="button"
        tabIndex={0}
        aria-label={interruptLabel}
        // Surfaces that opt out of the shared tooltip still need the action
        // named, otherwise the stop icon appears with no explanation.
        title={disableTooltip ? interruptLabel : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          interrupt();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          interrupt();
        }}
        className={cn(
          'group/interrupt size-6 flex items-center justify-center cursor-pointer rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring',
          boxClassName
        )}
      >
        <Loader2
          className={cn(
            'size-3.5 motion-safe:animate-spin text-primary group-hover/interrupt:hidden',
            className
          )}
        />
        <Square
          className={cn(
            'size-3 text-primary fill-current hidden group-hover/interrupt:block',
            className
          )}
        />
      </span>
    );
    if (disableTooltip) return control;
    return (
      <Tooltip>
        <TooltipTrigger render={control} />
        <TooltipContent>{interruptLabel}</TooltipContent>
      </Tooltip>
    );
  }

  const renderIndicator = () => {
    switch (status) {
      case 'working':
        return (
          <Loader2 className={cn('size-3.5 motion-safe:animate-spin text-primary', className)} />
        );
      // The turn is over; only a detached job is left. Same spinner vocabulary
      // as `working` because something is genuinely still running, but muted and
      // slowed so it never competes with the agent's own activity.
      case 'background':
        return (
          <Loader2
            className={cn(
              'size-3.5 motion-safe:animate-spin [animation-duration:2.4s] text-foreground-passive',
              className
            )}
            aria-label={statusLabel}
          />
        );
      case 'awaiting-input':
        return (
          <MessageCircleQuestionMark
            className={cn(
              'size-4 motion-safe:animate-pulse text-amber-500 dark:text-amber-300',
              className
            )}
            aria-label={statusLabel}
          />
        );
      case 'error':
        return (
          <span
            className={cn('rounded-full bg-red-200 border size-2 border-red-500', className)}
            aria-label={statusLabel}
            title={statusLabel}
          />
        );
      case 'completed':
        return (
          <span
            className={cn('rounded-full bg-green-200 border size-2 border-green-500', className)}
            aria-label={statusLabel}
            title={statusLabel}
          />
        );
      // Same dot vocabulary as the other settled states, in neutral: the turn is
      // over, but it neither succeeded nor failed.
      case 'interrupted':
        return (
          <span
            className={cn(
              'rounded-full bg-background-secondary border size-2 border-foreground-passive',
              className
            )}
            aria-label={statusLabel}
            title={statusLabel}
          />
        );
      default:
        return null;
    }
  };

  const indicator = (
    <span className={cn('size-6 flex items-center justify-center', boxClassName)}>
      {renderIndicator()}
    </span>
  );

  if (disableTooltip) return indicator;

  return (
    <Tooltip>
      <TooltipTrigger render={indicator} />
      <TooltipContent>{statusLabel}</TooltipContent>
    </Tooltip>
  );
}
