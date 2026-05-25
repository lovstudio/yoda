import { useTranslation } from 'react-i18next';
import { CLISpinner } from '@renderer/features/tasks/components/cliSpinner';
import type { AgentStatus } from '@renderer/features/tasks/conversations/conversation-manager';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

export type AgentIndicatorStatus = AgentStatus | null;

interface AgentStatusIndicatorProps {
  status: AgentIndicatorStatus;
  className?: string;
  disableTooltip?: boolean;
}

export function AgentStatusIndicator({
  status,
  className,
  disableTooltip,
}: AgentStatusIndicatorProps) {
  const { t } = useTranslation();
  if (!status || status === 'idle') return null;
  const statusLabel = t(`agentStatus.${status}`);

  const renderIndicator = () => {
    switch (status) {
      case 'working':
        return <CLISpinner />;
      case 'awaiting-input':
        return (
          <span
            className={cn('rounded-full bg-primary border size-2 border-primary', className)}
            aria-label={statusLabel}
            title={statusLabel}
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
    <span className="size-6 flex items-center justify-center">{renderIndicator()}</span>
  );

  if (disableTooltip) return indicator;

  return (
    <Tooltip>
      <TooltipTrigger render={indicator} />
      <TooltipContent>{statusLabel}</TooltipContent>
    </Tooltip>
  );
}
