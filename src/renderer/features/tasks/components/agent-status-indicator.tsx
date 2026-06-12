import { Loader2, MessageCircleQuestionMark, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentStatus } from '@renderer/features/tasks/conversations/conversation-manager';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

export type AgentIndicatorStatus = AgentStatus | null;

interface AgentStatusIndicatorProps {
  status: AgentIndicatorStatus;
  className?: string;
  /** Overrides the size-6 wrapper box (e.g. `size-4` in the top tab strip's icon slot). */
  boxClassName?: string;
  disableTooltip?: boolean;
  /** When set and status is `working`, hover swaps the spinner for a stop icon and click interrupts. */
  onInterrupt?: () => void;
}

export function AgentStatusIndicator({
  status,
  className,
  boxClassName,
  disableTooltip,
  onInterrupt,
}: AgentStatusIndicatorProps) {
  const { t } = useTranslation();
  if (!status || status === 'idle') return null;
  const statusLabel = t(`agentStatus.${status}`);

  if (status === 'working' && onInterrupt) {
    const interruptLabel = t('agentStatus.interrupt');
    const button = (
      <button
        type="button"
        aria-label={interruptLabel}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onInterrupt();
        }}
        className="group/interrupt size-6 flex items-center justify-center cursor-pointer"
      >
        <Loader2
          className={cn(
            'size-3.5 animate-spin text-primary group-hover/interrupt:hidden',
            className
          )}
        />
        <Square
          className={cn(
            'size-3 text-primary fill-current hidden group-hover/interrupt:block',
            className
          )}
        />
      </button>
    );
    if (disableTooltip) return button;
    return (
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent>{interruptLabel}</TooltipContent>
      </Tooltip>
    );
  }

  const renderIndicator = () => {
    switch (status) {
      case 'working':
        return <Loader2 className={cn('size-3.5 animate-spin text-primary', className)} />;
      case 'awaiting-input':
        return (
          <MessageCircleQuestionMark
            className={cn('size-4 animate-pulse text-amber-500 dark:text-amber-300', className)}
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
